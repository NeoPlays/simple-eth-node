import { describe, it, expect } from 'vitest'
import {
    checkEpochs, buildOnchainCheckScript, parseOnchainCheck, rewardSignal, onchainVerdicts, summarizeVerdicts,
} from '@main/nodes/onchainCheck'

const section = (kind, epoch, body, code = 200) => `===OC===${kind}:${epoch}\n${body}\n===OC_HTTP===${code}\n`
const liveness = (rows) => JSON.stringify({ data: rows.map(([index, live]) => ({ index: String(index), is_live: live })) })
const rewards = (rows) => JSON.stringify({ data: { ideal_rewards: [], total_rewards: rows.map(([i, head, target, source]) => ({ validator_index: String(i), head: String(head), target: String(target), source: String(source), inactivity: '0' })) } })

describe('checkEpochs', () => {
    it('liveness for the current and previous epoch, rewards for the two before', () => {
        expect(checkEpochs(100)).toEqual({ liveness: [100, 99], rewards: [98, 97] })
        expect(checkEpochs(1)).toEqual({ liveness: [1, 0], rewards: [] })
        expect(checkEpochs(null)).toEqual({ liveness: [], rewards: [] })
    })
})

describe('buildOnchainCheckScript', () => {
    it('asks each route for each of its epochs with a bare index array', () => {
        const s = buildOnchainCheckScript('http://b:5052', { currentEpoch: 100, indices: [7, '8', 'x'] })
        expect(s).toContain(`'http://b:5052/eth/v1/validator/liveness/100'`)
        expect(s).toContain(`'http://b:5052/eth/v1/validator/liveness/99'`)
        expect(s).toContain(`'http://b:5052/eth/v1/beacon/rewards/attestations/98'`)
        expect(s).toContain(`'http://b:5052/eth/v1/beacon/rewards/attestations/97'`)
        expect(s).toContain(`-d '["7","8"]'`)
    })
    it('is null without a base, indices or epoch', () => {
        expect(buildOnchainCheckScript('', { currentEpoch: 1, indices: [1] })).toBeNull()
        expect(buildOnchainCheckScript('http://b', { currentEpoch: 1, indices: [] })).toBeNull()
        expect(buildOnchainCheckScript('http://b', { currentEpoch: null, indices: [1] })).toBeNull()
    })
})

describe('rewardSignal', () => {
    it('positive = voted, negative = missed, all zero = unclear (inactivity leak)', () => {
        expect(rewardSignal({ head: 2062, target: 3959, source: 2131 })).toBe('signed')
        expect(rewardSignal({ head: 0, target: -3959, source: -2131 })).toBe('missed')
        expect(rewardSignal({ head: 0, target: 0, source: 0 })).toBe('unclear')
        expect(rewardSignal(null)).toBe('unclear')
    })
})

describe('onchainVerdicts', () => {
    const A = '0xaa', B = '0xbb', C = '0xcc', D = '0xdd', E = '0xee'
    const states = {
        [A]: { index: 1, status: 'Active' },
        [B]: { index: 2, status: 'Active' },
        [C]: { index: 3, status: 'Active' },
        [D]: { index: 4, status: 'Pending' },
    }
    const epochs = checkEpochs(100)

    it('flags a key active in any checked epoch, by either route', () => {
        const parsed = parseOnchainCheck(
            section('liveness', 100, liveness([[1, false], [2, false], [3, false]])) +
            section('liveness', 99, liveness([[1, true], [2, false], [3, false]])) +
            section('rewards', 98, rewards([[1, 1, 1, 1], [2, 0, -5, -3], [3, 10, 20, 10]])) +
            section('rewards', 97, rewards([[1, 1, 1, 1], [2, 0, -5, -3], [3, 0, -5, -3]])),
        )
        const r = onchainVerdicts([A, B, C, D, E], states, parsed, epochs)
        expect(r[A]).toMatchObject({ verdict: 'active', signedIn: [99, 98, 97] })
        expect(r[B]).toMatchObject({ verdict: 'inactive', signedIn: [], uncheckedEpochs: [] })
        expect(r[C]).toMatchObject({ verdict: 'active', signedIn: [98] })
        expect(r[D].verdict).toBe('pending')
        expect(r[E].verdict).toBe('not-on-chain')
        expect(summarizeVerdicts(r)).toEqual({ active: 2, inactive: 1, 'deposit-queued': 0, 'not-on-chain': 1, pending: 1, unknown: 0 })
    })

    it('tells a queued deposit apart from a key with no deposit at all', () => {
        const queued = { '0xq': { index: null, status: 'Pending', rawStatus: 'deposit_queued', depositQueue: { position: 913, length: 942 } } }
        expect(onchainVerdicts(['0xq'], queued, parseOnchainCheck(''), epochs)['0xq']).toMatchObject({ verdict: 'deposit-queued', depositQueue: { position: 913 } })
    })

    it('never reads a failed epoch as "did not sign"', () => {
        const parsed = parseOnchainCheck(
            section('liveness', 100, liveness([[2, false]])) +
            section('liveness', 99, '{"code":400}', 400) +
            section('rewards', 98, rewards([[2, 0, -5, -3]])) +
            section('rewards', 97, '{"code":404}', 404),
        )
        const r = onchainVerdicts([B], states, parsed, epochs)
        expect(r[B]).toMatchObject({ verdict: 'unknown', uncheckedEpochs: [99, 97] })
    })

    it('reads all-zero rewards of an exited validator as idle', () => {
        const parsed = parseOnchainCheck(
            section('liveness', 100, liveness([[9, false]])) +
            section('liveness', 99, liveness([[9, false]])) +
            section('rewards', 98, rewards([[9, 0, 0, 0]])) +
            section('rewards', 97, rewards([[9, 0, 0, 0]])),
        )
        expect(onchainVerdicts(['0x99'], { '0x99': { index: 9, status: 'Exited' } }, parsed, epochs)['0x99'].verdict).toBe('inactive')
    })

    it('treats an all-zero reward as unchecked, not as missed', () => {
        const parsed = parseOnchainCheck(
            section('liveness', 100, liveness([[2, false]])) +
            section('liveness', 99, liveness([[2, false]])) +
            section('rewards', 98, rewards([[2, 0, 0, 0]])) +
            section('rewards', 97, rewards([[2, 0, -1, -1]])),
        )
        expect(onchainVerdicts([B], states, parsed, epochs)[B]).toMatchObject({ verdict: 'unknown', uncheckedEpochs: [98] })
    })
})
