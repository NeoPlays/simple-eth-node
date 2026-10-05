import { describe, it, expect } from 'vitest'
import { DUTY_KEYS, hasDuty, countDuties, matchesDutyChips, allProposals } from '@renderer/utils/validatorDutyFilter'

const row = (index, duty) => ({ pubkey: `0x${index}`, index, duty })
const NONE = { syncCurrent: false, syncNext: false, proposals: [] }

const ROWS = [
    row(1, { syncCurrent: true, syncNext: false, proposals: [] }),
    row(2, { syncCurrent: true, syncNext: true, proposals: [{ slot: 400, time: 4000 }] }),
    row(3, NONE),
    row(4, null),                                                  // no on-chain index yet
    row(5, { syncCurrent: false, syncNext: false, proposals: [{ slot: 100, time: 1000 }, { slot: 300, time: 3000 }] }),
]

describe('hasDuty', () => {
    it('reads each duty off the row', () => {
        expect(hasDuty(ROWS[0], 'dutySync')).toBe(true)
        expect(hasDuty(ROWS[0], 'dutySyncNext')).toBe(false)
        expect(hasDuty(ROWS[4], 'dutyPropose')).toBe(true)
    })
    it('treats a key with no beacon state as having no duty', () => {
        for (const k of DUTY_KEYS) expect(hasDuty(ROWS[3], k)).toBe(false)
    })
    it('never matches an unknown chip key', () => {
        expect(hasDuty(ROWS[1], 'dutyNonsense')).toBe(false)
    })
})

describe('countDuties', () => {
    it('counts each duty across every row', () => {
        expect(countDuties(ROWS)).toEqual({ dutyPropose: 2, dutySync: 2, dutySyncNext: 1 })
    })
    it('counts a validator with two slots in one epoch once', () => {
        expect(countDuties([ROWS[4]]).dutyPropose).toBe(1)
    })
    it('is all zeroes for no rows', () => {
        expect(countDuties()).toEqual({ dutyPropose: 0, dutySync: 0, dutySyncNext: 0 })
    })
})

describe('matchesDutyChips', () => {
    it('lets every row through when no duty chip is on', () => {
        expect(ROWS.every((r) => matchesDutyChips(r, { cred01: true }))).toBe(true)
    })
    it('filters to exactly the rows the count promised', () => {
        for (const [key, expected] of Object.entries(countDuties(ROWS))) {
            expect(ROWS.filter((r) => matchesDutyChips(r, { [key]: true })).length).toBe(expected)
        }
    })
    it('ANDs several duty chips together', () => {
        const both = ROWS.filter((r) => matchesDutyChips(r, { dutySync: true, dutySyncNext: true }))
        expect(both.map((r) => r.index)).toEqual([2])
    })
    it('yields nothing when chips cannot co-occur on any row', () => {
        expect(ROWS.filter((r) => matchesDutyChips(r, { dutyPropose: true, dutySync: true })).map((r) => r.index)).toEqual([2])
    })
})

describe('allProposals', () => {
    it('flattens every proposal in slot order, tagged with its validator', () => {
        expect(allProposals(ROWS)).toEqual([
            { slot: 100, time: 1000, index: 5 },
            { slot: 300, time: 3000, index: 5 },
            { slot: 400, time: 4000, index: 2 },
        ])
    })
    it('is empty when nothing is scheduled', () => {
        expect(allProposals([ROWS[2], ROWS[3]])).toEqual([])
    })
})
