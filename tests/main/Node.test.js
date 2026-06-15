import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@main/ssh/SSHService', () => {
    class SSHParams {
        constructor(host, port, username, password, privateKey, passphrase) {
            this.name = ''
            this.host = host
            this.port = port
            this.username = username
            this.password = password
            this.privateKey = privateKey
            this.passphrase = passphrase
        }
        getConnectionParams() {
            return { name: this.name, host: this.host, port: this.port, username: this.username, password: this.password, privateKey: this.privateKey, passphrase: this.passphrase }
        }
        setHostName(name) { this.name = name }
    }
    class SSHService {
        constructor(params, onStateChange) {
            this.SSHParams = params
            this.connections = []
            this.onStateChange = onStateChange // expose for test inspection
            this.exec = vi.fn()
            this.disconnect = vi.fn(() => { this.connections = [] })
            this.connect = vi.fn()
            this.reconnect = vi.fn(async () => true)
        }
    }
    return { SSHService, SSHParams }
})

vi.mock('electron-log', () => ({ default: { debug: vi.fn(), info: vi.fn(), error: vi.fn(), warn: vi.fn() } }))

import { Node } from '@main/nodes/Node'

const creds = { host: '1.2.3.4', port: 22, username: 'root', password: 'p', privateKey: '/fake/key', passphrase: '' }

function ok(stdout = '', stderr = '') { return { rc: 0, stdout, stderr } }
function fail(stderr = 'boom') { return { rc: 1, stdout: '', stderr } }

describe('Node', () => {
    let node
    beforeEach(() => {
        node = new Node(creds)
    })

    describe('constructor', () => {
        it('generates a UUID id', () => {
            expect(node.id).toMatch(/^[0-9a-f-]{36}$/)
        })
        it('creates distinct ids per instance', () => {
            const a = new Node(creds), b = new Node(creds)
            expect(a.id).not.toBe(b.id)
        })
        it('initializes settings null and services empty', () => {
            expect(node.settings).toBeNull()
            expect(node.services).toEqual([])
        })
        it('initializes status as "disconnected"', () => {
            expect(node.status).toBe('disconnected')
        })
        it('wires SSHService with credentials', () => {
            expect(node.sshService.SSHParams.host).toBe('1.2.3.4')
            expect(node.sshService.SSHParams.privateKey).toBe('/fake/key')
        })
        it('passes an onStateChange callback to SSHService that updates node.status', () => {
            expect(typeof node.sshService.onStateChange).toBe('function')
            node.sshService.onStateChange('connected')
            expect(node.status).toBe('connected')
            node.sshService.onStateChange('reconnecting')
            expect(node.status).toBe('reconnecting')
        })
    })

    describe('onStatusChange', () => {
        it('notifies all registered listeners on status change', () => {
            const a = vi.fn(), b = vi.fn()
            node.onStatusChange(a)
            node.onStatusChange(b)
            node._setStatus('connected')
            expect(a).toHaveBeenCalledWith('connected')
            expect(b).toHaveBeenCalledWith('connected')
        })

        it('deduplicates no-op transitions', () => {
            const cb = vi.fn()
            node.onStatusChange(cb)
            node._setStatus('disconnected') // already 'disconnected'
            expect(cb).not.toHaveBeenCalled()
        })

        it('returns an unsubscribe function', () => {
            const cb = vi.fn()
            const off = node.onStatusChange(cb)
            off()
            node._setStatus('connected')
            expect(cb).not.toHaveBeenCalled()
        })

        it('does not let one listener throwing stop others', () => {
            const bad = vi.fn(() => { throw new Error('x') })
            const good = vi.fn()
            node.onStatusChange(bad)
            node.onStatusChange(good)
            expect(() => node._setStatus('connected')).not.toThrow()
            expect(good).toHaveBeenCalled()
        })
    })

    describe('toListDTO', () => {
        it('returns lightweight DTO with connected=false when no connections', () => {
            node.sshService.SSHParams.name = 'mynode'
            expect(node.toListDTO()).toMatchObject({ id: node.id, name: 'mynode', host: '1.2.3.4', connected: false })
        })
        it('reports connected=true when connections exist', () => {
            node.sshService.connections = [{}]
            expect(node.toListDTO().connected).toBe(true)
        })
        it('includes the current status', () => {
            node._setStatus('reconnecting')
            expect(node.toListDTO().status).toBe('reconnecting')
        })
    })

    describe('fetchSettings', () => {
        it('parses YAML from stereum.yaml', async () => {
            node.sshService.exec.mockResolvedValueOnce(ok('stereum_settings:\n  settings:\n    controls_install_path: /opt/stereum\n'))
            const s = await node.fetchSettings()
            expect(s.stereum_settings.settings.controls_install_path).toBe('/opt/stereum')
            expect(node.sshService.exec).toHaveBeenCalledWith('cat /etc/stereum/stereum.yaml')
        })
        it('caches result; does not re-exec on subsequent calls', async () => {
            node.sshService.exec.mockResolvedValueOnce(ok('a: 1'))
            await node.fetchSettings()
            await node.fetchSettings()
            expect(node.sshService.exec).toHaveBeenCalledTimes(1)
        })
        it('refreshes when refresh=true', async () => {
            node.sshService.exec.mockResolvedValue(ok('a: 1'))
            await node.fetchSettings()
            await node.fetchSettings(true)
            expect(node.sshService.exec).toHaveBeenCalledTimes(2)
        })
        it('throws on non-zero rc with stderr', async () => {
            node.sshService.exec.mockResolvedValueOnce(fail('no perms'))
            await expect(node.fetchSettings()).rejects.toThrow('no perms')
        })
    })

    describe('fetchServices', () => {
        it('parses service IDs, stripping .yaml + whitespace + blanks', async () => {
            node.sshService.exec.mockResolvedValueOnce(ok('aaa.yaml\nbbb.yaml\n\n  ccc.yaml  \n'))
            const services = await node.fetchServices()
            expect(services).toEqual([{ id: 'aaa' }, { id: 'bbb' }, { id: 'ccc' }])
        })
        it('caches; refresh=true re-execs', async () => {
            node.sshService.exec.mockResolvedValue(ok('aaa.yaml'))
            await node.fetchServices()
            await node.fetchServices()
            expect(node.sshService.exec).toHaveBeenCalledTimes(1)
            await node.fetchServices(true)
            expect(node.sshService.exec).toHaveBeenCalledTimes(2)
        })
        it('throws on rc != 0', async () => {
            node.sshService.exec.mockResolvedValueOnce(fail('denied'))
            await expect(node.fetchServices()).rejects.toThrow('denied')
        })
    })

    describe('fetchContainerStatuses', () => {
        it('maps stereum-<uuid> container names to status objects', async () => {
            const uuid = 'aaaaaaaa-0000-0000-0000-aaaaaaaaaaaa'
            const line = JSON.stringify({ Names: `stereum-${uuid}`, State: 'running', Status: 'Up 5m', Image: 'geth:1.17' })
            node.sshService.exec.mockResolvedValueOnce(ok(line))
            const statuses = await node.fetchContainerStatuses()
            expect(statuses[uuid]).toEqual({ state: 'running', status: 'Up 5m', image: 'geth:1.17' })
        })
        it('ignores containers without stereum-UUID name', async () => {
            const line = JSON.stringify({ Names: 'random-container', State: 'running', Status: 'Up', Image: 'x' })
            node.sshService.exec.mockResolvedValueOnce(ok(line))
            const statuses = await node.fetchContainerStatuses()
            expect(statuses).toEqual({})
        })
        it('skips malformed JSON lines without throwing', async () => {
            const good = JSON.stringify({ Names: 'stereum-aaaaaaaa-0000-0000-0000-aaaaaaaaaaaa', State: 's', Status: 'st', Image: 'i' })
            node.sshService.exec.mockResolvedValueOnce(ok('not json\n' + good + '\n}{broken{'))
            const statuses = await node.fetchContainerStatuses()
            expect(Object.keys(statuses)).toHaveLength(1)
        })
        it('throws on rc != 0', async () => {
            node.sshService.exec.mockResolvedValueOnce(fail('docker dead'))
            await expect(node.fetchContainerStatuses()).rejects.toThrow('docker dead')
        })
    })

    describe('fetchRawServiceConfig', () => {
        it('returns raw stdout for the YAML file', async () => {
            node.sshService.exec.mockResolvedValueOnce(ok('id: abc'))
            const raw = await node.fetchRawServiceConfig('abc')
            expect(raw).toBe('id: abc')
            expect(node.sshService.exec).toHaveBeenCalledWith('cat /etc/stereum/services/abc.yaml')
        })
        it('throws on failure', async () => {
            node.sshService.exec.mockResolvedValueOnce(fail('nope'))
            await expect(node.fetchRawServiceConfig('abc')).rejects.toThrow('nope')
        })
    })

    describe('writeServiceConfig', () => {
        it('base64-encodes content and pipes to sudo tee', async () => {
            node.sshService.exec.mockResolvedValueOnce(ok())
            await node.writeServiceConfig('abc', 'hello: world')
            const cmd = node.sshService.exec.mock.calls[0][0]
            const expectedB64 = Buffer.from('hello: world').toString('base64')
            expect(cmd).toContain(expectedB64)
            expect(cmd).toContain('/etc/stereum/services/abc.yaml')
            expect(cmd).toContain('sudo tee')
            // useSudo=false so caller controls sudo
            expect(node.sshService.exec.mock.calls[0][1]).toBe(false)
        })
        it('throws on rc != 0', async () => {
            node.sshService.exec.mockResolvedValueOnce(fail('readonly fs'))
            await expect(node.writeServiceConfig('abc', 'x')).rejects.toThrow('readonly fs')
        })
    })

    describe('fetchServiceConfigs', () => {
        it('populates config on each service in parallel', async () => {
            node.services = [{ id: 'a' }, { id: 'b' }]
            node.sshService.exec.mockImplementation((cmd) => {
                if (cmd.includes('a.yaml')) return Promise.resolve(ok('id: a'))
                if (cmd.includes('b.yaml')) return Promise.resolve(ok('id: b'))
                return Promise.resolve(fail())
            })
            await node.fetchServiceConfigs()
            expect(node.services[0].config).toEqual({ id: 'a' })
            expect(node.services[1].config).toEqual({ id: 'b' })
        })
        it('fetches services first when empty', async () => {
            node.sshService.exec
                .mockResolvedValueOnce(ok('a.yaml')) // fetchServices
                .mockResolvedValueOnce(ok('id: a')) // config for a
            await node.fetchServiceConfigs()
            expect(node.services).toEqual([{ id: 'a', config: { id: 'a' } }])
        })
        it('rejects if any config fetch fails', async () => {
            node.services = [{ id: 'a' }]
            node.sshService.exec.mockResolvedValueOnce(fail('gone'))
            await expect(node.fetchServiceConfigs()).rejects.toThrow('gone')
        })
    })

    describe('toDTO', () => {
        it('returns full DTO including container state merged into services', async () => {
            node.sshService.SSHParams.name = 'host1'
            const svcId = 'aaaaaaaa-0000-0000-0000-aaaaaaaaaaaa'
            node.sshService.exec.mockImplementation((cmd) => {
                if (cmd.includes('stereum.yaml')) return Promise.resolve(ok('stereum_settings:\n  settings:\n    controls_install_path: /opt/stereum'))
                if (cmd.startsWith('ls /etc/stereum/services')) return Promise.resolve(ok(`${svcId}.yaml`))
                if (cmd.includes(`${svcId}.yaml`)) return Promise.resolve(ok(`id: ${svcId}\nservice: GethService`))
                if (cmd.startsWith('docker ps')) {
                    return Promise.resolve(ok(JSON.stringify({ Names: `stereum-${svcId}`, State: 'running', Status: 'Up', Image: 'geth' })))
                }
                return Promise.resolve(fail('unexpected: ' + cmd))
            })
            const dto = await node.toDTO()
            expect(dto.id).toBe(node.id)
            expect(dto.name).toBe('host1')
            expect(dto.settings.stereum_settings.settings.controls_install_path).toBe('/opt/stereum')
            expect(dto.services).toHaveLength(1)
            expect(dto.services[0].container).toEqual({ state: 'running', status: 'Up', image: 'geth' })
        })
        it('sets container=null for services with no matching docker entry', async () => {
            node.sshService.exec.mockImplementation((cmd) => {
                if (cmd.includes('stereum.yaml')) return Promise.resolve(ok('a: 1'))
                if (cmd.startsWith('ls')) return Promise.resolve(ok('xxxx.yaml'))
                if (cmd.includes('xxxx.yaml')) return Promise.resolve(ok('id: xxxx'))
                if (cmd.startsWith('docker')) return Promise.resolve(ok(''))
                return Promise.resolve(fail())
            })
            const dto = await node.toDTO()
            expect(dto.services[0].container).toBeNull()
        })
    })

    describe('start/stop/restart Service', () => {
        beforeEach(() => {
            node.settings = { stereum_settings: { settings: { controls_install_path: '/opt/stereum' } } }
            node.sshService.exec.mockResolvedValue(ok('ok'))
        })
        it('startService passes state=started', async () => {
            await node.startService('svc-1')
            const cmd = node.sshService.exec.mock.calls[0][0]
            expect(cmd).toContain('"state":"started"')
            expect(cmd).toContain('"id":"svc-1"')
            expect(cmd).toContain('stereum_role')
            expect(cmd).toContain('manage-service')
        })
        it('stopService passes state=stopped', async () => {
            await node.stopService('svc-1')
            expect(node.sshService.exec.mock.calls[0][0]).toContain('"state":"stopped"')
        })
        it('restartService passes state=restarted', async () => {
            await node.restartService('svc-1')
            expect(node.sshService.exec.mock.calls[0][0]).toContain('"state":"restarted"')
        })
    })

    describe('runPlaybook', () => {
        it('throws when controls_install_path missing', async () => {
            node.settings = { stereum_settings: { settings: {} } }
            await expect(node.runPlaybook('manage-service')).rejects.toThrow(/controls_install_path/)
        })
        it('fetches settings if not loaded', async () => {
            node.sshService.exec
                .mockResolvedValueOnce(ok('stereum_settings:\n  settings:\n    controls_install_path: /opt/stereum'))
                .mockResolvedValueOnce(ok('done'))
            await node.runPlaybook('update-services')
            expect(node.sshService.exec).toHaveBeenCalledTimes(2)
        })
        it('builds an ansible-playbook command with extra-vars and the controls path', async () => {
            node.settings = { stereum_settings: { settings: { controls_install_path: '/opt/stereum' } } }
            node.sshService.exec.mockResolvedValueOnce(ok('done'))
            await node.runPlaybook('update-services', { foo: 'bar' })
            const cmd = node.sshService.exec.mock.calls[0][0]
            expect(cmd).toContain('ansible-playbook')
            expect(cmd).toContain('/opt/stereum/ansible/controls/genericPlaybook.yaml')
            expect(cmd).toContain('--extra-vars')
            expect(cmd).toContain('"stereum_role":"update-services"')
            expect(cmd).toContain('"foo":"bar"')
        })
        it('escapes single quotes in extra-vars', async () => {
            node.settings = { stereum_settings: { settings: { controls_install_path: '/opt/stereum' } } }
            node.sshService.exec.mockResolvedValueOnce(ok('done'))
            await node.runPlaybook('manage-service', { x: "it's broken" })
            const cmd = node.sshService.exec.mock.calls[0][0]
            // Single quotes inside the JSON must be escaped using the '"'"' trick
            expect(cmd).toContain(`'"'"'`)
        })
        it('uses sudo (useSudo=true) for the exec call', async () => {
            node.settings = { stereum_settings: { settings: { controls_install_path: '/opt/stereum' } } }
            node.sshService.exec.mockResolvedValueOnce(ok('done'))
            await node.runPlaybook('manage-service')
            expect(node.sshService.exec.mock.calls[0][1]).toBe(true)
        })
        it('treats rc=null as success (e.g. signal termination ignored)', async () => {
            node.settings = { stereum_settings: { settings: { controls_install_path: '/opt/stereum' } } }
            node.sshService.exec.mockResolvedValueOnce({ rc: null, stdout: 'fine', stderr: '' })
            await expect(node.runPlaybook('manage-service')).resolves.toBeDefined()
        })
        it('throws on rc != 0', async () => {
            node.settings = { stereum_settings: { settings: { controls_install_path: '/opt/stereum' } } }
            node.sshService.exec.mockResolvedValueOnce({ rc: 2, stdout: '', stderr: 'fail' })
            await expect(node.runPlaybook('manage-service')).rejects.toThrow('fail')
        })
    })

    describe('disconnect', () => {
        it('delegates to sshService.disconnect', () => {
            node.disconnect()
            expect(node.sshService.disconnect).toHaveBeenCalledTimes(1)
        })
    })

    describe('reconnect', () => {
        it('delegates to sshService.reconnect and returns its result', async () => {
            node.sshService.reconnect.mockResolvedValueOnce(true)
            const r = await node.reconnect()
            expect(r).toBe(true)
            expect(node.sshService.reconnect).toHaveBeenCalledTimes(1)
        })
    })

    describe('fetchControlsCommit', () => {
        beforeEach(() => {
            node.settings = { stereum_settings: { settings: { controls_install_path: '/opt/stereum' } } }
        })
        it('runs git rev-parse HEAD against <controls>/ansible and returns the trimmed commit', async () => {
            node.sshService.exec.mockResolvedValueOnce(ok('  deadbeef0123456789abcdef0123456789abcdef\n'))
            const c = await node.fetchControlsCommit()
            expect(c).toBe('deadbeef0123456789abcdef0123456789abcdef')
            const cmd = node.sshService.exec.mock.calls[0][0]
            expect(cmd).toContain('/opt/stereum/ansible')
            expect(cmd).toContain('rev-parse HEAD')
            // Fallback to bare controls path is part of the same command
            expect(cmd).toContain('/opt/stereum')
        })
        it('lazy-loads settings when not yet fetched', async () => {
            node.settings = null
            node.sshService.exec
                .mockResolvedValueOnce(ok('stereum_settings:\n  settings:\n    controls_install_path: /opt/stereum'))
                .mockResolvedValueOnce(ok('abc123'))
            const c = await node.fetchControlsCommit()
            expect(c).toBe('abc123')
            expect(node.sshService.exec).toHaveBeenCalledTimes(2)
        })
        it('throws when controls_install_path is missing', async () => {
            node.settings = { stereum_settings: { settings: {} } }
            await expect(node.fetchControlsCommit()).rejects.toThrow(/controls_install_path/)
        })
        it('throws when the repo cannot be read (empty stdout)', async () => {
            node.sshService.exec.mockResolvedValueOnce(ok(''))
            await expect(node.fetchControlsCommit()).rejects.toThrow(/not a git checkout/)
        })
        it('throws on non-zero rc with stderr', async () => {
            node.sshService.exec.mockResolvedValueOnce(fail('not a repo'))
            await expect(node.fetchControlsCommit()).rejects.toThrow('not a repo')
        })
        it('treats rc=null with non-empty stdout as success (signal-terminated child still produced output)', async () => {
            node.sshService.exec.mockResolvedValueOnce({ rc: null, stdout: 'abc\n', stderr: '' })
            await expect(node.fetchControlsCommit()).resolves.toBe('abc')
        })
    })

    describe('fetchUpgradablePackages', () => {
        it('parses apt list --upgradable output into structured objects', async () => {
            const stdout = [
                'curl/jammy-updates 7.81.0-1ubuntu1.20 amd64 [upgradable from: 7.81.0-1ubuntu1.10]',
                'libssl3/jammy-security 3.0.2-0ubuntu1.18 amd64 [upgradable from: 3.0.2-0ubuntu1.15]',
            ].join('\n')
            node.sshService.exec.mockResolvedValueOnce(ok(stdout))
            const pkgs = await node.fetchUpgradablePackages()
            expect(pkgs).toEqual([
                { name: 'curl', newVersion: '7.81.0-1ubuntu1.20', currentVersion: '7.81.0-1ubuntu1.10' },
                { name: 'libssl3', newVersion: '3.0.2-0ubuntu1.18', currentVersion: '3.0.2-0ubuntu1.15' },
            ])
        })
        it('returns an empty array when nothing is upgradable', async () => {
            node.sshService.exec.mockResolvedValueOnce(ok(''))
            await expect(node.fetchUpgradablePackages()).resolves.toEqual([])
        })
        it('ignores lines that do not match the apt format (e.g. "Listing..." headers)', async () => {
            const stdout = [
                'Listing...',
                'random noise',
                'curl/jammy 1.0 amd64 [upgradable from: 0.9]',
            ].join('\n')
            node.sshService.exec.mockResolvedValueOnce(ok(stdout))
            const pkgs = await node.fetchUpgradablePackages()
            expect(pkgs).toEqual([{ name: 'curl', newVersion: '1.0', currentVersion: '0.9' }])
        })
        it('uses the apt list command via SSH (tail trims the Listing… header)', async () => {
            node.sshService.exec.mockResolvedValueOnce(ok(''))
            await node.fetchUpgradablePackages()
            const cmd = node.sshService.exec.mock.calls[0][0]
            expect(cmd).toContain('apt list --upgradable')
        })
        it('treats rc=null as success (apt sometimes signals exit on shutdown)', async () => {
            node.sshService.exec.mockResolvedValueOnce({ rc: null, stdout: '', stderr: '' })
            await expect(node.fetchUpgradablePackages()).resolves.toEqual([])
        })
        it('throws on non-zero rc with stderr', async () => {
            node.sshService.exec.mockResolvedValueOnce(fail('apt locked'))
            await expect(node.fetchUpgradablePackages()).rejects.toThrow('apt locked')
        })
    })

    describe('update playbook wrappers', () => {
        beforeEach(() => {
            node.settings = { stereum_settings: { settings: { controls_install_path: '/opt/stereum' } } }
            node.sshService.exec.mockResolvedValue(ok('done'))
        })

        it('updateOS runs update-os with no extra vars', async () => {
            await node.updateOS()
            const cmd = node.sshService.exec.mock.calls[0][0]
            expect(cmd).toContain('"stereum_role":"update-os"')
            // No stereum extras for OS update
            expect(cmd).not.toContain('"stereum":')
        })

        it('updateStereum runs update-stereum with no extra vars', async () => {
            await node.updateStereum()
            const cmd = node.sshService.exec.mock.calls[0][0]
            expect(cmd).toContain('"stereum_role":"update-stereum"')
            expect(cmd).not.toContain('"stereum":')
        })

        it('updatePackage passes stereum.update_package.name', async () => {
            await node.updatePackage('curl')
            const cmd = node.sshService.exec.mock.calls[0][0]
            expect(cmd).toContain('"stereum_role":"update-package"')
            expect(cmd).toContain('"update_package":{"name":"curl"}')
        })

        it('updateServices with no ids omits services_to_update entirely', async () => {
            await node.updateServices()
            const cmd = node.sshService.exec.mock.calls[0][0]
            expect(cmd).toContain('"stereum_role":"update-services"')
            expect(cmd).not.toContain('services_to_update')
        })

        it('updateServices with empty array also omits services_to_update', async () => {
            await node.updateServices([])
            const cmd = node.sshService.exec.mock.calls[0][0]
            expect(cmd).not.toContain('services_to_update')
        })

        it('updateServices with ids forwards them as services_to_update', async () => {
            await node.updateServices(['svc-a', 'svc-b'])
            const cmd = node.sshService.exec.mock.calls[0][0]
            expect(cmd).toContain('"update_services":{"services_to_update":["svc-a","svc-b"]}')
        })
    })

    describe('toDTO status field', () => {
        it('includes the current status in the full DTO', async () => {
            node._setStatus('connected')
            node.sshService.exec.mockImplementation((cmd) => {
                if (cmd.includes('stereum.yaml')) return Promise.resolve({ rc: 0, stdout: 'a: 1', stderr: '' })
                if (cmd.startsWith('ls')) return Promise.resolve({ rc: 0, stdout: '', stderr: '' })
                if (cmd.startsWith('docker')) return Promise.resolve({ rc: 0, stdout: '', stderr: '' })
                return Promise.resolve({ rc: 0, stdout: '', stderr: '' })
            })
            const dto = await node.toDTO()
            expect(dto.status).toBe('connected')
        })
    })
})
