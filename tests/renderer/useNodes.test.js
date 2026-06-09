import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useNodesStore } from '@stores/useNodes'

describe('useNodesStore', () => {
    let invoke
    beforeEach(() => {
        setActivePinia(createPinia())
        invoke = vi.fn()
        globalThis.window = { api: { invoke } }
    })

    it('refreshNodes populates state.nodes from get-all-nodes', async () => {
        invoke.mockResolvedValueOnce([{ id: 'a' }, { id: 'b' }])
        const s = useNodesStore()
        await s.refreshNodes()
        expect(invoke).toHaveBeenCalledWith('get-all-nodes')
        expect(s.nodes).toEqual([{ id: 'a' }, { id: 'b' }])
    })

    it('refreshNodes swallows errors (logs only, no throw)', async () => {
        const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
        invoke.mockRejectedValueOnce(new Error('boom'))
        const s = useNodesStore()
        await expect(s.refreshNodes()).resolves.toBeUndefined()
        expect(s.nodes).toEqual([])
        errSpy.mockRestore()
    })

    it('getNode caches result; second call does not hit IPC', async () => {
        invoke.mockResolvedValueOnce({ id: 'a', name: 'n' })
        const s = useNodesStore()
        const first = await s.getNode('a')
        const second = await s.getNode('a')
        expect(first).toEqual({ id: 'a', name: 'n' })
        expect(second).toEqual({ id: 'a', name: 'n' })
        expect(invoke).toHaveBeenCalledTimes(1)
    })

    it('refreshNode always fetches even when cached', async () => {
        invoke.mockResolvedValueOnce({ id: 'a', v: 1 }).mockResolvedValueOnce({ id: 'a', v: 2 })
        const s = useNodesStore()
        await s.getNode('a')
        const fresh = await s.refreshNode('a')
        expect(invoke).toHaveBeenCalledTimes(2)
        expect(fresh.v).toBe(2)
        expect(s.nodeCache['a'].v).toBe(2)
    })

    it('getNode returns null on error and does not cache', async () => {
        const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
        invoke.mockRejectedValueOnce(new Error('nope'))
        const s = useNodesStore()
        const res = await s.getNode('a')
        expect(res).toBeNull()
        expect(s.nodeCache['a']).toBeUndefined()
        errSpy.mockRestore()
    })

    it('disconnectNode removes from cache + node list', async () => {
        invoke.mockResolvedValue(undefined)
        const s = useNodesStore()
        s.nodes = [{ id: 'a' }, { id: 'b' }]
        s.nodeCache = { a: { id: 'a' }, b: { id: 'b' } }
        await s.disconnectNode('a')
        expect(s.nodes).toEqual([{ id: 'b' }])
        expect(s.nodeCache).toEqual({ b: { id: 'b' } })
        expect(invoke).toHaveBeenCalledWith('disconnect-node', 'a')
    })
})
