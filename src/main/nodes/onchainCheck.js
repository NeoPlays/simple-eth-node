/**
 * On-chain activity check before importing keys: has this validator signed in the last few epochs?
 * If it has, it is running somewhere else right now, and importing it here would make two clients
 * sign for one key - the one thing slashing protection cannot prevent.
 *
 * No single beacon route covers that window (both behaviours verified against Lighthouse and
 * Lodestar):
 *   - `POST /eth/v1/validator/liveness/{epoch}` (what doppelganger protection uses) answers only for
 *     the current and the previous epoch; older epochs are a 400.
 *   - `POST /eth/v1/beacon/rewards/attestations/{epoch}` answers only for completed epochs, from
 *     current-2 back (current-1's state does not exist yet), with each validator's head/target/source
 *     reward - positive when its vote counted, negative when it was missed.
 * Together they cover the current epoch and the three before it.
 *
 * Pure helpers; the exec side is Node.checkKeysOnChain.
 */

export const LIVENESS_PATH = '/eth/v1/validator/liveness'
export const ATTESTATION_REWARDS_PATH = '/eth/v1/beacon/rewards/attestations'
const MARKER = '===OC==='
const HTTP_MARKER = '===OC_HTTP==='
const REQUEST_TIMEOUT_S = 20
const CHUNK = 500

/** The epochs checked, and by which route. `currentEpoch` from the beacon's own clock. */
export function checkEpochs(currentEpoch) {
    // Number(null) is 0 - an unknown epoch must not quietly become epoch 0.
    const e = currentEpoch == null || currentEpoch === '' ? NaN : Number(currentEpoch)
    if (!Number.isInteger(e) || e < 0) return { liveness: [], rewards: [] }
    return {
        liveness: [e, e - 1].filter((x) => x >= 0),
        rewards: [e - 2, e - 3].filter((x) => x >= 0),
    }
}

/**
 * One sidecar script: a liveness request per liveness epoch and a rewards request per rewards
 * epoch, chunked, each delimited with `===OC===<kind>:<epoch>` and followed by its HTTP code.
 * Bodies are bare JSON arrays of validator indices (as both routes expect).
 */
export function buildOnchainCheckScript(base, { currentEpoch, indices = [] } = {}) {
    if (!base) return null
    const ids = (Array.isArray(indices) ? indices : []).map(String).filter((i) => /^\d+$/.test(i))
    if (!ids.length) return null
    const epochs = checkEpochs(currentEpoch)
    if (!epochs.liveness.length) return null
    const parts = []
    const request = (kind, epoch, path) => {
        for (let i = 0; i < ids.length; i += CHUNK) {
            const body = `[${ids.slice(i, i + CHUNK).map((x) => `"${x}"`).join(',')}]`
            parts.push(`echo '${MARKER}${kind}:${epoch}' ; curl -sS -m ${REQUEST_TIMEOUT_S} -X POST '${base}${path}/${epoch}' -H 'Content-Type: application/json' -d '${body}' -w '\\n${HTTP_MARKER}%{http_code}' ; echo`)
        }
    }
    for (const e of epochs.liveness) request('liveness', e, LIVENESS_PATH)
    for (const e of epochs.rewards) request('rewards', e, ATTESTATION_REWARDS_PATH)
    return parts.join(' ; ')
}

const toInt = (v) => {
    const n = Number(v)
    return Number.isFinite(n) ? n : null
}

/**
 * `{ liveness: { [epoch]: { ok, live: { [index]: bool } } }, rewards: { [epoch]: { ok, byIndex: { [index]: { head, target, source } } } } }`
 * An epoch is `ok` only when every chunk for it answered 2xx; a chunk that failed leaves its
 * indices absent, which the verdict treats as "not checked", never as "not signed".
 */
export function parseOnchainCheck(stdout = '') {
    const out = { liveness: {}, rewards: {} }
    const sections = String(stdout).split(MARKER).slice(1)
    for (const sec of sections) {
        const nl = sec.indexOf('\n')
        const head = (nl === -1 ? sec : sec.slice(0, nl)).trim()
        const [kind, epochStr] = head.split(':')
        const epoch = Number(epochStr)
        if (!['liveness', 'rewards'].includes(kind) || !Number.isInteger(epoch)) continue
        const rest = nl === -1 ? '' : sec.slice(nl + 1)
        const hi = rest.lastIndexOf(HTTP_MARKER)
        const code = hi === -1 ? 0 : parseInt(rest.slice(hi + HTTP_MARKER.length), 10) || 0
        const body = hi === -1 ? rest : rest.slice(0, hi)
        const ok = code >= 200 && code < 300
        if (kind === 'liveness') {
            const slot = out.liveness[epoch] || (out.liveness[epoch] = { ok: true, live: {} })
            slot.ok = slot.ok && ok
            if (!ok) continue
            let json
            try { json = JSON.parse(body.trim()) } catch { slot.ok = false; continue }
            for (const v of Array.isArray(json?.data) ? json.data : []) {
                if (v?.index != null) slot.live[String(v.index)] = v.is_live === true || v.is_live === 'true'
            }
        } else {
            const slot = out.rewards[epoch] || (out.rewards[epoch] = { ok: true, byIndex: {} })
            slot.ok = slot.ok && ok
            if (!ok) continue
            let json
            try { json = JSON.parse(body.trim()) } catch { slot.ok = false; continue }
            for (const r of Array.isArray(json?.data?.total_rewards) ? json.data.total_rewards : []) {
                if (r?.validator_index == null) continue
                slot.byIndex[String(r.validator_index)] = { head: toInt(r.head), target: toInt(r.target), source: toInt(r.source) }
            }
        }
    }
    return out
}

/**
 * Did this attestation reward come from a vote? Positive anywhere = the vote counted. Negative =
 * missed. All zero is ambiguous (during an inactivity leak voters earn nothing either), so it is
 * reported as such rather than guessed.
 * @returns {'signed'|'missed'|'unclear'}
 */
export function rewardSignal(r) {
    if (!r) return 'unclear'
    const vals = [r.head, r.target, r.source].filter((v) => v != null)
    if (vals.some((v) => v > 0)) return 'signed'
    if (vals.some((v) => v < 0)) return 'missed'
    return 'unclear'
}

/**
 * Per pubkey: did it sign in the checked window?
 *   'active'        signed in at least one checked epoch - block the import
 *   'inactive'      on chain, every checked epoch answered, no signature
 *   'not-on-chain'  the beacon has no validator for this pubkey (never deposited, or not yet seen)
 *   'pending'       deposited but not yet active - it cannot have signed
 *   'unknown'       could not be checked for at least one epoch and nothing showed activity
 * @param {{ [pubkey]: { index, status } }} states - from parseBeaconStates (pubkeys lowercased)
 * @param {ReturnType<typeof parseOnchainCheck>} parsed
 * @param {ReturnType<typeof checkEpochs>} epochs
 */
export function onchainVerdicts(pubkeys = [], states = {}, parsed = { liveness: {}, rewards: {} }, epochs = { liveness: [], rewards: [] }) {
    const out = {}
    for (const pk of pubkeys) {
        const s = states[String(pk).toLowerCase()]
        if (!s || s.index == null) { out[pk] = { verdict: 'not-on-chain', signedIn: [], uncheckedEpochs: [] }; continue }
        if (s.status === 'Pending') { out[pk] = { verdict: 'pending', index: s.index, signedIn: [], uncheckedEpochs: [] }; continue }
        const idx = String(s.index)
        // An exited validator earns nothing, so zero rewards are its normal state, not ambiguity.
        const zeroIsIdle = s.status === 'Exited' || s.status === 'Slashed'
        const signedIn = []
        const unchecked = []
        for (const e of epochs.liveness) {
            const live = parsed.liveness[e]?.live?.[idx]
            if (live === true) signedIn.push(e)
            else if (live !== false) unchecked.push(e)
        }
        for (const e of epochs.rewards) {
            const r = parsed.rewards[e]?.byIndex?.[idx]
            const signal = parsed.rewards[e]?.ok && r ? rewardSignal(r) : null
            if (signal === 'signed') signedIn.push(e)
            else if (signal === 'missed' || (signal === 'unclear' && zeroIsIdle)) continue
            else unchecked.push(e)   // absent, or all-zero on an active validator: not proven either way
        }
        signedIn.sort((a, b) => b - a)
        unchecked.sort((a, b) => b - a)
        const verdict = signedIn.length ? 'active' : unchecked.length ? 'unknown' : 'inactive'
        out[pk] = { verdict, index: s.index, status: s.status, signedIn, uncheckedEpochs: unchecked }
    }
    return out
}

/** Counts per verdict, for the summary line. */
export function summarizeVerdicts(results = {}) {
    const counts = { active: 0, inactive: 0, 'not-on-chain': 0, pending: 0, unknown: 0 }
    for (const r of Object.values(results)) if (r?.verdict in counts) counts[r.verdict]++
    return counts
}
