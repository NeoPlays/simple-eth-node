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

        <div v-if="error" class="state-message error">
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
                        </div>
                        <div class="service-actions">
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
import { onMounted, onUnmounted, reactive, ref } from 'vue'
import { useNodesStore } from '@stores/useNodes'

const router = useRouter()
const route = useRoute()
const store = useNodesStore()

const nodeData = ref(null)
const loading = ref(true)
const error = ref(false)
const pending = reactive(new Set())

async function load(force = false) {
    loading.value = true
    error.value = false
    const result = await (force ? store.refreshNode(route.params.id) : store.getNode(route.params.id))
    if (!result) {
        error.value = true
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

async function disconnect() {
    await store.disconnectNode(route.params.id)
    router.push('/')
}

let statusInterval = null

onMounted(async () => {
    await load()
    statusInterval = setInterval(async () => {
        if (nodeData.value && !loading.value) await refreshContainerStatuses()
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
    border-top-color: #94C5CC;
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
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
    color: #e06c75;
    border: 1px solid #e06c75;
    border-radius: 8px;
    cursor: pointer;
    font-size: 13px;
    font-weight: 500;
    transition: background-color 150ms;
}
.btn-danger:hover:not(:disabled) { background-color: rgba(224, 108, 117, 0.1); }
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
    background-color: #94C5CC;
    color: #000;
    border: none;
    border-radius: 8px;
    cursor: pointer;
    font-size: 13px;
    font-weight: 500;
    transition: background-color 150ms, opacity 150ms;
}
.btn-accent:hover:not(:disabled) { background-color: #7AAEB5; }
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
    font-family: ui-monospace, monospace;
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
    background-color: #94C5CC22;
    color: #94C5CC;
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
    color: #98c379;
    border-color: #98c379;
}
.btn-start:hover:not(:disabled) { background-color: rgba(152, 195, 121, 0.1); }

.btn-stop {
    background-color: transparent;
    color: #e06c75;
    border-color: #e06c75;
}
.btn-stop:hover:not(:disabled) { background-color: rgba(224, 108, 117, 0.1); }

.btn-restart {
    background-color: transparent;
    color: #e5c07b;
    border-color: #e5c07b;
}
.btn-restart:hover:not(:disabled) { background-color: rgba(229, 192, 123, 0.1); }

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
    font-size: 11px;
    color: var(--ev-c-text-3);
}
.status-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    flex-shrink: 0;
    background-color: var(--ev-c-gray-1);
}
.container-status.running .status-dot { background-color: #98c379; }
.container-status.exited .status-dot,
.container-status.dead .status-dot  { background-color: #e06c75; }
.container-status.paused .status-dot,
.container-status.restarting .status-dot { background-color: #e5c07b; }

.service-image {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: var(--ev-c-text-2);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    grid-column: 1;
}

.image-label {
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
    font-family: ui-monospace, monospace;
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
.state-message.error { color: #e06c75; }
</style>
