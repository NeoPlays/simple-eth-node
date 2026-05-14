<template>
    <div class="server-list-panel">
        <h2 class="panel-title">Saved Servers</h2>
        <div class="server-list">
            <div
                class="server-item"
                v-for="s in server"
                :key="s.name"
                @click="setCredentials(s)"
            >
                <span class="server-name">{{ s.name }}</span>
                <span class="server-host">{{ s.host }}</span>
            </div>
            <div v-if="!server?.length" class="empty">No saved servers</div>
        </div>
    </div>
</template>

<script setup>
import { onMounted } from 'vue'
import { storeToRefs } from 'pinia'
import { useServerStore } from '@stores/useServer'

const store = useServerStore()
const { server } = storeToRefs(store)
const { getServer, setCredentials } = store

onMounted(() => getServer())
</script>

<style scoped>
.server-list-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    width: 100%;
    background-color: var(--color-background-soft);
    border-radius: 14px;
    padding: 20px;
    gap: 12px;
}

.panel-title {
    font-size: 14px;
    font-weight: 600;
    color: var(--ev-c-text-2);
    text-transform: uppercase;
    letter-spacing: 0.05em;
}

.server-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
    overflow-y: auto;
    flex: 1;
}

.server-item {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 10px 12px;
    border-radius: 8px;
    background-color: var(--ev-c-gray-3);
    cursor: pointer;
    transition: background-color 150ms;
}

.server-item:hover {
    background-color: var(--ev-c-gray-2);
}

.server-name {
    font-size: 14px;
    font-weight: 500;
    color: var(--ev-c-text-1);
}

.server-host {
    font-size: 12px;
    color: var(--ev-c-text-3);
}

.empty {
    font-size: 13px;
    color: var(--ev-c-text-3);
    text-align: center;
    padding: 24px 0;
}
</style>
