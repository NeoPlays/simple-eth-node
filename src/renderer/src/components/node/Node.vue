<template>
    <div class="node-view">
        <div class="top-bar">
            <button class="btn-ghost" @click="router.back()">← Back</button>
            <div class="top-bar-actions">
                <button class="btn-accent" @click="refresh" :disabled="loading">
                    {{ loading ? 'Refreshing…' : '↻ Refresh' }}
                </button>
                <button class="btn-danger" @click="disconnect" :disabled="loading">Disconnect</button>
            </div>
        </div>

        <div v-if="loading && !nodeData" class="state-message">Loading node data...</div>

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
                <h2 class="section-title">Services</h2>
                <div v-if="nodeData.services?.length === 0" class="state-message">No services found.</div>
                <div class="service-list">
                    <div class="service-card" v-for="service in nodeData.services" :key="service.id">
                        <div class="service-main">
                            <span class="service-name">{{ service.config?.service ?? service.id }}</span>
                            <span class="service-network" v-if="service.config?.network">{{ service.config.network }}</span>
                        </div>
                        <span class="service-image">{{ service.config?.image ?? '—' }}</span>
                        <span class="service-id">{{ service.id }}</span>
                    </div>
                </div>
            </section>
        </template>
    </div>
</template>

<script setup>
import { useRouter, useRoute } from 'vue-router'
import { onMounted, ref } from 'vue'
import { useNodesStore } from '@stores/useNodes'

const router = useRouter()
const route = useRoute()
const store = useNodesStore()

const nodeData = ref(null)
const loading = ref(true)
const error = ref(false)

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

async function disconnect() {
    await store.disconnectNode(route.params.id)
    router.push('/')
}

onMounted(() => load())
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
    grid-template-columns: 1fr 1fr;
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

.service-image {
    font-size: 12px;
    color: var(--ev-c-text-2);
    text-align: right;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    grid-column: 2;
    grid-row: 1;
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
