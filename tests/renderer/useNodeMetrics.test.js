import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useNodeMetrics } from '@renderer/composables/useNodeMetrics'

describe('useNodeMetrics', () => {
    let invoke
    beforeEach(() => {
        vi.useFakeTimers()
        invoke = vi.fn().mockResolvedValue({})
        globalThis.window = { api: { invoke } }
    })
    afterEach(() => {
        vi.useRealTimers()
    })

    const sysCalls = () => invoke.mock.calls.filter((c) => c[0] === 'get-system-metrics').length
    const diskCalls = () => invoke.mock.calls.filter((c) => c[0] === 'get-disk-usage').length

    it('fetches both channels immediately on start and stores the results', async () => {
        invoke.mockImplementation((ch) =>
            Promise.resolve(ch === 'get-system-metrics' ? { cpu: { usagePct: 10 } } : { 'svc-1': { peers: 5 } })
        )
        const m = useNodeMetrics('node-1')
        m.start()
        await vi.advanceTimersByTimeAsync(0)

        expect(invoke).toHaveBeenCalledWith('get-system-metrics', 'node-1')
        expect(invoke).toHaveBeenCalledWith('get-client-metrics', 'node-1')
        expect(m.system.value).toEqual({ cpu: { usagePct: 10 } })
        expect(m.clients.value).toEqual({ 'svc-1': { peers: 5 } })
        expect(m.loading.value).toBe(false)
    })

    it('carries the last inbound/outbound split over a few splitless polls, then lets it go', async () => {
        // The split drops out on its own whenever the peer listing disagrees with peer_count,
        // so it has to survive a miss independently of the (still present) total.
        const ticks = [
            { 'svc-1': { peers: 64, peersIn: 48, peersOut: 16 } },
            { 'svc-1': { peers: 64 } },
            { 'svc-1': { peers: 64 } },
            { 'svc-1': { peers: 64 } },
            { 'svc-1': { peers: 64 } }, // 4th miss - past PEER_MISS_LIMIT
        ]
        let i = 0
        invoke.mockImplementation((ch) => Promise.resolve(ch === 'get-client-metrics' ? ticks[i++] : {}))
        const m = useNodeMetrics('n', { intervalMs: 5000 })
        m.start()
        await vi.advanceTimersByTimeAsync(0)
        expect(m.clients.value['svc-1']).toMatchObject({ peersIn: 48, peersOut: 16 })
        for (let t = 0; t < 3; t++) await vi.advanceTimersByTimeAsync(5000)
        expect(m.clients.value['svc-1']).toMatchObject({ peers: 64, peersIn: 48, peersOut: 16 })
        await vi.advanceTimersByTimeAsync(5000)
        expect(m.clients.value['svc-1'].peers).toBe(64) // total never lapsed
        expect(m.clients.value['svc-1'].peersIn).toBeUndefined()
        m.stop()
    })

    it('keeps carrying the total when only the peer count is missing', async () => {
        const ticks = [{ 'svc-1': { peers: 12, peersIn: 8, peersOut: 4 } }, { 'svc-1': {} }]
        let i = 0
        invoke.mockImplementation((ch) => Promise.resolve(ch === 'get-client-metrics' ? ticks[i++] : {}))
        const m = useNodeMetrics('n', { intervalMs: 5000 })
        m.start()
        await vi.advanceTimersByTimeAsync(0)
        await vi.advanceTimersByTimeAsync(5000)
        expect(m.clients.value['svc-1']).toMatchObject({ peers: 12, peersIn: 8, peersOut: 4 })
        m.stop()
    })

    it('resolves a ref-typed nodeId lazily on each call', async () => {
        let id = 'a'
        const m = useNodeMetrics(() => id)
        m.start()
        await vi.advanceTimersByTimeAsync(0)
        expect(invoke).toHaveBeenCalledWith('get-system-metrics', 'a')
        id = 'b'
        await vi.advanceTimersByTimeAsync(5000)
        expect(invoke).toHaveBeenCalledWith('get-system-metrics', 'b')
        m.stop()
    })

    it('polls on the interval and stops cleanly', async () => {
        const m = useNodeMetrics('n', { intervalMs: 5000 })
        m.start()
        await vi.advanceTimersByTimeAsync(0) // immediate
        expect(sysCalls()).toBe(1)
        await vi.advanceTimersByTimeAsync(5000) // tick 1
        expect(sysCalls()).toBe(2)
        m.stop()
        await vi.advanceTimersByTimeAsync(15000) // no more ticks
        expect(sysCalls()).toBe(2)
    })

    it('skips interval ticks while shouldPoll() is false (but not the initial fetch)', async () => {
        let ok = false
        const m = useNodeMetrics('n', { intervalMs: 5000, shouldPoll: () => ok })
        m.start()
        await vi.advanceTimersByTimeAsync(0)
        expect(sysCalls()).toBe(1) // initial refresh bypasses the guard
        await vi.advanceTimersByTimeAsync(10000)
        expect(sysCalls()).toBe(1) // guarded ticks skipped
        ok = true
        await vi.advanceTimersByTimeAsync(5000)
        expect(sysCalls()).toBe(2)
        m.stop()
    })

    it('does not overlap fetches while one is still in flight', async () => {
        let resolveSys
        invoke.mockImplementation((ch) =>
            ch === 'get-system-metrics' ? new Promise((r) => { resolveSys = r }) : Promise.resolve({})
        )
        const m = useNodeMetrics('n', { intervalMs: 1000, shouldPoll: () => true })
        m.start()
        await vi.advanceTimersByTimeAsync(0)
        await vi.advanceTimersByTimeAsync(3000) // several ticks while sys is pending
        expect(sysCalls()).toBe(1) // in-flight guard held
        resolveSys({ cpu: {} })
        await vi.advanceTimersByTimeAsync(1000) // next tick can fetch again
        expect(sysCalls()).toBe(2)
        m.stop()
    })

    it('polls disk on its own slower interval, not the fast health interval', async () => {
        const m = useNodeMetrics('n', { intervalMs: 5000, diskIntervalMs: 30000 })
        m.start()
        await vi.advanceTimersByTimeAsync(0)
        expect(sysCalls()).toBe(1)
        expect(diskCalls()).toBe(1) // fetched immediately alongside the others
        await vi.advanceTimersByTimeAsync(25000) // 5 fast ticks, no disk tick yet
        expect(sysCalls()).toBe(6)
        expect(diskCalls()).toBe(1)
        await vi.advanceTimersByTimeAsync(5000) // 30s reached
        expect(diskCalls()).toBe(2)
        m.stop()
    })

    it('stores disk usage and records disk errors independently', async () => {
        invoke.mockImplementation((ch) =>
            ch === 'get-disk-usage' ? Promise.reject(new Error('du timeout')) : Promise.resolve({ ok: true })
        )
        const m = useNodeMetrics('n')
        m.start()
        await vi.advanceTimersByTimeAsync(0)
        expect(m.diskError.value).toBe('du timeout')
        expect(m.systemError.value).toBeNull()
        m.stop()
    })

    it('records system and client errors independently', async () => {
        invoke.mockImplementation((ch) =>
            ch === 'get-system-metrics' ? Promise.reject(new Error('proc fail')) : Promise.resolve({ ok: true })
        )
        const m = useNodeMetrics('n')
        m.start()
        await vi.advanceTimersByTimeAsync(0)
        expect(m.systemError.value).toBe('proc fail')
        expect(m.clientsError.value).toBeNull()
        expect(m.clients.value).toEqual({ ok: true })
        m.stop()
    })
})
