import { describe, it, expect, beforeEach, vi } from 'vitest'

const { handlers, fakeStorage, fakeNode, fakeNodeManager } = vi.hoisted(() => ({
    handlers: {},
    fakeStorage: {
        importFromStereum: vi.fn(() => ['server-list']),
        get: vi.fn(),
        set: vi.fn(),
    },
    fakeNode: {
        sshService: { connect: vi.fn() },
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
        disconnectNode: vi.fn(),
    },
}))

vi.mock('electron', () => ({
    ipcMain: {
        handle: vi.fn((channel, fn) => { handlers[channel] = fn }),
    },
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
        fakeNode.sshService.connect.mockResolvedValueOnce({ code: 0, message: 'ok' })
        const r = await handlers['ssh-login'](event, { host: 'h' })
        expect(r).toEqual({ code: 0, message: 'ok' })
        expect(fakeNodeManager.addNode).toHaveBeenCalledWith(fakeNode)
    })

    it('ssh-login returns code 1 and does not add node on failure', async () => {
        fakeNode.sshService.connect.mockRejectedValueOnce(new Error('refused'))
        const r = await handlers['ssh-login'](event, { host: 'h' })
        expect(r.code).toBe(1)
        expect(r.message).toBe('refused')
        expect(fakeNodeManager.addNode).not.toHaveBeenCalled()
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
