/**
 * Distributed-validator (DVT) key reads: pure, unit-testable helpers for surfacing the
 * REAL validator pubkeys of an Obol cluster - which are NOT the share keystores loaded into
 * the VC, but the distributed-validator pubkeys recorded in the DVT client's cluster-lock.json.
 *
 * Two clients speak this protocol: Obol's Charon, and Nethermind's Pluto - a Rust
 * reimplementation of Charon. Upstream `PlutoService extends CharonService`, inheriting its data
 * dir (/opt/charon) and its `cat <dataDir>/.charon/cluster-lock.json`, and stereum's own
 * getDVTKeys handles them in one combined `case`. They are treated identically here for the same
 * reason: on disk they are the same thing.
 *
 * Mirrors stereum's ValidatorAccountManager.getDVTKeys (CharonService/PlutoService case): read
 * `<charon-data-dir>/.charon/cluster-lock.json` off the host and take
 * distributed_validators[].distributed_public_key (already 0x-prefixed). The exec side lives
 * in Node.listValidators; everything here is side-effect-free.
 *
 * (SSV's list comes from the external api.ssv.network REST API keyed by the operator id, not
 * from the node - deliberately not implemented here yet; see the Validators tab notes.)
 */
import { shellQuote } from "@main/nodes/metrics";

// Both clients bind-mount their working dir at this container path; the lockfile sits under it.
// Pluto keeps Charon's path (it extends CharonService upstream), so this stays '/opt/charon'
// for both - it is the container mount point, not a brand name.
export const CHARON_CONTAINER_DIR = '/opt/charon'

/** Service types that expose an Obol-style cluster-lock.json. */
export const DVT_SERVICE_TYPES = new Set(['CharonService', 'PlutoService'])

/** Is this service a DVT middleware client (Charon or Pluto)? */
export function isDvtService(config) {
    return DVT_SERVICE_TYPES.has(config?.service)
}

/** Host path of the volume mounted at /opt/charon (the DVT client's data dir), or undefined. */
export function resolveCharonDataDir(config) {
    if (!isDvtService(config)) return undefined
    for (const v of (config?.volumes || [])) {
        const [host, container] = String(v).split(':')
        if (container === CHARON_CONTAINER_DIR && host?.startsWith('/')) return host.replace(/\/+$/, '')
    }
    return undefined
}

/** `sudo cat <hostDir>/.charon/cluster-lock.json`, or null if the DVT volume is unresolved. */
export function buildClusterLockReadCommand(config) {
    const dir = resolveCharonDataDir(config)
    if (!dir) return null
    return `sudo cat ${shellQuote(dir + '/.charon/cluster-lock.json')}`
}

/**
 * Parse cluster-lock.json -> the distributed validator pubkeys.
 * @returns {{ pubkey: string, readonly: boolean }[]}
 */
export function parseClusterLock(stdout) {
    let json
    try { json = JSON.parse(stdout) } catch { return [] }
    const dvs = json?.distributed_validators
    if (!Array.isArray(dvs)) return []
    return dvs
        .map((dv) => dv?.distributed_public_key)
        .filter((k) => typeof k === 'string' && k)
        .map((pubkey) => ({ pubkey, readonly: false }))
}

// ── DVT behind a validator client, possibly on another machine ─────────────────────────────
//
// A validator client can point its beacon endpoint at a Charon (or Pluto) running elsewhere,
// e.g. `--beacon-nodes http://10.0.0.5:3600`. On this node there is then no DVT service, no
// cluster-lock.json, and nothing in the setup that says "Obol" - yet the keys the client holds
// are key SHARES, and solo actions on them (remove, exit, fee recipient) would act on one
// operator's share of a distributed validator.
//
// Charon answers GET /eth/v1/node/version itself rather than proxying it, with
// `obolnetwork/charon/<version>-<commit>/<arch>-<os>` (charon core/validatorapi
// validatorapi.go NodeVersion), so one probe of each configured endpoint identifies it.

export const DVT_VALIDATOR_API_PORT = 3600   // Charon's default --validator-api-address port
export const DVT_PROBE_PATH = '/eth/v1/node/version'
const PROBE_MARKER = '===DVT_PROBE==='
const PROBE_HTTP_MARKER = '===DVT_HTTP==='
const PROBE_TIMEOUT_S = 5

/** 'charon' | 'pluto' | null from a node-version string. */
export function dvtClientFromVersion(version) {
    const v = String(version || '').toLowerCase()
    if (v.includes('charon')) return 'charon'
    if (v.includes('pluto')) return 'pluto'
    return null
}

/**
 * Sidecar script asking each endpoint for its node version (marker + HTTP code per endpoint, so a
 * dead endpoint is told apart from one that answered). Endpoints must already be normalized
 * (`normalizeBeaconUrl`), which restricts them to URL-safe characters.
 */
export function buildDvtProbeScript(bases = []) {
    const list = [...new Set((Array.isArray(bases) ? bases : []).filter(Boolean))]
    if (!list.length) return null
    return list.map((b) =>
        `echo '${PROBE_MARKER}${b}' ; curl -sS -m ${PROBE_TIMEOUT_S} '${b}${DVT_PROBE_PATH}' -w '\\n${PROBE_HTTP_MARKER}%{http_code}' ; echo`
    ).join(' ; ')
}

/** `{ [base]: { httpCode, version } }` from the probe output; version null when unparseable. */
export function parseDvtProbe(stdout = '') {
    const out = {}
    let base = null
    let buf = []
    const flush = () => {
        if (!base) return
        const text = buf.join('\n')
        const hi = text.lastIndexOf(PROBE_HTTP_MARKER)
        const body = hi >= 0 ? text.slice(0, hi) : text
        const code = hi >= 0 ? parseInt(text.slice(hi + PROBE_HTTP_MARKER.length), 10) : 0
        let version = null
        try { version = JSON.parse(body.trim())?.data?.version ?? null } catch { /* not JSON */ }
        out[base] = { httpCode: Number.isFinite(code) ? code : 0, version: typeof version === 'string' ? version : null }
    }
    for (const line of String(stdout).split('\n')) {
        if (line.startsWith(PROBE_MARKER)) { flush(); base = line.slice(PROBE_MARKER.length).trim(); buf = []; continue }
        if (base) buf.push(line)
    }
    flush()
    return out
}

const portOf = (url) => {
    const m = String(url).match(/^(https?):\/\/[^/]*?:(\d+)(?:\/|$)/i)
    return m ? Number(m[2]) : null
}

/**
 * What a validator client's configured beacon endpoints really are.
 *  - client/endpoint/version: the DVT middleware it talks to, or client null.
 *  - detectedBy: 'version' when the endpoint said so; 'port' when it did not answer but sits on
 *    Charon's default port. Unreachable-on-3600 is treated as DVT on purpose: the cost of wrongly
 *    gating a solo client's writes is a disabled button, the cost of the opposite is acting on a
 *    key share.
 *  - beacons: endpoints that answered and are NOT a DVT client, i.e. real beacon nodes - the only
 *    kind that reveals a distributed validator's own pubkey.
 * @param {string[]} bases - the client's configured endpoints (normalized)
 * @param {ReturnType<typeof parseDvtProbe>} probe
 */
export function classifyVcBackend(bases = [], probe = {}) {
    const ok = (b) => probe[b]?.httpCode >= 200 && probe[b]?.httpCode < 300
    let dvt = null
    for (const b of bases) {
        const client = dvtClientFromVersion(probe[b]?.version)
        if (client) { dvt = { client, endpoint: b, version: probe[b].version, detectedBy: 'version' }; break }
    }
    if (!dvt) {
        const suspect = bases.find((b) => portOf(b) === DVT_VALIDATOR_API_PORT && !ok(b))
        if (suspect) dvt = { client: 'charon', endpoint: suspect, version: null, detectedBy: 'port' }
    }
    const beacons = bases.filter((b) => ok(b) && !dvtClientFromVersion(probe[b]?.version))
    return { client: dvt?.client ?? null, endpoint: dvt?.endpoint ?? null, version: dvt?.version ?? null, detectedBy: dvt?.detectedBy ?? null, beacons }
}

/**
 * Pair share-keyed stats (as Charon answers) with distributed-validator pubkeys looked up by
 * index on a real beacon. Charon rewrites every pubkey in its validator responses to the
 * operator's share (charon validatorapi.go convertValidators), so the DV pubkey can only come
 * from a beacon that is not Charon.
 * @param {{ [share]: { index } }} shareStates - Charon's answer, keyed by share pubkey
 * @param {{ [dvPubkey]: { index } }} beaconStates - a real beacon's answer for those indices
 * @returns {{ [share]: string }} share -> distributed validator pubkey (only where both agree on an index)
 */
export function mapSharesToDv(shareStates = {}, beaconStates = {}) {
    const byIndex = {}
    for (const [pubkey, s] of Object.entries(beaconStates)) if (s?.index != null) byIndex[s.index] = pubkey
    const out = {}
    for (const [share, s] of Object.entries(shareStates)) {
        const dv = s?.index != null ? byIndex[s.index] : null
        if (dv && dv !== share) out[share] = dv
    }
    return out
}
