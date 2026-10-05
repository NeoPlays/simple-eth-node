import { describe, it, expect } from 'vitest'
import {
    SECTION_MARKER,
    HTTP_MARKER,
    SPEC_DEFAULTS,
    parseSections,
    buildChainContextScript,
    parseChainContext,
    syncPeriod,
    periodStartEpoch,
    slotTime,
    buildDutiesScript,
    parseDuties,
    dutiesByIndex,
    dutiesMeta,
} from '@main/nodes/validatorDuties'

const BASE = 'http://10.0.0.5:5052'
// Gnosis: every constant differs from mainnet, which is the whole reason /config/spec is read.
const GNOSIS = { SLOTS_PER_EPOCH: '16', SECONDS_PER_SLOT: '5', EPOCHS_PER_SYNC_COMMITTEE_PERIOD: '512' }

/** Build sidecar stdout the way the shell script would emit it. */
const emit = (sections) => sections
    .map(([name, body, code = 200]) => `\n${SECTION_MARKER}${name}\n${body}\n${HTTP_MARKER}${code}\n`)
    .join('')

describe('parseSections', () => {
    it('splits labelled sections and records each HTTP code', () => {
        const out = parseSections(emit([['a', '{"x":1}'], ['b', '{"y":2}', 404]]))
        expect(out.a).toEqual({ body: '{"x":1}', code: 200 })
        expect(out.b).toEqual({ body: '{"y":2}', code: 404 })
    })
    it('reports 0 when curl never connected (no -w output)', () => {
        const out = parseSections(`\n${SECTION_MARKER}a\n\n`)
        expect(out.a.code).toBe(0)
    })
    it('ignores trailing noise that is not a labelled section', () => {
        expect(Object.keys(parseSections('garbage with no marker'))).toEqual([])
    })
})

describe('parseChainContext', () => {
    it('reads spec constants from the beacon rather than assuming mainnet', () => {
        const ctx = parseChainContext(emit([
            ['spec', JSON.stringify({ data: GNOSIS })],
            ['genesis', JSON.stringify({ data: { genesis_time: '1638993340' } })],
            ['syncing', JSON.stringify({ data: { head_slot: '1600' } })],
        ]))
        expect(ctx.spec).toMatchObject({ slotsPerEpoch: 16, secondsPerSlot: 5, epochsPerSyncPeriod: 512, fromBeacon: true })
        expect(ctx.genesisTime).toBe(1638993340)
        expect(ctx.currentEpoch).toBe(100) // 1600 / 16, not / 32
    })
    it('falls back to mainnet presets and flags that it did so', () => {
        const ctx = parseChainContext(emit([
            ['spec', 'not json', 500],
            ['genesis', JSON.stringify({ data: { genesis_time: '1606824023' } })],
            ['syncing', JSON.stringify({ data: { head_slot: '320' } })],
        ]))
        expect(ctx.spec).toMatchObject({ ...SPEC_DEFAULTS, fromBeacon: false })
        expect(ctx.currentEpoch).toBe(10)
    })
    it('leaves currentEpoch null when the beacon never answered', () => {
        expect(parseChainContext('').currentEpoch).toBeNull()
    })
})

describe('sync period math', () => {
    it('maps epochs to periods and back', () => {
        expect(syncPeriod(0, 256)).toBe(0)
        expect(syncPeriod(255, 256)).toBe(0)
        expect(syncPeriod(256, 256)).toBe(1)
        expect(periodStartEpoch(3, 256)).toBe(768)
    })
    it("uses the chain's own period length", () => {
        expect(syncPeriod(600, 512)).toBe(1)   // Gnosis
        expect(syncPeriod(600, 256)).toBe(2)   // mainnet
    })
})

describe('slotTime', () => {
    it('converts a slot to unix seconds', () => {
        expect(slotTime(100, 1000, 12)).toBe(2200)
    })
    it('returns null without a genesis time', () => {
        expect(slotTime(100, null, 12)).toBeNull()
    })
})

describe('buildDutiesScript', () => {
    it("asks for the current committee, the next period, and this epoch's proposers", () => {
        const script = buildDutiesScript(BASE, { currentEpoch: 300, epochsPerSyncPeriod: 256 })
        expect(script).toContain(`${BASE}/eth/v1/beacon/states/head/sync_committees'`)
        // 300 is in period 1, so the next period starts at epoch 512.
        expect(script).toContain('sync_committees?epoch=512')
        expect(script).toContain('/eth/v1/validator/duties/proposer/300')
    })
    it("uses the chain's period length for the next-period epoch", () => {
        expect(buildDutiesScript(BASE, { currentEpoch: 300, epochsPerSyncPeriod: 512 })).toContain('sync_committees?epoch=512')
        expect(buildDutiesScript(BASE, { currentEpoch: 600, epochsPerSyncPeriod: 512 })).toContain('sync_committees?epoch=1024')
    })
    it('returns null without a base or a usable epoch', () => {
        expect(buildDutiesScript('', { currentEpoch: 1 })).toBeNull()
        expect(buildDutiesScript(BASE, {})).toBeNull()
        expect(buildDutiesScript(BASE, { currentEpoch: NaN })).toBeNull()
    })
})

describe('buildChainContextScript', () => {
    it('requests spec, genesis and syncing', () => {
        const script = buildChainContextScript(BASE)
        for (const path of ['/eth/v1/config/spec', '/eth/v1/beacon/genesis', '/eth/v1/node/syncing']) {
            expect(script).toContain(`${BASE}${path}`)
        }
    })
    it('returns null without a base', () => expect(buildChainContextScript('')).toBeNull())
})

describe('parseDuties', () => {
    const STDOUT = emit([
        ['syncCurrent', JSON.stringify({ data: { validators: ['7', '9'] } })],
        ['syncNext', JSON.stringify({ data: { validators: ['9', '11'] } })],
        ['proposers', JSON.stringify({ data: [
            { pubkey: '0xaa', validator_index: '7', slot: '9601' },
            { pubkey: '0xbb', validator_index: '42', slot: '9602' },
        ] })],
    ])

    it('pulls committee members and proposer assignments', () => {
        const d = parseDuties(STDOUT)
        expect(d.syncCurrent).toEqual(['7', '9'])
        expect(d.syncNext).toEqual(['9', '11'])
        expect(d.proposals).toEqual([{ index: '7', slot: 9601 }, { index: '42', slot: 9602 }])
        expect(d.syncNextOk).toBe(true)
    })

    it('distinguishes a refused next period from an empty one', () => {
        const refused = parseDuties(emit([
            ['syncCurrent', JSON.stringify({ data: { validators: ['7'] } })],
            ['syncNext', '{"code":400,"message":"Epoch is too far in the future"}', 400],
            ['proposers', JSON.stringify({ data: [] })],
        ]))
        expect(refused.syncNext).toEqual([])
        expect(refused.syncNextOk).toBe(false)
    })

    it('tolerates a malformed section without losing the others', () => {
        const d = parseDuties(emit([
            ['syncCurrent', '<html>502 Bad Gateway</html>', 502],
            ['syncNext', JSON.stringify({ data: { validators: ['3'] } })],
            ['proposers', JSON.stringify({ data: [] })],
        ]))
        expect(d.syncCurrent).toEqual([])
        expect(d.syncNext).toEqual(['3'])
    })
})

describe('dutiesByIndex', () => {
    const parsed = {
        syncCurrent: ['7', '9'],
        syncNext: ['9'],
        proposals: [{ index: '7', slot: 200 }, { index: '7', slot: 100 }],
    }

    it('folds every duty onto its validator index', () => {
        const out = dutiesByIndex(parsed, { genesisTime: 1000, secondsPerSlot: 12 })
        expect(out['7']).toEqual({
            syncCurrent: true,
            syncNext: false,
            proposals: [{ slot: 100, time: 2200 }, { slot: 200, time: 3400 }], // sorted by slot
        })
        expect(out['9']).toMatchObject({ syncCurrent: true, syncNext: true, proposals: [] })
    })

    it('omits validators with no duty at all', () => {
        expect(dutiesByIndex(parsed, {})['42']).toBeUndefined()
    })

    it('leaves proposal times null when genesis is unknown', () => {
        expect(dutiesByIndex(parsed, {})['7'].proposals[0].time).toBeNull()
    })

    it('treats a repeated committee slot as plain membership', () => {
        const out = dutiesByIndex({ syncCurrent: ['7', '7', '7'] }, {})
        expect(out['7'].syncCurrent).toBe(true)
    })

    it('survives an empty parse', () => expect(dutiesByIndex()).toEqual({}))
})

describe('dutiesMeta', () => {
    it('reports when the proposer lookahead expires and the next period begins', () => {
        const meta = dutiesMeta({
            currentEpoch: 300,
            spec: { slotsPerEpoch: 32, secondsPerSlot: 12, epochsPerSyncPeriod: 256, fromBeacon: true },
            genesisTime: 0,
        })
        expect(meta).toMatchObject({
            currentEpoch: 300,
            syncPeriod: 1,
            nextPeriodStartEpoch: 512,
            nextPeriodStartTime: 512 * 32 * 12,
            epochEndTime: 301 * 32 * 12,
            specFromBeacon: true,
        })
    })
})
