import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NodeManager } from '@main/nodes/NodeManager'

function makeNode(id, overrides = {}) {
    return {
        id,
        sshService: { SSHParams: { host: 'h', port: 22, username: 'u' } },
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

    describe('findNodeByEndpoint', () => {
        it('matches on host+port+username', () => {
            mgr.addNode(makeNode('a', { sshService: { SSHParams: { host: '1.1.1.1', port: 22, username: 'root' } } }))
            mgr.addNode(makeNode('b', { sshService: { SSHParams: { host: '2.2.2.2', port: 22, username: 'root' } } }))
            const found = mgr.findNodeByEndpoint('2.2.2.2', 22, 'root')
            expect(found.id).toBe('b')
        })

        it('returns null when no node matches', () => {
            mgr.addNode(makeNode('a', { sshService: { SSHParams: { host: '1.1.1.1', port: 22, username: 'root' } } }))
            expect(mgr.findNodeByEndpoint('9.9.9.9', 22, 'root')).toBeNull()
        })

        it('distinguishes by port (same host, different port)', () => {
            mgr.addNode(makeNode('a', { sshService: { SSHParams: { host: 'h', port: 22, username: 'u' } } }))
            mgr.addNode(makeNode('b', { sshService: { SSHParams: { host: 'h', port: 2222, username: 'u' } } }))
            expect(mgr.findNodeByEndpoint('h', 2222, 'u').id).toBe('b')
            expect(mgr.findNodeByEndpoint('h', 22, 'u').id).toBe('a')
        })

        it('distinguishes by username (same host+port, different user)', () => {
            mgr.addNode(makeNode('a', { sshService: { SSHParams: { host: 'h', port: 22, username: 'root' } } }))
            mgr.addNode(makeNode('b', { sshService: { SSHParams: { host: 'h', port: 22, username: 'admin' } } }))
            expect(mgr.findNodeByEndpoint('h', 22, 'admin').id).toBe('b')
        })
    })
})
