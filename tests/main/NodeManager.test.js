import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NodeManager } from '@main/nodes/NodeManager'

function makeNode(id, overrides = {}) {
    return {
        id,
        disconnect: vi.fn(),
        toListDTO: vi.fn(() => ({ id, name: `n-${id}`, host: 'h', connected: false })),
        toDTO: vi.fn(() => Promise.resolve({ id, services: [] })),
        ...overrides,
    }
}

describe('NodeManager', () => {
    let mgr
    beforeEach(() => { mgr = new NodeManager() })

    it('starts with no nodes', () => {
        expect(mgr.nodes).toEqual([])
        expect(mgr.getAllNodes()).toEqual([])
    })

    it('addNode appends', () => {
        const n = makeNode('a')
        mgr.addNode(n)
        expect(mgr.nodes).toHaveLength(1)
        expect(mgr.nodes[0]).toBe(n)
    })

    it('findNode returns the node by id', () => {
        const a = makeNode('a'), b = makeNode('b')
        mgr.addNode(a); mgr.addNode(b)
        expect(mgr.findNode('b')).toBe(b)
    })

    it('findNode returns null for unknown id', () => {
        expect(mgr.findNode('missing')).toBeNull()
    })

    it('removeNode removes by id and leaves others', () => {
        mgr.addNode(makeNode('a'))
        mgr.addNode(makeNode('b'))
        mgr.removeNode('a')
        expect(mgr.nodes).toHaveLength(1)
        expect(mgr.nodes[0].id).toBe('b')
    })

    it('removeNode is a no-op for unknown id', () => {
        mgr.addNode(makeNode('a'))
        mgr.removeNode('missing')
        expect(mgr.nodes).toHaveLength(1)
    })

    it('disconnectNode calls node.disconnect then removes it', () => {
        const a = makeNode('a')
        mgr.addNode(a)
        mgr.disconnectNode('a')
        expect(a.disconnect).toHaveBeenCalledTimes(1)
        expect(mgr.findNode('a')).toBeNull()
    })

    it('disconnectNode tolerates unknown id without throwing', () => {
        expect(() => mgr.disconnectNode('missing')).not.toThrow()
    })

    it('getAllNodes maps via toListDTO', () => {
        const a = makeNode('a'), b = makeNode('b')
        mgr.addNode(a); mgr.addNode(b)
        const list = mgr.getAllNodes()
        expect(list).toEqual([
            { id: 'a', name: 'n-a', host: 'h', connected: false },
            { id: 'b', name: 'n-b', host: 'h', connected: false },
        ])
        expect(a.toListDTO).toHaveBeenCalled()
    })

    it('getNode delegates to node.toDTO when found', async () => {
        const a = makeNode('a')
        mgr.addNode(a)
        const dto = await mgr.getNode('a')
        expect(dto).toEqual({ id: 'a', services: [] })
        expect(a.toDTO).toHaveBeenCalled()
    })

    it('getNode returns null for unknown id', () => {
        expect(mgr.getNode('missing')).toBeNull()
    })
})
