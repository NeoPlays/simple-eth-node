<template>
    <div class="updates-view">
        <div v-if="loading" class="loading-scrim">
            <span class="loading-spinner"></span>
        </div>
        <div class="top-bar">
            <button class="btn-ghost" @click="router.back()">← Back</button>
            <div class="top-bar-actions">
                <button class="btn-ghost" @click="refresh" :disabled="loading || !!hostBusy">
                    {{ loading ? 'Refreshing…' : '↻ Refresh' }}
                </button>
                <button class="btn-accent" @click="runFullUpdate" :disabled="loading || !!hostBusy">
                    {{ hostBusy === 'all' ? 'Updating…' : 'Update everything' }}
                </button>
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
                <h1 class="node-name">Updates</h1>
                <div class="copy-rows">
                    <div class="copy-row">
                        <span class="copy-label">Hostname</span>
                        <span class="copy-value mono">{{ nodeData.name }}</span>
                        <button class="btn-copy" @click="copy(nodeData.name, 'hostname')">
                            {{ copied === 'hostname' ? 'Copied' : 'Copy' }}
                        </button>
                    </div>
                    <div class="copy-row">
                        <span class="copy-label">IP address</span>
                        <span class="copy-value mono">{{ nodeData.host }}</span>
                        <button class="btn-copy" @click="copy(nodeData.host, 'ip')">
                            {{ copied === 'ip' ? 'Copied' : 'Copy' }}
                        </button>
                    </div>
                    <button
                        class="btn-accent small copy-updates"
                        @click="copy(availableUpdatesText, 'updates')"
                        :disabled="!availableUpdatesText"
                    >
                        {{ copied === 'updates' ? 'Copied' : 'Copy available updates' }}
                    </button>
                </div>
            </div>

            <section class="section">
                <h2 class="section-title">Host</h2>
                <div class="host-row">
                    <div class="host-info">
                        <span class="host-label">{{ osInfo || 'Operating System' }}</span>
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
                <div class="section-head">
                    <h2 class="section-title">Services</h2>
                    <button
                        v-if="upgradableServices.length > 1"
                        class="btn-accent small"
                        @click="updateAllServices"
                        :disabled="hostBusy || pending.size > 0"
                    >
                        {{ hostBusy === 'services' ? 'Updating…' : `Update all (${upgradableServices.length})` }}
                    </button>
                </div>
                <div v-if="!nodeData.services?.length" class="state-message">No services found.</div>
                <div v-else class="service-list">
                    <div class="host-row" v-for="service in nodeData.services" :key="service.id">
                        <div class="host-info">
                            <div class="service-title">
                                <span class="host-label">{{ service.config?.service ?? service.id }}</span>
                                <span class="service-network" v-if="service.config?.network">{{ service.config.network }}</span>
                            </div>
                            <span v-if="serviceUpdate(service).upgradable" class="version-diff">
                                {{ serviceUpdate(service).current }} <span class="arrow">→</span>
                                <span class="latest">{{ serviceUpdate(service).latest }}</span>
                            </span>
                            <span v-else-if="manifest" class="muted mono">{{ serviceUpdate(service).current ?? service.config?.image ?? '—' }} · up to date</span>
                            <span v-else class="muted">checking…</span>
                        </div>
                        <div class="host-actions">
                            <button
                                v-if="serviceUpdate(service).upgradable"
                                class="btn-edit btn-update"
                                @click="updateService(service.id)"
                                :disabled="pending.has(service.id) || !!hostBusy"
                            >
                                {{ pending.has(service.id) ? '…' : 'Update' }}
                            </button>
                        </div>
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
import { useTasksStore } from '@stores/useTasks'
const router = useRouter()
const route = useRoute()
const store = useNodesStore()
const tasks = useTasksStore()

const nodeData = ref(null)
const loading = ref(true)
const error = ref(false)
const pending = reactive(new Set())

const manifest = ref(null)
const osInfo = ref(null)
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

const upgradableServices = computed(() =>
    (nodeData.value?.services ?? []).filter(s => serviceUpdate(s).upgradable)
)

// Short, human-readable service name: drop the role/suffix noise from the type name
// (e.g. "LighthouseBeaconService" → "Lighthouse", "GethService" → "Geth").
function shortServiceName(service) {
    return (service.config?.service ?? service.id).replace(/Beacon|Service|Validator/g, '').trim()
}

const availableUpdatesText = computed(() => {
    const lines = upgradableServices.value.map(s => `- ${shortServiceName(s)} to ${serviceUpdate(s).latest}`)
    if (controlsInfo.value?.upgradable) lines.push(`- Stereum to ${controlsInfo.value.latestVersion}`)
    if (osPackages.value?.length) lines.push('- OS Updates')
    return lines.join('\n')
})

const copied = ref(null)
let copiedTimer = null
async function copy(text, key) {
    if (!text) return
    try {
        await navigator.clipboard.writeText(text)
    } catch {
        // fallback for contexts where the async clipboard API is unavailable
        const ta = document.createElement('textarea')
        ta.value = text
        ta.style.position = 'fixed'
        ta.style.opacity = '0'
        document.body.appendChild(ta)
        ta.select()
        try { document.execCommand('copy') } catch { /* ignore */ }
        document.body.removeChild(ta)
    }
    copied.value = key
    clearTimeout(copiedTimer)
    copiedTimer = setTimeout(() => { if (copied.value === key) copied.value = null }, 1500)
}
onUnmounted(() => clearTimeout(copiedTimer))

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
    loadOsInfo()
    loadOsPackages()
    loadControlsCommit()
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

async function loadOsInfo() {
    try {
        osInfo.value = await window.api.invoke('get-os-info', route.params.id)
    } catch (e) {
        console.error('get-os-info failed:', e)
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

// Fire a node op as a background task, wait for it to finish (observed via the task
// registry), then refresh. Returns the terminal task so callers can flash by status.
// Errors surface as task.status === 'failed' + task.error — they're not thrown.
async function runTask(action, args, { onDone } = {}) {
    const taskId = await tasks.runNodeTask(route.params.id, action, args)
    const task = await tasks.awaitTask(taskId)
    await refreshAfterUpdate()
    onDone?.(task)
    return task
}

async function updateService(serviceId) {
    pending.add(serviceId)
    try {
        await runTask('update-services', [[serviceId]], {
            onDone: (t) => { if (t?.status === 'failed') flashHost('error', `Service update failed: ${t.error || 'see Tasks'}`) },
        })
    } finally {
        pending.delete(serviceId)
    }
}

async function updateAllServices() {
    const ids = upgradableServices.value.map(s => s.id)
    if (!ids.length || !confirm(`Update ${ids.length} services to their latest images?`)) return
    hostBusy.value = 'services'
    try {
        await runTask('update-services', [ids], {
            onDone: (t) => flashHost(t?.status === 'failed' ? 'error' : 'success',
                t?.status === 'failed' ? `Service update failed: ${t.error || 'see Tasks'}` : `Updated ${ids.length} services.`),
        })
    } finally {
        hostBusy.value = null
    }
}

async function updatePackage(name) {
    pkgBusy.add(name)
    try {
        await runTask('update-package', [name], {
            onDone: (t) => flashHost(t?.status === 'failed' ? 'error' : 'success',
                t?.status === 'failed' ? `Package update failed: ${t.error || 'see Tasks'}` : `Updated ${name}`),
        })
    } finally {
        pkgBusy.delete(name)
    }
}

async function runFullUpdate() {
    if (!confirm('Update stereum controls and all services, then restart everything that changed? This can take a while.')) return
    hostBusy.value = 'all'
    try {
        await runTask('run-full-update', [], {
            onDone: (t) => flashHost(t?.status === 'failed' ? 'error' : 'success',
                t?.status === 'failed' ? `Update failed: ${t.error || 'see Tasks'}` : 'Update complete — see Tasks for details.'),
        })
    } finally {
        hostBusy.value = null
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
        await runTask(kind === 'os' ? 'update-os' : 'update-stereum', [], {
            onDone: (t) => flashHost(t?.status === 'failed' ? 'error' : 'success',
                t?.status === 'failed' ? `${kind} update failed: ${t.error || 'see Tasks'}` : `${kind === 'os' ? 'OS' : 'Node controls'} update completed.`),
        })
    } finally {
        hostBusy.value = null
    }
}

onMounted(async () => {
    await load()
    if (nodeData.value) {
        loadManifest()
        loadOsInfo()
        loadOsPackages()
        loadControlsCommit()
    }
})
</script>

<style scoped>
.updates-view {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    padding: var(--view-padding);
    gap: var(--space-7);
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
    margin-right: var(--space-3);
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
    gap: var(--space-3);
}

.btn-ghost {
    padding: var(--button-padding);
    background-color: transparent;
    color: var(--ev-c-text-2);
    border: 1px solid var(--ev-c-gray-2);
    border-radius: var(--radius-lg);
    cursor: pointer;
    font-size: var(--font-size-button);
    transition: background-color var(--transition-fast), border-color var(--transition-fast);
}
.btn-ghost:hover { background-color: var(--ev-c-gray-3); }
.btn-ghost.small {
    padding: 2px var(--space-3);
    font-size: var(--font-size-meta);
    border-radius: var(--radius-md);
}
.btn-ghost.small:hover:not(:disabled) { background-color: var(--ev-c-gray-3); }

.btn-accent {
    padding: var(--button-padding);
    background-color: var(--color-accent);
    color: var(--color-accent-text);
    border: none;
    border-radius: var(--radius-lg);
    cursor: pointer;
    font-size: var(--font-size-button);
    font-weight: var(--font-weight-medium);
    transition: background-color var(--transition-fast), opacity var(--transition-fast);
}
.btn-accent:hover:not(:disabled) { background-color: var(--color-accent-hover); }
.btn-accent:disabled { opacity: 0.5; cursor: default; }
.btn-accent.small {
    padding: var(--button-padding-small);
    font-size: var(--font-size-secondary);
    border-radius: var(--radius-md);
}

.node-header {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--header-card-padding);
    background-color: var(--color-background-soft);
    border-radius: var(--radius-2xl);
}
.node-name {
    font-size: var(--font-size-page-title);
    font-weight: var(--font-weight-bold);
    color: var(--ev-c-text-1);
}
.copy-rows {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    align-items: flex-start;
}
.copy-row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
}
.copy-label {
    font-size: var(--font-size-meta);
    color: var(--ev-c-text-3);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    min-width: 72px;
}
.copy-value {
    font-size: var(--font-size-secondary);
    color: var(--ev-c-text-2);
}
.btn-copy {
    padding: 1px var(--space-2);
    background-color: transparent;
    color: var(--ev-c-text-3);
    border: 1px solid var(--ev-c-gray-2);
    border-radius: var(--radius-sm);
    cursor: pointer;
    font-size: var(--font-size-meta);
    transition: background-color var(--transition-fast), border-color var(--transition-fast), color var(--transition-fast);
}
.btn-copy:hover { background-color: var(--ev-c-gray-3); color: var(--ev-c-text-2); }
.copy-updates {
    margin-top: var(--space-2);
}

.section-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 10px;
}
.section-title {
    font-size: var(--font-size-button);
    font-weight: var(--font-weight-semibold);
    color: var(--ev-c-text-2);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-bottom: 10px;
}
.section-head .section-title { margin-bottom: 0; }

.service-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
}

.host-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--card-padding);
    background-color: var(--color-background-soft);
    border-radius: var(--radius-xl);
    margin-bottom: var(--space-3);
}
.service-list .host-row { margin-bottom: 0; }
.host-info {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-width: 0;
}
.service-title {
    display: flex;
    align-items: center;
    gap: var(--space-3);
}
.host-label {
    font-size: var(--font-size-title);
    font-weight: var(--font-weight-semibold);
    color: var(--ev-c-text-1);
}
.host-actions {
    display: flex;
    gap: var(--space-2);
    align-items: center;
    flex-shrink: 0;
}
.muted {
    font-size: var(--font-size-secondary);
    color: var(--ev-c-text-2);
}
.muted.error { color: var(--color-danger); }
.muted.mono { font-family: var(--font-mono); }

.service-network {
    font-size: var(--font-size-meta);
    padding: 2px var(--space-2);
    border-radius: var(--radius-sm);
    background-color: var(--color-accent-soft);
    color: var(--color-accent);
    font-weight: var(--font-weight-medium);
}

.pkg-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    margin: 0 0 var(--space-2) var(--space-5);
    padding: var(--space-3) var(--space-4);
    background-color: var(--color-background-mute);
    border-radius: var(--radius-md);
}
.pkg-row {
    display: grid;
    grid-template-columns: 1fr auto auto;
    align-items: center;
    gap: var(--space-4);
    font-size: var(--font-size-secondary);
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
    font-size: var(--font-size-meta);
    display: flex;
    gap: var(--space-1);
    align-items: center;
}
.pkg-versions .arrow, .version-diff .arrow { color: var(--ev-c-text-3); }
.pkg-versions .latest, .version-diff .latest { color: var(--color-success); }

.btn-edit {
    padding: var(--button-padding-small);
    background-color: transparent;
    color: var(--ev-c-text-2);
    border: 1px solid var(--ev-c-gray-2);
    border-radius: var(--radius-md);
    cursor: pointer;
    font-size: var(--font-size-secondary);
    transition: background-color var(--transition-fast), border-color var(--transition-fast);
    white-space: nowrap;
}
.btn-edit:hover:not(:disabled) { background-color: var(--ev-c-gray-3); border-color: var(--ev-c-gray-1); }
.btn-edit:disabled { opacity: 0.4; cursor: default; }
.btn-update {
    color: var(--color-success);
    border-color: var(--color-success);
}
.btn-update:hover:not(:disabled) { background-color: var(--color-success-soft); }

.msg {
    font-size: var(--font-size-secondary);
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-md);
    margin-top: var(--space-2);
}
.msg.success { color: var(--color-success); background-color: var(--color-success-soft); }
.msg.error { color: var(--color-danger); background-color: var(--color-danger-soft); }

.version-diff {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    font-family: var(--font-mono);
    font-size: var(--font-size-meta);
    color: var(--ev-c-text-2);
    padding: 2px var(--space-2);
    border-radius: var(--radius-sm);
    background-color: var(--color-success-soft);
    align-self: flex-start;
}
.version-diff.inline {
    background-color: transparent;
    padding: 0;
}

.controls-version {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    flex-wrap: wrap;
}

.state-message {
    color: var(--ev-c-text-2);
    font-size: var(--font-size-body);
    text-align: center;
    padding: var(--space-9);
}
.state-message.error { color: var(--color-danger); }
</style>
