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
                @click="router.push(`/node/${node.id}`)"
            >
                <span class="node-name">{{ node.name }}</span>
                <span class="node-host">{{ node.host }}</span>
            </div>
        </div>
    </div>
</template>

<script setup>
import { onMounted } from 'vue'
import { useNodesStore } from '@stores/useNodes'
import { storeToRefs } from 'pinia'
import { useRouter } from 'vue-router'

const router = useRouter()
const store = useNodesStore()
const { nodes } = storeToRefs(store)
const { refreshNodes } = store

onMounted(() => refreshNodes())
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

.node-host {
    font-size: 12px;
    color: var(--ev-c-text-3);
    font-family: ui-monospace, monospace;
}

.empty {
    font-size: 14px;
    color: var(--ev-c-text-3);
    text-align: center;
    padding: 60px 0;
}
</style>
