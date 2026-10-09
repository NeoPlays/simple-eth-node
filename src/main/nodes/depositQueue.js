/**
 * Where a deposited key is before it has a validator record.
 *
 * Since Electra (Pectra), a deposit does not create the validator right away: it waits in the
 * beacon state's `pending_deposits` queue, and only when it is processed does the validator appear
 * (status `pending_initialized`, then `pending_queued`, then active). Until then the validators
 * route knows nothing about the key - no index, no status - which is what made such keys look
 * undeposited. `GET /eth/v1/beacon/states/head/pending_deposits` lists the queue in order.
 *
 * The queue is big (mainnet ~17k entries, ~8 MB), so the sidecar filters it with awk and only the
 * matching entries plus totals cross the SSH wire. Pure helpers; the exec side is
 * Node.getValidatorStates, which asks for this only for keys the validators route did not know.
 */

export const PENDING_DEPOSITS_PATH = '/eth/v1/beacon/states/head/pending_deposits'
export const SPEC_PATH = '/eth/v1/config/spec'
const SPEC_MARKER = '===DQ_SPEC==='
const HTTP_MARKER = '===DQ_HTTP==='
const HEX_PUBKEY = /^0x[0-9a-f]{96}$/

/** Mainnet presets, used only when /config/spec is unreadable. */
export const DEPOSIT_SPEC_DEFAULTS = {
    maxChurnGwei: 256_000_000_000,    // MAX_PER_EPOCH_ACTIVATION_EXIT_CHURN_LIMIT
    maxDepositsPerEpoch: 16,          // MAX_PENDING_DEPOSITS_PER_EPOCH
    secondsPerSlot: 12,
    slotsPerEpoch: 32,
}

// Walks `"pubkey"/"amount"/"slot"` tokens in order (a new pubkey starts a new entry) and prints
// `MATCH <pubkey> <position> <amount> <slot> <gwei ahead>` for wanted keys, then
// `TOTAL <entries> <gwei>`. Busybox awk, as shipped in the curl image.
const AWK = [
    'BEGIN { n = split(want, w, ","); for (i = 1; i <= n; i++) W[w[i]] = 1 }',
    'function fin() { pos++; if (pk in W) printf "MATCH %s %d %s %s %.0f\\n", pk, pos, amt, sl, ahead; ahead += amt; total += amt }',
    '$2 == "pubkey" { if (pk != "") fin(); pk = $4; amt = 0; sl = ""; next }',
    '$2 == "amount" { amt = $4; next }',
    '$2 == "slot" { sl = $4; next }',
    'END { if (pk != "") fin(); printf "TOTAL %d %.0f\\n", pos, total }',
].join(' ')

/**
 * Sidecar script: fetch the queue to a file (so its HTTP code is known), filter it to `pubkeys`,
 * then print the spec values the estimate needs.
 */
export function buildDepositQueueScript(base, pubkeys = []) {
    if (!base) return null
    const want = [...new Set((Array.isArray(pubkeys) ? pubkeys : []).map((p) => String(p).toLowerCase()))].filter((p) => HEX_PUBKEY.test(p))
    if (!want.length) return null
    return [
        `code=$(curl -sS -m 60 -o /tmp/pd.json -w '%{http_code}' '${base}${PENDING_DEPOSITS_PATH}')`,
        `echo "${HTTP_MARKER}$code"`,
        `grep -oE '"(pubkey|amount|slot)":"[0-9a-fx]+"' /tmp/pd.json | awk -F'"' -v want='${want.join(',')}' '${AWK}'`,
        `echo '${SPEC_MARKER}'`,
        `curl -sS -m 10 '${base}${SPEC_PATH}' | grep -oE '"(MAX_PER_EPOCH_ACTIVATION_EXIT_CHURN_LIMIT|MAX_PENDING_DEPOSITS_PER_EPOCH|SECONDS_PER_SLOT|SLOTS_PER_EPOCH)":"[0-9]+"'`,
    ].join(' ; ')
}

/**
 * @returns {{ ok: boolean, length: number, totalGwei: number, matches: { [pubkey]: { position, amountGwei, slot, aheadGwei } }, spec: typeof DEPOSIT_SPEC_DEFAULTS }}
 * `ok` false when the route did not answer 2xx (a pre-Electra chain or an older beacon) - then
 * "not in the queue" cannot be concluded either.
 */
export function parseDepositQueue(stdout = '') {
    const text = String(stdout)
    const code = parseInt((text.match(new RegExp(`${HTTP_MARKER}(\\d{3})`)) || [])[1] || '0', 10)
    const out = { ok: code >= 200 && code < 300, length: 0, totalGwei: 0, matches: {}, spec: { ...DEPOSIT_SPEC_DEFAULTS } }
    const [queuePart, specPart = ''] = text.split(SPEC_MARKER)
    for (const line of queuePart.split('\n')) {
        const p = line.trim().split(/\s+/)
        if (p[0] === 'MATCH' && p.length >= 6) {
            out.matches[p[1].toLowerCase()] = { position: Number(p[2]), amountGwei: Number(p[3]), slot: p[4] ? Number(p[4]) : null, aheadGwei: Number(p[5]) }
        } else if (p[0] === 'TOTAL' && p.length >= 3) {
            out.length = Number(p[1])
            out.totalGwei = Number(p[2])
        }
    }
    const spec = {}
    for (const m of specPart.matchAll(/"([A-Z_]+)":"(\d+)"/g)) spec[m[1]] = Number(m[2])
    if (spec.MAX_PER_EPOCH_ACTIVATION_EXIT_CHURN_LIMIT) out.spec.maxChurnGwei = spec.MAX_PER_EPOCH_ACTIVATION_EXIT_CHURN_LIMIT
    if (spec.MAX_PENDING_DEPOSITS_PER_EPOCH) out.spec.maxDepositsPerEpoch = spec.MAX_PENDING_DEPOSITS_PER_EPOCH
    if (spec.SECONDS_PER_SLOT) out.spec.secondsPerSlot = spec.SECONDS_PER_SLOT
    if (spec.SLOTS_PER_EPOCH) out.spec.slotsPerEpoch = spec.SLOTS_PER_EPOCH
    return out
}

/**
 * Rough wait until a queued deposit is processed. Per epoch the chain takes at most
 * `maxChurnGwei` of deposit balance AND at most `maxDepositsPerEpoch` deposits; the queue drains
 * at whichever binds first. The balance churn is assumed to sit at its cap, which holds on mainnet
 * and on large testnets - so this is a lower bound, labelled an estimate wherever it is shown.
 * @returns {{ epochs: number, seconds: number }}
 */
export function depositEta({ position, aheadGwei = 0, amountGwei = 0 }, spec = DEPOSIT_SPEC_DEFAULTS) {
    const byBalance = Math.ceil((aheadGwei + amountGwei) / spec.maxChurnGwei)
    const byCount = Math.ceil(position / spec.maxDepositsPerEpoch)
    const epochs = Math.max(1, byBalance, byCount)
    return { epochs, seconds: epochs * spec.slotsPerEpoch * spec.secondsPerSlot }
}

const gweiToEth = (g) => (g == null ? null : Number(g) / 1e9)

/**
 * A validator-state-shaped record for a key that is only in the deposit queue, so the rest of the
 * app (rows, facets, the import check) handles it without a special path. `rawStatus` is our own
 * `deposit_queued` - the beacon has no status for it yet.
 */
export function depositQueuedState(pubkey, match, queue) {
    const eta = depositEta(match, queue.spec)
    return {
        pubkey: String(pubkey).toLowerCase(),
        index: null,
        status: 'Pending',
        rawStatus: 'deposit_queued',
        slashed: false,
        balance: null,
        effectiveBalance: null,
        withdrawalType: null,
        activationEpoch: null,
        activationEligibilityEpoch: null,
        depositQueue: {
            position: match.position,
            length: queue.length,
            amountEth: gweiToEth(match.amountGwei),
            aheadEth: gweiToEth(match.aheadGwei),
            etaEpochs: eta.epochs,
            etaSeconds: eta.seconds,
        },
    }
}
