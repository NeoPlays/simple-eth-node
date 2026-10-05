<template>
    <div class="updates-tab">
        <div class="tab-actions">
            <button class="btn-accent" @click="runFullUpdate" :disabled="!!hostBusy">
                {{ hostBusy === 'all' ? 'Updating…' : 'Update everything' }}
            </button>
            <button class="btn-ghost" @click="copy(availableUpdatesText, 'updates')" :disabled="!availableUpdatesText">
                {{ copied === 'updates' ? 'Copied' : 'Copy available updates' }}
            </button>
            <!-- One status slot for every outcome on this tab (host, policy, services): it sits beside the
                 buttons that usually caused it and never pushes the columns below around. -->
            <div v-if="hostMessage" class="msg" :class="hostMessage.kind" role="status">{{ hostMessage.text }}</div>
        </div>

        <!-- Host state and the policy that keeps it updated read as a pair; side by side when there is room. -->
        <div class="panel host-policy">
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
                        <div class="service-title">
                            <span class="host-label">Node Controls</span>
                            <span v-if="lane === 'dev'" class="lane-chip" title="This node updates from the dev release channel">dev channel</span>
                        </div>
                        <span v-if="controlsInfo" class="muted controls-version">
                            <template v-if="controlsInfo.version">
                                <span class="mono">{{ controlsInfo.version }}</span>
                                <span>(<span class="mono">{{ controlsInfo.commit }}</span>)</span>
                            </template>
                            <template v-else>
                                <span class="mono">{{ controlsInfo.commit }}</span>
                                <span>- not in manifest</span>
                            </template>
                            <span v-if="controlsInfo.upgradable" class="version-diff inline">
                                <span class="arrow">→</span>
                                <span class="latest">{{ controlsInfo.latestVersion }}</span>
                            </span>
                            <span v-else-if="controlsInfo.version">, up to date</span>
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

                <div v-if="updateState && !updateState.yamlError" class="host-row facts-card">
                    <span class="host-label">Stereum installation</span>
                    <dl class="facts">
                        <div class="fact"><dt>Settings file</dt><dd class="mono">/etc/stereum/stereum.yaml</dd></div>
                        <div class="fact"><dt>Controls path</dt><dd class="mono">{{ updateState.controlsPath || '-' }}</dd></div>
                        <div class="fact"><dt>Architecture</dt><dd class="mono">{{ updateState.arch || '-' }}</dd></div>
                        <div class="fact" :title="updateState.cron?.line || ''"><dt>Update cron entry</dt><dd>{{ cronText }}</dd></div>
                    </dl>
                </div>
            </section>

            <UpdatePolicy :node-id="route.params.id" :state="updateState" :error="updateStateError" @reload="loadUpdateState" @flash="flashHost" />
        </div>

            <section class="panel">
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
                <SetupGroups v-else :services="nodeData.services">
                    <template #default="{ service }">
                        <div class="host-row update-row">
                            <div class="host-info">
                                <div class="service-title">
                                    <span class="host-label">{{ service.config?.service ?? service.id }}</span>
                                    <span class="service-network" v-if="!service.setup && service.config?.network">{{ service.config.network }}</span>
                                </div>
                                <span v-if="serviceUpdate(service).upgradable" class="version-diff">
                                    {{ serviceUpdate(service).current }} <span class="arrow">→</span>
                                    <span class="latest">{{ serviceUpdate(service).latest }}</span>
                                </span>
                                <span v-else-if="manifest" class="muted mono">{{ serviceUpdate(service).current ?? service.config?.image ?? '-' }}, up to date</span>
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
                    </template>
                </SetupGroups>
            </section>
    </div>
</template>

<script setup>
import { useRoute } from 'vue-router'
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { useTasksStore } from '@stores/useTasks'
import SetupGroups from './SetupGroups.vue'
import UpdatePolicy from './UpdatePolicy.vue'
import { intervalLabel, hhmm } from '@renderer/utils/updateSchedule'
const route = useRoute()
const tasks = useTasksStore()

// Node data + the loading/error/connection shell are owned by Node.vue; this is a tab.
const props = defineProps({
    nodeData: { type: Object, required: true },
})
const emit = defineEmits(['refresh']) // ask the parent to reload node data after an update

const pending = reactive(new Set())

const manifest = ref(null)
const osInfo = ref(null)
const osPackages = ref(null)
const osPackagesError = ref(null)
const osExpanded = ref(false)
const pkgBusy = reactive(new Set())
const hostBusy = ref(null)
const hostMessage = ref(null)
let hostMessageTimer = null
onUnmounted(() => clearTimeout(hostMessageTimer))
const controlsCommit = ref(null)
const controlsError = ref(null)
const updateState = ref(null)
const updateStateError = ref(null)
// The node's release channel decides which manifest "latest" is measured against.
const lane = computed(() => updateState.value?.updates?.lane || 'stable')
const cronText = computed(() => {
    const c = updateState.value?.cron
    if (!c?.present) return 'none'
    if (c.disabled) return 'present, commented out'
    return `${intervalLabel(c.interval_days).toLowerCase()} at ${hhmm(c.hour, c.min)}`
})

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
    (props.nodeData?.services ?? []).filter(s => serviceUpdate(s).upgradable)
)

// Drop role/suffix noise from the type name ("LighthouseBeaconService" → "Lighthouse").
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
        manifest.value = await window.api.invoke('fetch-updates-manifest', lane.value)
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

async function loadUpdateState() {
    updateStateError.value = null
    try {
        updateState.value = await window.api.invoke('get-update-settings', route.params.id)
    } catch (e) {
        updateStateError.value = e.message || String(e)
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
    clearTimeout(hostMessageTimer)
    hostMessageTimer = setTimeout(() => { if (hostMessage.value?.text === text) hostMessage.value = null }, 6000)
}

// Parent reload triggers the nodeData watch, which re-fetches our host/controls data.
function refreshAfterUpdate() {
    emit('refresh')
}

// Fire a node op as a background task, await it via the task registry, then refresh.
// Errors surface as task.status === 'failed' + task.error - never thrown.
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
                t?.status === 'failed' ? `Update failed: ${t.error || 'see Tasks'}` : 'Update complete - see Tasks for details.'),
        })
    } finally {
        hostBusy.value = null
    }
}

async function runHostUpdate(kind) {
    const prompts = {
        os: osPackages.value?.length
            ? `Update all ${osPackages.value.length} packages? May reboot the host and drop SSH - it will auto-reconnect.`
            : 'Run apt upgrade on this host? May reboot and drop SSH - it will auto-reconnect.',
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

function loadHostData() {
    loadOsInfo()
    loadOsPackages()
    loadControlsCommit()
    loadUpdateState()
}

onMounted(() => {
    loadManifest() // app-global, 5min cache per lane
    loadHostData()
})

// A dev node is compared against updates.dev.json; reload once the lane is known or switched.
watch(lane, () => loadManifest())

// Re-fetch host/controls data whenever the parent reloads the node.
watch(() => props.nodeData, () => loadHostData())
</script>

<style scoped>
.updates-tab {
    display: flex;
    flex-direction: column;
    gap: var(--space-7);
}
/* A bordered frame per area, so section-level actions (Update all) sit in a header row instead of floating. */
.panel {
    padding: var(--space-6);
    border: 1px solid var(--ev-c-gray-3);
    border-radius: var(--radius-2xl);
}
.host-policy {
    display: grid;
    /* min() keeps a single column from overflowing on narrow windows. */
    grid-template-columns: repeat(auto-fit, minmax(min(440px, 100%), 1fr));
    gap: var(--space-7);
    /* Stretch (not start): both columns take the taller one's height, and each column's last card
       grows into the rest, so the two bottoms always line up. */
    align-items: stretch;
}
.host-policy > .section { min-width: 0; }
.host-policy > .section:first-child {
    display: flex;
    flex-direction: column;
}
.host-policy > .section:first-child > :last-child {
    flex: 1 1 auto;
    margin-bottom: 0;
}
.facts {
    /* Flex, not a grid: paths keep their natural width and wrap to a new line instead of truncating. */
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3) var(--space-7);
    margin: 0;
}
/* Same card as the OS / Node Controls rows, stacked: title above the facts instead of beside actions. */
.host-row.facts-card {
    flex-direction: column;
    align-items: stretch;
    justify-content: flex-start; /* it may be stretched to the column height; keep content at the top */
    gap: var(--space-3);
}
.fact { display: flex; flex-direction: column; gap: var(--space-1); min-width: 0; }
.fact dt {
    font-size: var(--font-size-micro);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--ev-c-text-3);
}
.fact dd {
    margin: 0;
    font-size: var(--font-size-secondary);
    color: var(--ev-c-text-2);
    overflow-wrap: anywhere;
}
.tab-actions {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
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
/* Service rows sit inside <SetupGroups> (gap-spaced) - drop the Host-section margin. */
.update-row { margin-bottom: 0; }
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

.lane-chip {
    font-size: var(--font-size-meta);
    padding: 2px var(--space-2);
    border-radius: var(--radius-sm);
    background-color: var(--color-warning-soft);
    color: var(--color-warning);
    font-weight: var(--font-weight-medium);
}

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
