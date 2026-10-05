/**
 * Upcoming validator duties: sync-committee membership and block proposals. Pure, unit-testable
 * helpers over two beacon REST reads, mirroring the shape of `beaconValidators.js` (marker-delimited
 * curl sidecar, per-response HTTP codes so an empty answer is distinguishable from a dead beacon).
 *
 * Two duties, two very different lookaheads - the UI must not present them as one thing:
 *
 *   Sync committee  ~27h on mainnet. A period is EPOCHS_PER_SYNC_COMMITTEE_PERIOD epochs, and the
 *                   beacon state carries `next_sync_committee`, so the *next* period's membership
 *                   is known a full period ahead. This is schedulable.
 *   Proposal        <= 1 epoch (~6.4 min). The proposer shuffling depends on a RANDAO mix that only
 *                   settles one epoch ahead, so only the current epoch can be asked for. This is a
 *                   live "happening now" signal, never a schedule.
 *
 * Chain constants are read from the beacon's own /config/spec rather than hardcoded: Gnosis (a
 * supported network here) differs from mainnet on all three - 16 slots/epoch, 5s slots, 512
 * epochs/period - so mainnet presets would silently mislabel every duty time on it.
 */
export const SPEC_PATH = '/eth/v1/config/spec'
export const GENESIS_PATH = '/eth/v1/beacon/genesis'
export const SYNCING_PATH = '/eth/v1/node/syncing'
export const SYNC_COMMITTEES_PATH = '/eth/v1/beacon/states/head/sync_committees'
export const PROPOSER_DUTIES_PATH = '/eth/v1/validator/duties/proposer'

export const SECTION_MARKER = '===DUTY_SECTION==='
export const HTTP_MARKER = '===DUTY_HTTP==='
const REQUEST_TIMEOUT_S = 10

/** Used only when /config/spec is unreadable; see the note above about Gnosis. */
export const SPEC_DEFAULTS = { slotsPerEpoch: 32, secondsPerSlot: 12, epochsPerSyncPeriod: 256 }

const num = (v) => {
    if (v == null) return null
    const n = Number(v)
    return Number.isFinite(n) ? n : null
}

/** One labelled `printf` + `curl` pair. Labels let the parser match responses to requests by name. */
function section(name, url) {
    return `printf '\\n${SECTION_MARKER}${name}\\n' ; curl -sS -m ${REQUEST_TIMEOUT_S} '${url}' -w '\\n${HTTP_MARKER}%{http_code}\\n'`
}

/**
 * Split marker-delimited stdout into `{ [label]: { body, code } }`. A section whose curl never
 * connected still appears, with code 0 - the caller decides whether that is fatal.
 */
export function parseSections(stdout) {
    const out = {}
    for (const part of String(stdout ?? '').split(SECTION_MARKER)) {
        const nl = part.indexOf('\n')
        if (nl === -1) continue
        const label = part.slice(0, nl).trim()
        if (!label) continue
        let body = part.slice(nl + 1)
        let code = 0
        const hi = body.indexOf(HTTP_MARKER)
        if (hi !== -1) {
            const m = body.slice(hi + HTTP_MARKER.length).match(/\d{3}/)
            if (m) code = parseInt(m[0], 10)
            body = body.slice(0, hi)
        }
        out[label] = { body: body.trim(), code }
    }
    return out
}

const json = (section) => {
    if (!section?.body) return null
    try { return JSON.parse(section.body) } catch { return null }
}

/**
 * Chain context: the spec constants, genesis time (to turn slots into wall clock) and the head
 * slot (to derive the current epoch, which the duties request needs in its URL).
 *
 * This is a separate round trip from {@link buildDutiesScript} on purpose: the proposer-duties
 * path and the next-period epoch both depend on values only this response carries.
 */
export function buildChainContextScript(base) {
    if (!base) return null
    return [
        section('spec', `${base}${SPEC_PATH}`),
        section('genesis', `${base}${GENESIS_PATH}`),
        section('syncing', `${base}${SYNCING_PATH}`),
    ].join(' ; ')
}

/** @returns {{ spec, genesisTime, headSlot, currentEpoch, codes }} - fields null when unreadable. */
export function parseChainContext(stdout) {
    const s = parseSections(stdout)
    const codes = Object.values(s).map((x) => x.code)

    const specData = json(s.spec)?.data || {}
    const spec = {
        slotsPerEpoch: num(specData.SLOTS_PER_EPOCH) ?? SPEC_DEFAULTS.slotsPerEpoch,
        secondsPerSlot: num(specData.SECONDS_PER_SLOT) ?? SPEC_DEFAULTS.secondsPerSlot,
        epochsPerSyncPeriod: num(specData.EPOCHS_PER_SYNC_COMMITTEE_PERIOD) ?? SPEC_DEFAULTS.epochsPerSyncPeriod,
        // Records whether the numbers above are the beacon's own or our fallback, so the UI can
        // avoid stating times it cannot actually stand behind.
        fromBeacon: num(specData.SLOTS_PER_EPOCH) != null,
    }

    const genesisTime = num(json(s.genesis)?.data?.genesis_time)
    const headSlot = num(json(s.syncing)?.data?.head_slot)
    const currentEpoch = headSlot == null ? null : Math.floor(headSlot / spec.slotsPerEpoch)

    return { spec, genesisTime, headSlot, currentEpoch, codes }
}

/** Sync-committee period containing `epoch`. */
export function syncPeriod(epoch, epochsPerSyncPeriod = SPEC_DEFAULTS.epochsPerSyncPeriod) {
    return Math.floor(epoch / epochsPerSyncPeriod)
}

/** First epoch of a sync-committee period. */
export function periodStartEpoch(period, epochsPerSyncPeriod = SPEC_DEFAULTS.epochsPerSyncPeriod) {
    return period * epochsPerSyncPeriod
}

/** Unix seconds at which `slot` begins, or null without a genesis time. */
export function slotTime(slot, genesisTime, secondsPerSlot) {
    if (genesisTime == null || slot == null) return null
    return genesisTime + slot * secondsPerSlot
}

/**
 * Current + next sync committee and this epoch's proposer assignments, in one exec.
 *
 * The next period is addressed by an epoch inside it: the head state carries `next_sync_committee`,
 * so asking for the period after this one is answerable, and anything beyond it is not.
 */
export function buildDutiesScript(base, { currentEpoch, epochsPerSyncPeriod = SPEC_DEFAULTS.epochsPerSyncPeriod } = {}) {
    if (!base || currentEpoch == null || !Number.isFinite(currentEpoch)) return null
    const nextEpoch = periodStartEpoch(syncPeriod(currentEpoch, epochsPerSyncPeriod) + 1, epochsPerSyncPeriod)
    return [
        section('syncCurrent', `${base}${SYNC_COMMITTEES_PATH}`),
        section('syncNext', `${base}${SYNC_COMMITTEES_PATH}?epoch=${nextEpoch}`),
        section('proposers', `${base}${PROPOSER_DUTIES_PATH}/${currentEpoch}`),
    ].join(' ; ')
}

/**
 * @returns {{ syncCurrent: string[], syncNext: string[], proposals: {index:string,slot:number}[],
 *             codes: number[], syncNextOk: boolean }}
 * `syncNextOk` is tracked separately: a beacon may answer the current committee and refuse the next
 * (too far ahead for its state), and "not known yet" must not render as "not in the committee".
 */
export function parseDuties(stdout) {
    const s = parseSections(stdout)
    const ids = (label) => {
        const list = json(s[label])?.data?.validators
        return Array.isArray(list) ? list.map(String) : []
    }
    const proposals = []
    for (const d of (json(s.proposers)?.data || [])) {
        const slot = num(d?.slot)
        if (d?.validator_index != null && slot != null) proposals.push({ index: String(d.validator_index), slot })
    }
    return {
        syncCurrent: ids('syncCurrent'),
        syncNext: ids('syncNext'),
        proposals,
        syncNextOk: (s.syncNext?.code ?? 0) >= 200 && (s.syncNext?.code ?? 0) < 300,
        codes: Object.values(s).map((x) => x.code),
    }
}

/**
 * Fold parsed duties into a per-validator-index map, keyed by index as a string (the beacon's own
 * wire type - the renderer merges these onto rows by `String(row.index)`).
 *
 * Only indices that actually have a duty appear. Sync-committee membership is a set intersection;
 * a validator may hold several slots in the same committee, which is membership either way.
 */
export function dutiesByIndex({ syncCurrent = [], syncNext = [], proposals = [] } = {}, { genesisTime, secondsPerSlot = SPEC_DEFAULTS.secondsPerSlot } = {}) {
    const out = {}
    const at = (index) => (out[index] ||= { syncCurrent: false, syncNext: false, proposals: [] })
    for (const i of new Set(syncCurrent)) at(i).syncCurrent = true
    for (const i of new Set(syncNext)) at(i).syncNext = true
    for (const p of proposals) {
        at(p.index).proposals.push({ slot: p.slot, time: slotTime(p.slot, genesisTime, secondsPerSlot) })
    }
    for (const d of Object.values(out)) d.proposals.sort((a, b) => a.slot - b.slot)
    return out
}

/**
 * Timing metadata the UI needs to caption the two duties honestly: when this epoch's proposer
 * lookahead runs out, and when the next sync period takes over.
 */
export function dutiesMeta({ currentEpoch, spec, genesisTime }) {
    const { slotsPerEpoch, secondsPerSlot, epochsPerSyncPeriod } = spec
    const period = syncPeriod(currentEpoch, epochsPerSyncPeriod)
    const nextStartEpoch = periodStartEpoch(period + 1, epochsPerSyncPeriod)
    return {
        currentEpoch,
        syncPeriod: period,
        nextPeriodStartEpoch: nextStartEpoch,
        nextPeriodStartTime: slotTime(nextStartEpoch * slotsPerEpoch, genesisTime, secondsPerSlot),
        epochEndTime: slotTime((currentEpoch + 1) * slotsPerEpoch, genesisTime, secondsPerSlot),
        specFromBeacon: spec.fromBeacon === true,
    }
}
