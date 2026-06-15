<template>
    <div class="node-view">
        <div v-if="loading" class="loading-scrim">
            <span class="loading-spinner"></span>
        </div>
        <div class="top-bar">
            <button class="btn-ghost" @click="router.back()">← Back</button>
            <div class="top-bar-actions">
                <button class="btn-accent" @click="refresh" :disabled="loading">
                    {{ loading ? 'Refreshing…' : '↻ Refresh' }}
                </button>
                <button class="btn-danger" @click="disconnect" :disabled="loading">Disconnect</button>
            </div>
        </div>

        <div v-if="reconnecting" class="state-message">
            <span class="loading-spinner inline"></span>
            Reconnecting to {{ nodeHost }}…
        </div>

        <div v-else-if="disconnected" class="state-message error">
            Connection to this node was lost. Return to the node list to reconnect or remove it.
        </div>

        <div v-else-if="error" class="state-message error">
            Failed to load node. Check your SSH connection and try again.
        </div>

        <template v-else-if="nodeData">
            <div class="node-header">
                <h1 class="node-name">{{ nodeData.name }}</h1>
                <div class="node-meta">
                    <span class="meta-tag">{{ nodeData.host }}:{{ nodeData.port }}</span>
                    <span class="meta-tag">{{ nodeData.username }}</span>
                </div>
            </div>

            <section class="section">
                <h2 class="section-title">Host</h2>
                <div class="host-row">
                    <div class="host-info">
                        <span class="host-label">Operating System</span>
                        <span v-if="osPackages" class="muted">
                            {{ osPackages.length ? `${osPackages.length} package${osPackages.length === 1 ? '' : 's'} upgradable` : 'up to date' }}
                        </span>
                        <span v-else-if="osPackagesError" class="muted error">{{ osPackagesError }}</span>
                        <span v-else class="muted">checking…</span>
                    </div>
                    <div class="host-actions">
                        <button v-if="osPackages?.length" class="btn-ghost small" @click="osExpanded = !osExpanded">
                            {{ osExpanded ? 'Hide list' : 'Show list' }}
                        </button>
                        <button class="btn-edit" @click="runHostUpdate('os')" :disabled="hostBusy">
                            {{ hostBusy === 'os' ? 'Updating…' : 'Update OS' }}
                        </button>
                    </div>
                </div>
                <div v-if="osExpanded && osPackages?.length" class="pkg-list">
                    <div v-for="pkg in osPackages" :key="pkg.name" class="pkg-row">
                        <span class="pkg-name">{{ pkg.name }}</span>
                        <span class="pkg-versions">
                            <span>{{ pkg.currentVersion }}</span>
                            <span class="arrow">→</span>
                            <span class="latest">{{ pkg.newVersion }}</span>
                        </span>
                        <button class="btn-edit" @click="updatePackage(pkg.name)" :disabled="pkgBusy.has(pkg.name) || hostBusy === 'os'">
                            {{ pkgBusy.has(pkg.name) ? '…' : 'Update' }}
                        </button>
                    </div>
                </div>

                <div class="host-row">
                    <div class="host-info">
                        <span class="host-label">Node Controls</span>
                        <span v-if="controlsInfo" class="muted controls-version">
                            <template v-if="controlsInfo.version">
                                <span class="mono">{{ controlsInfo.version }}</span>
                                <span>(<span class="mono">{{ controlsInfo.commit }}</span>)</span>
                            </template>
                            <template v-else>
                                <span class="mono">{{ controlsInfo.commit }}</span>
                                <span>— not in manifest</span>
                            </template>
                            <span v-if="controlsInfo.upgradable" class="version-diff inline">
                                <span class="arrow">→</span>
                                <span class="latest">{{ controlsInfo.latestVersion }}</span>
                            </span>
                            <span v-else-if="controlsInfo.version">· up to date</span>
                        </span>
                        <span v-else-if="controlsError" class="muted error">{{ controlsError }}</span>
                        <span v-else class="muted">checking…</span>
                    </div>
                    <div class="host-actions">
                        <button class="btn-edit" @click="runHostUpdate('stereum')" :disabled="hostBusy">
                            {{ hostBusy === 'stereum' ? 'Updating…' : 'Update Node Controls' }}
                        </button>
                    </div>
                </div>

                <div v-if="hostMessage" class="msg" :class="hostMessage.kind">{{ hostMessage.text }}</div>
            </section>

            <section class="section">
                <h2 class="section-title">Services</h2>
                <div v-if="nodeData.services?.length === 0" class="state-message">No services found.</div>
                <div class="service-list">
                    <div class="service-card" v-for="service in nodeData.services" :key="service.id">
                        <div class="service-main">
                            <span class="service-name">{{ service.config?.service ?? service.id }}</span>
                            <span class="service-network" v-if="service.config?.network">{{ service.config.network }}</span>
                            <span v-if="service.container" class="container-status" :class="service.container.state">
                                <span class="status-dot"></span>{{ service.container.status }}
                            </span>
                            <span v-else class="container-status unknown">
                                <span class="status-dot"></span>unknown
                            </span>
                            <span v-if="serviceUpdate(service).upgradable" class="version-diff">
                                {{ serviceUpdate(service).current }} <span class="arrow">→</span>
                                <span class="latest">{{ serviceUpdate(service).latest }}</span>
                            </span>
                        </div>
                        <div class="service-actions">
                            <button
                                v-if="serviceUpdate(service).upgradable"
                                class="btn-service-action btn-update"
                                @click="updateService(service.id)"
                                :disabled="pending.has(service.id)"
                            >
                                {{ pending.has(service.id) ? '…' : 'Update' }}
                            </button>
                            <button
                                class="btn-service-action"
                                :class="isRunning(service) ? 'btn-stop' : 'btn-start'"
                                @click="toggleService(service)"
                                :disabled="pending.has(service.id)"
                            >
                                {{ pending.has(service.id) ? '…' : isRunning(service) ? 'Stop' : 'Start' }}
                            </button>
                            <button
                                v-if="isRunning(service)"
                                class="btn-service-action btn-restart"
                                @click="restartService(service)"
                                :disabled="pending.has(service.id)"
                            >
                                {{ pending.has(service.id) ? '…' : 'Restart' }}
                            </button>
                            <button class="btn-edit" @click="editService(service.id)" :disabled="pending.has(service.id)">Edit</button>
                        </div>
                        <span class="service-image">
                            <span class="image-label">config</span>{{ service.config?.image ?? '—' }}
                        </span>
                        <span v-if="service.container?.image" class="service-image">
                            <span class="image-label">running</span>{{ service.container.image }}
                        </span>
                        <span class="service-id">{{ service.id }}</span>
                    </div>
                </div>
            </section>
        </template>
    </div>
</template>

<script setup>
import { useRouter, useRoute } from 'vue-router'
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue'
import { useNodesStore } from '@stores/useNodes'
const router = useRouter()
const route = useRoute()
const store = useNodesStore()

const nodeData = ref(null)
const loading = ref(true)
const error = ref(false)
const pending = reactive(new Set())

const manifest = ref(null)
const osPackages = ref(null)
const osPackagesError = ref(null)
const osExpanded = ref(false)
const pkgBusy = reactive(new Set())
const hostBusy = ref(null)
const hostMessage = ref(null)
const controlsCommit = ref(null)
const controlsError = ref(null)

const controlsInfo = computed(() => {
    if (!controlsCommit.value) return null
    const info = { commit: controlsCommit.value, version: null, latestVersion: null, upgradable: false }
    const entries = manifest.value?.stereum
    if (!Array.isArray(entries) || !entries.length) return info
    const current = entries.find(e => e?.commit === controlsCommit.value)
    if (current) info.version = current.name
    const latest = entries[entries.length - 1]
    if (info.version && latest?.name && latest.name !== info.version) {
        info.latestVersion = latest.name
        info.upgradable = true
    }
    return info
})

const nodeStatus = computed(() => {
    const n = store.nodes.find(n => n.id === route.params.id)
    return n?.status
})
const disconnected = computed(() => nodeStatus.value === 'disconnected')
const reconnecting = computed(() => nodeStatus.value === 'reconnecting')
const nodeHost = computed(() => store.nodes.find(n => n.id === route.params.id)?.host)

async function load(force = false) {
    loading.value = true
    error.value = false
    const result = await (force ? store.refreshNode(route.params.id) : store.getNode(route.params.id))
    if (!result) {
        error.value = !store.isDisconnected(route.params.id)
    } else {
        nodeData.value = result
    }
    loading.value = false
}

function refresh() {
    load(true)
}

function editService(serviceId) {
    router.push({ name: 'ServiceConfig', params: { id: route.params.id, serviceId } })
}

function isRunning(service) {
    return service.container?.state === 'running' || service.container?.state === 'restarting'
}

async function refreshContainerStatuses() {
    const statuses = await window.api.invoke('get-container-statuses', route.params.id)
    for (const service of nodeData.value.services) {
        service.container = statuses[service.id] ?? null
    }
}

async function toggleService(service) {
    const serviceId = service.id
    pending.add(serviceId)
    try {
        await window.api.invoke(isRunning(service) ? 'stop-service' : 'start-service', route.params.id, serviceId)
        await refreshContainerStatuses()
    } finally {
        pending.delete(serviceId)
    }
}

async function restartService(service) {
    const serviceId = service.id
    pending.add(serviceId)
    try {
        await window.api.invoke('restart-service', route.params.id, serviceId)
        await refreshContainerStatuses()
    } finally {
        pending.delete(serviceId)
    }
}

function parseImageTag(image) {
    if (!image) return null
    const idx = image.lastIndexOf(':')
    return idx < 0 ? null : image.slice(idx + 1)
}

function serviceUpdate(service) {
    const serviceType = service.config?.service
    const network = service.config?.network
    const current = parseImageTag(service.config?.image)
    const versions = manifest.value?.[network]?.[serviceType] ?? null
    const latest = versions?.length ? versions[versions.length - 1] : null
    return { current, latest, upgradable: !!(latest && current && latest !== current) }
}

async function loadManifest() {
    try {
        manifest.value = await window.api.invoke('fetch-updates-manifest')
    } catch (e) {
        console.error('fetch-updates-manifest failed:', e)
    }
}

async function loadControlsCommit() {
    controlsError.value = null
    try {
        controlsCommit.value = await window.api.invoke('get-controls-commit', route.params.id)
    } catch (e) {
        controlsError.value = e.message || String(e)
    }
}

async function loadOsPackages() {
    osPackagesError.value = null
    try {
        osPackages.value = await window.api.invoke('get-upgradable-packages', route.params.id)
    } catch (e) {
        osPackagesError.value = e.message || String(e)
    }
}

function flashHost(kind, text) {
    hostMessage.value = { kind, text }
    setTimeout(() => { if (hostMessage.value?.text === text) hostMessage.value = null }, 5000)
}

async function refreshAfterUpdate() {
    await load(true)
    await Promise.all([loadOsPackages(), loadControlsCommit()])
}

async function updateService(serviceId) {
    pending.add(serviceId)
    try {
        await window.api.invoke('update-services', route.params.id, [serviceId])
        await refreshAfterUpdate()
    } catch (e) {
        console.error('update-services failed:', e)
        alert(`Service update failed: ${e.message || e}`)
    } finally {
        pending.delete(serviceId)
    }
}

async function updatePackage(name) {
    pkgBusy.add(name)
    try {
        await window.api.invoke('update-package', route.params.id, name)
        flashHost('success', `Updated ${name}`)
        await refreshAfterUpdate()
    } catch (e) {
        flashHost('error', `Package update failed: ${e.message || e}`)
    } finally {
        pkgBusy.delete(name)
    }
}

async function runHostUpdate(kind) {
    const prompts = {
        os: osPackages.value?.length
            ? `Update all ${osPackages.value.length} packages? May reboot the host and drop SSH — it will auto-reconnect.`
            : 'Run apt upgrade on this host? May reboot and drop SSH — it will auto-reconnect.',
        stereum: 'Update stereum controls on this host?',
    }
    if (!confirm(prompts[kind])) return
    hostBusy.value = kind
    try {
        await window.api.invoke(kind === 'os' ? 'update-os' : 'update-stereum', route.params.id)
        flashHost('success', `${kind === 'os' ? 'OS' : 'Node controls'} update completed.`)
        await refreshAfterUpdate()
    } catch (e) {
        flashHost('error', `${kind} update failed: ${e.message || e}`)
    } finally {
        hostBusy.value = null
    }
}

async function disconnect() {
    await store.disconnectNode(route.params.id)
    router.push('/')
}

let statusInterval = null

onMounted(async () => {
    await load()
    if (nodeData.value) {
        loadManifest()
        loadOsPackages()
        loadControlsCommit()
    }
    statusInterval = setInterval(async () => {
        if (nodeData.value && !loading.value && !store.isDisconnected(route.params.id)) {
            await refreshContainerStatuses()
        }
    }, 10_000)
})

onUnmounted(() => clearInterval(statusInterval))
</script>

<style scoped>
.node-view {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    padding: 32px 40px;
    gap: 24px;
    overflow-y: auto;
    position: relative;
}

.loading-scrim {
    position: fixed;
    inset: 0;
    background-color: rgba(0, 0, 0, 0.4);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10;
    border-radius: inherit;
}

.loading-spinner {
    width: 24px;
    height: 24px;
    border: 3px solid rgba(148, 197, 204, 0.3);
    border-top-color: var(--color-accent);
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
}
.loading-spinner.inline {
    width: 14px;
    height: 14px;
    border-width: 2px;
    display: inline-block;
    vertical-align: middle;
    margin-right: 8px;
}

@keyframes spin {
    to { transform: rotate(360deg); }
}

.top-bar {
    display: flex;
    justify-content: space-between;
    align-items: center;
}

.top-bar-actions {
    display: flex;
    gap: 8px;
}

.btn-danger {
    padding: 7px 14px;
    background-color: transparent;
    color: var(--color-danger);
    border: 1px solid var(--color-danger);
    border-radius: 8px;
    cursor: pointer;
    font-size: 13px;
    font-weight: 500;
    transition: background-color 150ms;
}
.btn-danger:hover:not(:disabled) { background-color: var(--color-danger-soft); }
.btn-danger:disabled { opacity: 0.5; cursor: default; }

.btn-ghost {
    padding: 7px 14px;
    background-color: transparent;
    color: var(--ev-c-text-2);
    border: 1px solid var(--ev-c-gray-2);
    border-radius: 8px;
    cursor: pointer;
    font-size: 13px;
    transition: background-color 150ms, border-color 150ms;
}
.btn-ghost:hover { background-color: var(--ev-c-gray-3); }

.btn-accent {
    padding: 7px 14px;
    background-color: var(--color-accent);
    color: var(--color-accent-text);
    border: none;
    border-radius: 8px;
    cursor: pointer;
    font-size: 13px;
    font-weight: 500;
    transition: background-color 150ms, opacity 150ms;
}
.btn-accent:hover:not(:disabled) { background-color: var(--color-accent-hover); }
.btn-accent:disabled { opacity: 0.5; cursor: default; }

.node-header {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 20px 24px;
    background-color: var(--color-background-soft);
    border-radius: 12px;
}

.node-name {
    font-size: 22px;
    font-weight: 700;
    color: var(--ev-c-text-1);
}

.node-meta {
    display: flex;
    gap: 8px;
}

.meta-tag {
    font-size: 12px;
    color: var(--ev-c-text-3);
    background-color: var(--ev-c-gray-3);
    padding: 3px 8px;
    border-radius: 4px;
    font-family: var(--font-mono);
}

.section-title {
    font-size: 13px;
    font-weight: 600;
    color: var(--ev-c-text-2);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-bottom: 10px;
}

.service-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.service-card {
    display: grid;
    grid-template-columns: 1fr auto;
    grid-template-rows: auto auto;
    align-items: center;
    padding: 14px 18px;
    background-color: var(--color-background-soft);
    border-radius: 10px;
    gap: 4px 8px;
}

.service-main {
    display: flex;
    align-items: center;
    gap: 8px;
    grid-column: 1;
    grid-row: 1;
}

.service-name {
    font-size: 15px;
    font-weight: 600;
    color: var(--ev-c-text-1);
}

.service-network {
    font-size: 11px;
    padding: 2px 7px;
    border-radius: 4px;
    background-color: var(--color-accent-soft);
    color: var(--color-accent);
    font-weight: 500;
}

.service-actions {
    grid-column: 2;
    grid-row: 1;
    display: flex;
    gap: 6px;
    align-items: center;
}

.btn-service-action {
    padding: 4px 10px;
    border-radius: 6px;
    cursor: pointer;
    font-size: 12px;
    font-weight: 500;
    border: 1px solid;
    transition: background-color 150ms, opacity 150ms;
    white-space: nowrap;
    min-width: 44px;
}
.btn-service-action:disabled { opacity: 0.4; cursor: default; }

.btn-start {
    background-color: transparent;
    color: var(--color-success);
    border-color: var(--color-success);
}
.btn-start:hover:not(:disabled) { background-color: var(--color-success-soft); }

.btn-stop {
    background-color: transparent;
    color: var(--color-danger);
    border-color: var(--color-danger);
}
.btn-stop:hover:not(:disabled) { background-color: var(--color-danger-soft); }

.btn-restart {
    background-color: transparent;
    color: var(--color-warning);
    border-color: var(--color-warning);
}
.btn-restart:hover:not(:disabled) { background-color: var(--color-warning-soft); }

.btn-edit {
    padding: 4px 10px;
    background-color: transparent;
    color: var(--ev-c-text-2);
    border: 1px solid var(--ev-c-gray-2);
    border-radius: 6px;
    cursor: pointer;
    font-size: 12px;
    transition: background-color 150ms, border-color 150ms;
    white-space: nowrap;
}
.btn-edit:hover:not(:disabled) { background-color: var(--ev-c-gray-3); border-color: var(--ev-c-gray-1); }
.btn-edit:disabled { opacity: 0.4; cursor: default; }

.container-status {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: 12px;
    color: var(--ev-c-text-2);
}
.status-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    flex-shrink: 0;
    background-color: var(--ev-c-gray-1);
}
.container-status.running .status-dot { background-color: var(--color-success); }
.container-status.exited .status-dot,
.container-status.dead .status-dot  { background-color: var(--color-danger); }
.container-status.paused .status-dot,
.container-status.restarting .status-dot { background-color: var(--color-warning); }

.service-image {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: var(--ev-c-text-2);
    font-family: var(--font-mono);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    grid-column: 1;
}

.image-label {
    font-family: var(--font-sans);
    font-size: 10px;
    color: var(--ev-c-text-3);
    background-color: var(--ev-c-gray-3);
    padding: 1px 5px;
    border-radius: 3px;
    flex-shrink: 0;
}

.service-id {
    font-size: 11px;
    color: var(--ev-c-text-3);
    font-family: var(--font-mono);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    grid-column: 1 / -1;
}

.state-message {
    color: var(--ev-c-text-2);
    font-size: 14px;
    text-align: center;
    padding: 40px;
}
.state-message.error { color: var(--color-danger); }

.host-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 18px;
    background-color: var(--color-background-soft);
    border-radius: 10px;
    margin-bottom: 8px;
}
.host-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
}
.host-label {
    font-size: 15px;
    font-weight: 600;
    color: var(--ev-c-text-1);
}
.host-actions {
    display: flex;
    gap: 6px;
    align-items: center;
}
.muted {
    font-size: 12px;
    color: var(--ev-c-text-2);
}
.muted.error {
    color: var(--color-danger);
}
.btn-ghost.small {
    padding: 2px 8px;
    font-size: 11px;
    background-color: transparent;
    color: var(--ev-c-text-2);
    border: 1px solid var(--ev-c-gray-2);
    border-radius: 6px;
    cursor: pointer;
}
.btn-ghost.small:hover:not(:disabled) { background-color: var(--ev-c-gray-3); }

.pkg-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin: 0 0 6px 16px;
    padding: 8px 12px;
    background-color: var(--color-background-mute);
    border-radius: 6px;
}
.pkg-row {
    display: grid;
    grid-template-columns: 1fr auto auto;
    align-items: center;
    gap: 12px;
    font-size: 12px;
}
.pkg-name {
    font-family: var(--font-mono);
    color: var(--ev-c-text-1);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.pkg-versions {
    font-family: var(--font-mono);
    color: var(--ev-c-text-2);
    font-size: 11px;
    display: flex;
    gap: 4px;
    align-items: center;
}
.pkg-versions .arrow, .version-diff .arrow { color: var(--ev-c-text-3); }
.pkg-versions .latest, .version-diff .latest { color: var(--color-success); }

.msg {
    font-size: 12px;
    padding: 6px 10px;
    border-radius: 6px;
    margin-top: 6px;
}
.msg.success { color: var(--color-success); background-color: var(--color-success-soft); }
.msg.error { color: var(--color-danger); background-color: var(--color-danger-soft); }

.version-diff {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--ev-c-text-2);
    padding: 2px 7px;
    border-radius: 4px;
    background-color: var(--color-success-soft);
}
.version-diff.inline {
    background-color: transparent;
    padding: 0;
}

.controls-version {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    flex-wrap: wrap;
}

.btn-update {
    background-color: transparent;
    color: var(--color-success);
    border-color: var(--color-success);
}
.btn-update:hover:not(:disabled) { background-color: var(--color-success-soft); }
</style>
