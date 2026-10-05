import { ref, unref } from 'vue'

/**
 * View-scoped metrics polling; caller drives start()/stop() from mount hooks.
 * System/client fetches are independent (each with its own in-flight guard + error); disk is the heavy `du` probe on its own slower interval.
 * @param {string|import('vue').Ref<string>} nodeId
 * @param {{ intervalMs?: number, diskIntervalMs?: number, shouldPoll?: () => boolean }} [opts]
 */
export function useNodeMetrics(nodeId, { intervalMs = 5000, diskIntervalMs = 30000, shouldPoll = () => true } = {}) {
    const system = ref(null)
    const clients = ref({})
    const disk = ref(null)
    const systemError = ref(null)
    const clientsError = ref(null)
    const diskError = ref(null)
    const loading = ref(false) // true until the first system fetch settles

    let timer = null
    let diskTimer = null
    let systemInFlight = false
    let clientsInFlight = false
    let diskInFlight = false
    // serviceId -> consecutive peer-less probes; carry the last known peer count so one timed-out curl doesn't blank the bar.
    // The inbound/outbound split is counted separately: it can drop out on its own (the probe
    // only reports it when the peer listing agrees with peer_count) while the total is fine.
    const PEER_MISS_LIMIT = 3
    let peerMisses = {}
    let dirMisses = {}

    const id = () => (typeof nodeId === 'function' ? nodeId() : unref(nodeId))

    async function refreshSystem() {
        if (systemInFlight) return
        systemInFlight = true
        try {
            system.value = await window.api.invoke('get-system-metrics', id())
            systemError.value = null
        } catch (e) {
            systemError.value = e?.message || String(e)
        } finally {
            systemInFlight = false
            loading.value = false
        }
    }

    async function refreshClients() {
        if (clientsInFlight) return
        clientsInFlight = true
        try {
            const fresh = await window.api.invoke('get-client-metrics', id())
            for (const [sid, m] of Object.entries(fresh)) {
                const prev = clients.value[sid]
                if (m.error) { peerMisses[sid] = 0; dirMisses[sid] = 0; continue }
                if (m.peers != null) peerMisses[sid] = 0
                else {
                    peerMisses[sid] = (peerMisses[sid] || 0) + 1
                    if (prev?.peers != null && peerMisses[sid] <= PEER_MISS_LIMIT) m.peers = prev.peers
                }
                if (m.peersIn != null) dirMisses[sid] = 0
                else if (prev?.peersIn != null) {
                    dirMisses[sid] = (dirMisses[sid] || 0) + 1
                    if (dirMisses[sid] <= PEER_MISS_LIMIT) { m.peersIn = prev.peersIn; m.peersOut = prev.peersOut }
                }
            }
            clients.value = fresh
            clientsError.value = null
        } catch (e) {
            clientsError.value = e?.message || String(e)
        } finally {
            clientsInFlight = false
        }
    }

    async function refreshDisk() {
        if (diskInFlight) return
        diskInFlight = true
        try {
            disk.value = await window.api.invoke('get-disk-usage', id())
            diskError.value = null
        } catch (e) {
            diskError.value = e?.message || String(e)
        } finally {
            diskInFlight = false
        }
    }

    function refresh() {
        refreshSystem()
        refreshClients()
        refreshDisk()
    }

    function start() {
        stop()
        peerMisses = {}
        dirMisses = {}
        refresh()
        timer = setInterval(() => { if (shouldPoll()) { refreshSystem(); refreshClients() } }, intervalMs)
        diskTimer = setInterval(() => { if (shouldPoll()) refreshDisk() }, diskIntervalMs)
    }

    function stop() {
        if (timer) { clearInterval(timer); timer = null }
        if (diskTimer) { clearInterval(diskTimer); diskTimer = null }
    }

    return { system, clients, disk, systemError, clientsError, diskError, loading, refresh, start, stop }
}
