import { describe, it, expect, beforeEach, vi } from 'vitest'

const { handlers, fakeStorage, fakeNode, fakeNodeManager, fakeWindow, fakeBrowserWindow } = vi.hoisted(() => {
    const send = vi.fn()
    const fakeWindow = { webContents: { send } }
    return {
        handlers: {},
        fakeStorage: {
            importFromStereum: vi.fn(() => ['server-list']),
            get: vi.fn(),
            set: vi.fn(),
        },
        fakeNode: {
            id: 'node-id',
            sshService: { connect: vi.fn() },
            onStatusChange: vi.fn(),
            reconnect: vi.fn(),
            startService: vi.fn(),
            stopService: vi.fn(),
            restartService: vi.fn(),
            fetchContainerStatuses: vi.fn(),
            fetchRawServiceConfig: vi.fn(),
            writeServiceConfig: vi.fn(),
        },
        fakeNodeManager: {
            addNode: vi.fn(),
            getAllNodes: vi.fn(),
            getNode: vi.fn(),
            findNode: vi.fn(),
            findNodeByEndpoint: vi.fn(),
            disconnectNode: vi.fn(),
        },
        fakeWindow,
        fakeBrowserWindow: { getAllWindows: vi.fn(() => [fakeWindow]) },
    }
})

vi.mock('electron', () => ({
    ipcMain: {
        handle: vi.fn((channel, fn) => { handlers[channel] = fn }),
    },
    BrowserWindow: fakeBrowserWindow,
}))
vi.mock('@main/store/StoreService', () => ({ default: fakeStorage }))
vi.mock('@main/nodes/Node', () => ({ Node: function FakeNodeCtor() { return fakeNode } }))
vi.mock('@main/nodes/NodeManager', () => ({ default: fakeNodeManager }))

vi.mock('electron-log', () => ({ default: { debug: vi.fn(), info: vi.fn(), error: vi.fn(), warn: vi.fn() } }))

import { initializeIpcHandlers } from '@main/ipcHandlers'

const event = {} // first arg passed to handlers by electron

describe('ipcHandlers', () => {
    beforeEach(() => {
        for (const k of Object.keys(handlers)) delete handlers[k]
        vi.clearAllMocks()
        initializeIpcHandlers()
    })

    it('registers all expected channels', () => {
        expect(Object.keys(handlers).sort()).toEqual([
            'disconnect-node',
            'get-all-nodes',
            'get-container-statuses',
            'get-node',
            'get-raw-service-config',
            'import-server-from-stereum',
            'ping',
            'reconnect-node',
            'restart-service',
            'ssh-login',
            'start-service',
            'stop-service',
            'store-get',
            'store-set',
            'write-service-config',
        ])
    })

    it('store-get/store-set forward to storage', async () => {
        fakeStorage.get.mockReturnValueOnce('value')
        expect(await handlers['store-get'](event, 'k')).toBe('value')
        expect(fakeStorage.get).toHaveBeenCalledWith('k')

        await handlers['store-set'](event, 'k', 'v')
        expect(fakeStorage.set).toHaveBeenCalledWith('k', 'v')
    })

    it('import-server-from-stereum returns storage result', async () => {
        const r = await handlers['import-server-from-stereum'](event)
        expect(r).toEqual(['server-list'])
    })

    it('ssh-login connects and adds node on success', async () => {
        fakeNodeManager.findNodeByEndpoint.mockReturnValueOnce(null)
        fakeNode.sshService.connect.mockResolvedValueOnce({ code: 0, message: 'ok' })
        const r = await handlers['ssh-login'](event, { host: 'h', port: 22, username: 'u' })
        expect(r).toEqual({ code: 0, message: 'ok' })
        expect(fakeNodeManager.addNode).toHaveBeenCalledWith(fakeNode)
    })

    it('ssh-login returns code 1 and does not add node on failure', async () => {
        fakeNodeManager.findNodeByEndpoint.mockReturnValueOnce(null)
        fakeNode.sshService.connect.mockRejectedValueOnce(new Error('refused'))
        const r = await handlers['ssh-login'](event, { host: 'h', port: 22, username: 'u' })
        expect(r.code).toBe(1)
        expect(r.message).toBe('refused')
        expect(fakeNodeManager.addNode).not.toHaveBeenCalled()
    })

    it('ssh-login returns code 2 and does not create a new node when endpoint is already connected', async () => {
        fakeNodeManager.findNodeByEndpoint.mockReturnValueOnce({ id: 'existing' })
        const r = await handlers['ssh-login'](event, { host: '1.1.1.1', port: 22, username: 'root' })
        expect(r.code).toBe(2)
        expect(r.nodeId).toBe('existing')
        expect(r.message).toMatch(/already connected/i)
        expect(fakeNode.sshService.connect).not.toHaveBeenCalled()
        expect(fakeNodeManager.addNode).not.toHaveBeenCalled()
    })

    it('ssh-login subscribes onStatusChange and broadcasts node-status-changed to all windows', async () => {
        fakeNodeManager.findNodeByEndpoint.mockReturnValueOnce(null)
        fakeNode.sshService.connect.mockResolvedValueOnce({ code: 0 })
        await handlers['ssh-login'](event, { host: 'h', port: 22, username: 'u' })
        expect(fakeNode.onStatusChange).toHaveBeenCalledTimes(1)
        // Invoke the registered callback as if SSHService emitted a state change
        const cb = fakeNode.onStatusChange.mock.calls[0][0]
        cb('reconnecting')
        expect(fakeBrowserWindow.getAllWindows).toHaveBeenCalled()
        expect(fakeWindow.webContents.send).toHaveBeenCalledWith('node-status-changed', { id: fakeNode.id, status: 'reconnecting' })
    })

    it('reconnect-node delegates to node.reconnect() and returns its result', async () => {
        fakeNodeManager.findNode.mockReturnValueOnce(fakeNode)
        fakeNode.reconnect.mockResolvedValueOnce(true)
        const r = await handlers['reconnect-node'](event, 'node-id')
        expect(r).toBe(true)
        expect(fakeNode.reconnect).toHaveBeenCalledTimes(1)
    })

    it('reconnect-node returns false when node missing', async () => {
        fakeNodeManager.findNode.mockReturnValueOnce(null)
        const r = await handlers['reconnect-node'](event, 'missing')
        expect(r).toBe(false)
    })

    it('reconnect-node returns false when reconnect throws', async () => {
        fakeNodeManager.findNode.mockReturnValueOnce(fakeNode)
        fakeNode.reconnect.mockRejectedValueOnce(new Error('boom'))
        const r = await handlers['reconnect-node'](event, 'node-id')
        expect(r).toBe(false)
    })

    it('get-all-nodes delegates to nodeManager', async () => {
        fakeNodeManager.getAllNodes.mockReturnValueOnce([{ id: 'a' }])
        expect(await handlers['get-all-nodes'](event)).toEqual([{ id: 'a' }])
    })

    it('get-node delegates and propagates errors', async () => {
        fakeNodeManager.getNode.mockResolvedValueOnce({ id: 'a' })
        expect(await handlers['get-node'](event, 'a')).toEqual({ id: 'a' })

        fakeNodeManager.getNode.mockRejectedValueOnce(new Error('bad'))
        await expect(handlers['get-node'](event, 'a')).rejects.toThrow('bad')
    })

    it('disconnect-node delegates and swallows errors', async () => {
        await handlers['disconnect-node'](event, 'a')
        expect(fakeNodeManager.disconnectNode).toHaveBeenCalledWith('a')

        fakeNodeManager.disconnectNode.mockImplementationOnce(() => { throw new Error('x') })
        await expect(handlers['disconnect-node'](event, 'a')).resolves.toBeUndefined()
    })

    describe('service lifecycle handlers', () => {
        const cases = [
            ['start-service', 'startService'],
            ['stop-service', 'stopService'],
            ['restart-service', 'restartService'],
        ]
        for (const [channel, method] of cases) {
            it(`${channel} routes to node.${method}`, async () => {
                fakeNodeManager.findNode.mockReturnValueOnce(fakeNode)
                fakeNode[method].mockResolvedValueOnce('done')
                expect(await handlers[channel](event, 'n', 's')).toBe('done')
                expect(fakeNode[method]).toHaveBeenCalledWith('s')
            })

            it(`${channel} throws when node is missing`, async () => {
                fakeNodeManager.findNode.mockReturnValueOnce(null)
                await expect(handlers[channel](event, 'n', 's')).rejects.toThrow('Node not found')
            })

            it(`${channel} re-throws errors from the node method`, async () => {
                fakeNodeManager.findNode.mockReturnValueOnce(fakeNode)
                fakeNode[method].mockRejectedValueOnce(new Error('fail'))
                await expect(handlers[channel](event, 'n', 's')).rejects.toThrow('fail')
            })
        }
    })

    it('get-container-statuses delegates / errors when missing', async () => {
        fakeNodeManager.findNode.mockReturnValueOnce(fakeNode)
        fakeNode.fetchContainerStatuses.mockResolvedValueOnce({ a: { state: 'running' } })
        expect(await handlers['get-container-statuses'](event, 'n')).toEqual({ a: { state: 'running' } })

        fakeNodeManager.findNode.mockReturnValueOnce(null)
        await expect(handlers['get-container-statuses'](event, 'n')).rejects.toThrow('Node not found')
    })

    it('get-raw-service-config delegates / errors when missing', async () => {
        fakeNodeManager.findNode.mockReturnValueOnce(fakeNode)
        fakeNode.fetchRawServiceConfig.mockResolvedValueOnce('yaml')
        expect(await handlers['get-raw-service-config'](event, 'n', 's')).toBe('yaml')

        fakeNodeManager.findNode.mockReturnValueOnce(null)
        await expect(handlers['get-raw-service-config'](event, 'n', 's')).rejects.toThrow('Node not found')
    })

    it('write-service-config delegates / errors when missing', async () => {
        fakeNodeManager.findNode.mockReturnValueOnce(fakeNode)
        await handlers['write-service-config'](event, 'n', 's', 'content')
        expect(fakeNode.writeServiceConfig).toHaveBeenCalledWith('s', 'content')

        fakeNodeManager.findNode.mockReturnValueOnce(null)
        await expect(handlers['write-service-config'](event, 'n', 's', 'c')).rejects.toThrow('Node not found')
    })
})
