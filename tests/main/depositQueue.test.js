import { describe, it, expect } from 'vitest'
import { buildDepositQueueScript, parseDepositQueue, depositEta, depositQueuedState, DEPOSIT_SPEC_DEFAULTS } from '@main/nodes/depositQueue'

const KEY = '0xacc0bc99c5c5c503d7938588b880bfc0b3e5b659403c415a30fa0d93175c368620ce489505643d16bf69db582d0e8245'
// Captured from a hoodi Prysm beacon: the key sits at #913 of 942 in pending_deposits.
const HOODI = `===DQ_HTTP===200
MATCH 0xacc0bc99c5c5c503d7938588b880bfc0b3e5b659403c415a30fa0d93175c368620ce489505643d16bf69db582d0e8245 913 32000000000 4110760 2058500000000
TOTAL 942 3270500000000
===DQ_SPEC===
"MAX_PENDING_DEPOSITS_PER_EPOCH":"16"
"MAX_PER_EPOCH_ACTIVATION_EXIT_CHURN_LIMIT":"256000000000"
"SECONDS_PER_SLOT":"12"
"SLOTS_PER_EPOCH":"32"`

describe('buildDepositQueueScript', () => {
    it('fetches the queue to a file, filters it to the wanted keys, and reads the spec', () => {
        const s = buildDepositQueueScript('http://b:3500', [KEY.toUpperCase().replace('0X', '0x'), 'nope'])
        expect(s).toContain("'http://b:3500/eth/v1/beacon/states/head/pending_deposits'")
        expect(s).toContain(`want='${KEY}'`)
        expect(s).toContain('MAX_PENDING_DEPOSITS_PER_EPOCH')
        expect(buildDepositQueueScript('http://b', ['0x12'])).toBeNull()
        expect(buildDepositQueueScript('', [KEY])).toBeNull()
    })
})

describe('parseDepositQueue', () => {
    it('reads position, amount, what is ahead, the totals and the spec', () => {
        const q = parseDepositQueue(HOODI)
        expect(q.ok).toBe(true)
        expect(q.length).toBe(942)
        expect(q.totalGwei).toBe(3270500000000)
        expect(q.matches[KEY]).toEqual({ position: 913, amountGwei: 32000000000, slot: 4110760, aheadGwei: 2058500000000 })
        expect(q.spec).toEqual({ maxChurnGwei: 256000000000, maxDepositsPerEpoch: 16, secondsPerSlot: 12, slotsPerEpoch: 32 })
    })
    it('is not ok when the route did not answer (pre-Electra or old beacon)', () => {
        const q = parseDepositQueue('===DQ_HTTP===404\nTOTAL 0 0\n===DQ_SPEC===\n')
        expect(q.ok).toBe(false)
        expect(q.spec).toEqual(DEPOSIT_SPEC_DEFAULTS)
    })
})

describe('depositEta', () => {
    it('drains at whichever per-epoch limit binds: here the 16-deposit cap', () => {
        // 2090.5 ETH would take 9 epochs at 256 ETH/epoch, but 913 deposits at 16/epoch take 58.
        expect(depositEta({ position: 913, aheadGwei: 2058.5e9, amountGwei: 32e9 })).toEqual({ epochs: 58, seconds: 58 * 32 * 12 })
    })
    it('and at the balance churn for large deposits', () => {
        expect(depositEta({ position: 10, aheadGwei: 2048e9 * 9, amountGwei: 2048e9 }).epochs).toBe(80)
    })
})

describe('depositQueuedState', () => {
    it('looks like a pending validator with no index, carrying its queue position', () => {
        const q = parseDepositQueue(HOODI)
        const s = depositQueuedState(KEY, q.matches[KEY], q)
        expect(s).toMatchObject({ index: null, status: 'Pending', rawStatus: 'deposit_queued' })
        expect(s.depositQueue).toMatchObject({ position: 913, length: 942, amountEth: 32, aheadEth: 2058.5, etaEpochs: 58 })
    })
})
