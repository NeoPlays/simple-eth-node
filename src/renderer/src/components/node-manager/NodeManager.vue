<template>
    <div class="node-manager">
        <div class="header">
            <h1 class="title">Nodes</h1>
            <button class="btn-primary" @click="router.push('/login')">+ Add Node</button>
        </div>

        <div v-if="nodes.length === 0" class="empty">No nodes connected yet.</div>

        <div class="node-list">
            <div
                class="node-card"
                v-for="node in nodes"
                :key="node.id"
                @click="open(node)"
                :class="{ disabled: node.status === 'reconnecting' }"
            >
                <span class="node-name">{{ node.name }}</span>
                <div class="node-card-right">
                    <span class="node-host">{{ node.host }}</span>
                    <span
                        class="connection-badge"
                        :class="node.status || (node.connected ? 'connected' : 'disconnected')"
                        :title="statusLabel(node)"
                    ></span>
                    <button
                        v-if="node.status === 'disconnected'"
                        class="btn-row btn-reconnect"
                        @click.stop="reconnect(node)"
                        :disabled="pending.has(node.id)"
                    >
                        {{ pending.has(node.id) ? '…' : 'Reconnect' }}
                    </button>
                    <button
                        class="btn-row btn-disconnect"
                        @click.stop="disconnect(node)"
                        :disabled="pending.has(node.id) || node.status === 'reconnecting'"
                        :title="node.status === 'disconnected' ? 'Remove from list' : 'Disconnect'"
                    >
                        {{ node.status === 'disconnected' ? 'Remove' : 'Disconnect' }}
                    </button>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup>
import { onMounted, reactive } from 'vue'
import { useNodesStore } from '@stores/useNodes'
import { storeToRefs } from 'pinia'
import { useRouter } from 'vue-router'

const router = useRouter()
const store = useNodesStore()
const { nodes } = storeToRefs(store)
const { refreshNodes } = store
const pending = reactive(new Set())

onMounted(() => refreshNodes())

function statusLabel(node) {
    if (node.status === 'reconnecting') return 'Reconnecting…'
    if (node.status === 'disconnected') return 'Disconnected'
    return 'Connected'
}

function open(node) {
    if (node.status === 'reconnecting') return
    router.push(`/node/${node.id}`)
}

async function reconnect(node) {
    pending.add(node.id)
    try { await store.reconnectNode(node.id) }
    finally { pending.delete(node.id) }
}

async function disconnect(node) {
    pending.add(node.id)
    try { await store.disconnectNode(node.id) }
    finally { pending.delete(node.id) }
}
</script>

<style scoped>
.node-manager {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    padding: 32px 40px;
    gap: 20px;
}

.header {
    display: flex;
    align-items: center;
    justify-content: space-between;
}

.title {
    font-size: 22px;
    font-weight: 700;
    color: var(--ev-c-text-1);
}

.btn-primary {
    padding: 8px 18px;
    background-color: #94C5CC;
    color: #000;
    border: none;
    border-radius: 8px;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: background-color 150ms;
}
.btn-primary:hover { background-color: #7AAEB5; }

.node-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.node-card {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 18px;
    background-color: var(--color-background-soft);
    border-radius: 10px;
    cursor: pointer;
    transition: background-color 150ms;
}
.node-card:hover { background-color: var(--ev-c-gray-2); }

.node-name {
    font-size: 15px;
    font-weight: 600;
    color: var(--ev-c-text-1);
}

.node-card-right {
    display: flex;
    align-items: center;
    gap: 10px;
}

.node-host {
    font-size: 12px;
    color: var(--ev-c-text-3);
    font-family: ui-monospace, monospace;
}

.connection-badge {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
}
.connection-badge.connected { background-color: #4CAF50; }
.connection-badge.disconnected { background-color: #e05252; }
.connection-badge.reconnecting {
    background-color: #e5c07b;
    animation: pulse 1.2s ease-in-out infinite;
}
@keyframes pulse {
    0%, 100% { opacity: 0.4; }
    50% { opacity: 1; }
}

.node-card.disabled { cursor: default; }
.node-card.disabled:hover { background-color: var(--color-background-soft); }

.btn-row {
    padding: 4px 10px;
    border-radius: 6px;
    cursor: pointer;
    font-size: 12px;
    font-weight: 500;
    border: 1px solid;
    background-color: transparent;
    transition: background-color 150ms;
    white-space: nowrap;
}
.btn-row:disabled { opacity: 0.4; cursor: default; }

.btn-reconnect {
    color: #94C5CC;
    border-color: #94C5CC;
}
.btn-reconnect:hover:not(:disabled) { background-color: rgba(148, 197, 204, 0.1); }

.btn-disconnect {
    color: #e06c75;
    border-color: #e06c75;
}
.btn-disconnect:hover:not(:disabled) { background-color: rgba(224, 108, 117, 0.1); }

.empty {
    font-size: 14px;
    color: var(--ev-c-text-3);
    text-align: center;
    padding: 60px 0;
}
</style>
