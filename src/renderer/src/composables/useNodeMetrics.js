import { ref, unref } from 'vue'

/**
 * Live node monitoring for the node detail view. Polls the two read-only metrics
 * channels while started; the caller drives start()/stop() from onMounted/onUnmounted
 * (same lifecycle as the container-status poll in Node.vue).
 *
 * System and client metrics are fetched independently - the cheap system strip
 * renders immediately without waiting on the slower `docker run` client probe - and
 * each carries its own in-flight guard (no overlapping ticks) and error. Disk usage
 * is the heavy probe (per-service `du`), so it rides its own much slower interval.
 *
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
            clients.value = await window.api.invoke('get-client-metrics', id())
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
