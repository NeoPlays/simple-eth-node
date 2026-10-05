import { reactive, unref } from 'vue'

/**
 * Per-service validator-key cache for the Validators tab. Wraps the read-only `list-validators`
 * IPC (keymanager /eth/v1/keystores for VCs, Web3Signer publicKeys, Charon cluster-lock DV
 * pubkeys) so the view can lazily fetch each service once and refresh on demand.
 *
 * Slice 0 returns pubkeys only; later slices merge beacon status/balance + keymanager
 * fee-recipient/graffiti into these rows (by pubkey).
 *
 * @param {Ref<string>|string} nodeId
 */
export function useValidatorKeys(nodeId) {
    // Accept a getter (() => props.nodeId), a ref, or a plain value. `unref` does NOT call
    // functions, so a getter would otherwise be sent over IPC as-is (-> undefined nodeId).
    const resolveNodeId = () => (typeof nodeId === 'function' ? nodeId() : unref(nodeId))

    // serviceId -> { loading, keys: [{ pubkey, readonly, derivationPath? }], error }
    const cache = reactive({})

    async function load(serviceId, { force = false } = {}) {
        if (!serviceId) return
        if (!force && cache[serviceId] && !cache[serviceId].error && !cache[serviceId].loading) return
        // Carry prior beacon states across a (forced) reload so enriched columns / status filters
        // don't blank out mid-refresh; the caller re-enriches right after and updates them.
        const prev = cache[serviceId] || {}
        const keep = { states: prev.states, statesSource: prev.statesSource, statesBase: prev.statesBase }
        cache[serviceId] = { loading: true, keys: [], error: '', ...keep }
        try {
            const res = await window.api.invoke('list-validators', resolveNodeId(), serviceId)
            cache[serviceId] = res?.ok
                ? { loading: false, keys: res.keys || [], error: '', ...keep }
                : { loading: false, keys: [], error: res?.error || (res?.reason === 'api-not-enabled' ? 'Keymanager API not enabled' : 'Could not read keys'), ...keep }
        } catch (e) {
            cache[serviceId] = { loading: false, keys: [], error: e?.message || 'Could not read keys', ...keep }
        }
    }

    /**
     * Enrich a service's already-loaded keys with on-chain beacon state (status/balance/etc.),
     * merged by pubkey. Only meaningful for on-chain holders (solo VC keys, Charon DV pubkeys) -
     * the caller gates this off share holders. `beaconUrl` overrides the beacon the main process
     * would otherwise resolve (this node's running CL, else the one its validator client names).
     */
    async function loadStates(serviceId, pubkeys, beaconUrl) {
        if (!serviceId || !pubkeys?.length) return
        cache[serviceId] = { ...(cache[serviceId] || { keys: [] }), statesLoading: true, statesError: '' }
        try {
            const res = await window.api.invoke('get-validator-states', resolveNodeId(), pubkeys, beaconUrl || null)
            cache[serviceId] = {
                ...cache[serviceId],
                statesLoading: false,
                states: res?.ok ? (res.states || {}) : (cache[serviceId].states || {}),
                statesError: res?.ok ? '' : (res?.error || 'Could not load validator stats'),
                statesSource: res?.source,
                statesBase: res?.base,   // which beacon answered (see _resolveBeaconBase)
            }
        } catch (e) {
            cache[serviceId] = { ...cache[serviceId], statesLoading: false, statesError: e?.message || 'Could not load validator stats' }
        }
    }

    /**
     * The distributed validators behind a validator client that signs through a DVT client on
     * another machine - the content of that Charon's own tab, cached under `cacheId`. There is no
     * cluster-lock.json here, so they are derived from the client's key shares: the main process
     * asks Charon with the shares (stats of the DV each belongs to) and looks up each DV's own pubkey
     * by index (a real beacon, or Charon's own passthrough). Every share with an on-chain validator
     * becomes a row, its stats from Charon; when the DV pubkey could not be resolved the row is
     * keyed `index:<n>` with `pubkeyUnknown` - a share is never shown as if it were the DV pubkey.
     * `unresolved` lists shares with no on-chain validator yet, and `dvByShare` lets the client's
     * own "key shares" tab point each share at its DV.
     */
    async function loadRemoteDvt(cacheId, vcServiceId, beaconUrl) {
        if (!cacheId || !vcServiceId) return
        const prev = cache[cacheId] || {}
        cache[cacheId] = { ...prev, loading: true, keys: prev.keys || [], error: '', statesLoading: true }
        const fail = (error, extra = {}) => {
            cache[cacheId] = { ...cache[cacheId], loading: false, statesLoading: false, keys: [], error, ...extra }
        }
        try {
            const list = await window.api.invoke('list-validators', resolveNodeId(), vcServiceId)
            if (!list?.ok) return fail(list?.error || 'Could not read the key shares from the validator client')
            const shares = (list.keys || []).map((k) => String(k.pubkey))
            const res = await window.api.invoke('get-dvt-validator-states', resolveNodeId(), vcServiceId, shares, beaconUrl || null)
            if (!res?.ok) return fail(res?.error || 'Could not load the distributed validators', { dvt: res?.dvt ?? null })

            const dvByShare = {}
            for (const [share, dv] of Object.entries(res.dvByShare || {})) dvByShare[share.toLowerCase()] = dv
            const keys = []
            const states = {}
            const unresolved = []
            for (const share of shares) {
                const lower = share.toLowerCase()
                const s = res.states?.[lower]
                const dv = dvByShare[lower]
                if (s?.index == null) { unresolved.push({ share }); continue }
                const id = dv || `index:${s.index}`
                keys.push({ pubkey: id, readonly: true, share, pubkeyUnknown: !dv })
                states[id.toLowerCase()] = { ...s, pubkey: id.toLowerCase() }
            }
            cache[cacheId] = {
                ...cache[cacheId], loading: false, statesLoading: false, error: '', statesError: '',
                keys, states, unresolved, dvByShare,
                statesSource: res.source, statesBase: res.base, dvt: res.dvt, dvtLookupError: res.lookupError || '',
            }
        } catch (e) {
            fail(e?.message || 'Could not load the distributed validators')
        }
    }

    /**
     * Load upcoming duties (sync-committee membership, this epoch's proposals) for the keys that
     * already have an on-chain index - duties are keyed by validator index, so a key the beacon has
     * no state for simply has none to report. Runs after `loadStates`, which is what supplies them.
     */
    async function loadDuties(serviceId, indices, beaconUrl) {
        if (!serviceId || !indices?.length) return
        cache[serviceId] = { ...(cache[serviceId] || { keys: [] }), dutiesLoading: true, dutiesError: '' }
        try {
            const res = await window.api.invoke('get-validator-duties', resolveNodeId(), indices, beaconUrl || null)
            cache[serviceId] = {
                ...cache[serviceId],
                dutiesLoading: false,
                duties: res?.ok ? (res.duties || {}) : (cache[serviceId].duties || {}),
                dutiesMeta: res?.ok ? (res.meta || null) : (cache[serviceId].dutiesMeta || null),
                dutiesError: res?.ok ? '' : (res?.error || 'Could not load duties'),
            }
        } catch (e) {
            cache[serviceId] = { ...cache[serviceId], dutiesLoading: false, dutiesError: e?.message || 'Could not load duties' }
        }
    }

    /**
     * Load per-key fee recipient + graffiti from the validator client's keymanager API.
     * Also records `graffitiSupported`: older client builds have no graffiti route, and the UI
     * hides the action rather than offering something that would 404.
     */
    async function loadSettings(serviceId, pubkeys) {
        if (!serviceId || !pubkeys?.length) return
        cache[serviceId] = { ...(cache[serviceId] || { keys: [] }), settingsLoading: true, settingsError: '' }
        try {
            const res = await window.api.invoke('get-validator-settings', resolveNodeId(), serviceId, pubkeys)
            cache[serviceId] = {
                ...cache[serviceId],
                settingsLoading: false,
                settings: res?.ok ? (res.settings || {}) : (cache[serviceId].settings || {}),
                settingsError: res?.ok ? '' : (res?.error || 'Could not load validator settings'),
                // Only a successful read may assert support; a failed read leaves it unproven (undefined).
                graffitiSupported: res?.ok ? res.graffitiSupported !== false : cache[serviceId].graffitiSupported,
            }
        } catch (e) {
            cache[serviceId] = { ...cache[serviceId], settingsLoading: false, settingsError: e?.message || 'Could not load validator settings' }
        }
    }

    const state = (serviceId) => cache[serviceId] ?? { loading: false, keys: [], error: '' }

    return { cache, load, loadStates, loadRemoteDvt, loadDuties, loadSettings, state }
}
