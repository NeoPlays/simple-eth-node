<template>
    <div class="editor-view">
        <div class="top-bar">
            <button class="btn-ghost" @click="cancel" :disabled="saving">← Back</button>
            <div class="top-bar-center">
                <span class="service-label">{{ route.params.serviceId }}</span>
            </div>
            <div class="top-bar-actions">
                <button class="btn-accent" @click="save" :disabled="loading || saving">
                    {{ saving ? 'Saving…' : 'Confirm' }}
                </button>
            </div>
        </div>

        <div v-if="loading" class="state-message">Loading config…</div>

        <div v-else-if="loadError" class="state-message error">{{ loadError }}</div>

        <template v-else>
            <div v-if="saveError" class="error-banner">{{ saveError }}</div>
            <textarea
                class="yaml-editor"
                v-model="content"
                spellcheck="false"
                autocorrect="off"
                autocapitalize="off"
            />
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

const content = ref('')
const loading = ref(true)
const saving = ref(false)
const loadError = ref('')
const saveError = ref('')

async function load() {
    loading.value = true
    loadError.value = ''
    try {
        const raw = await window.api.invoke('get-raw-service-config', route.params.id, route.params.serviceId)
        content.value = raw
    } catch (err) {
        loadError.value = err?.message || 'Failed to load config'
    } finally {
        loading.value = false
    }
}

async function save() {
    saving.value = true
    saveError.value = ''
    try {
        await window.api.invoke('write-service-config', route.params.id, route.params.serviceId, content.value)
        delete store.nodeCache[route.params.id]
        router.back()
    } catch (err) {
        saveError.value = err?.message || 'Failed to write config'
    } finally {
        saving.value = false
    }
}

function cancel() {
    router.back()
}

onMounted(() => load())
</script>

<style scoped>
.editor-view {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    padding: 32px 40px;
    gap: 16px;
    overflow: hidden;
}

.top-bar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-shrink: 0;
}

.top-bar-center {
    flex: 1;
    display: flex;
    justify-content: center;
}

.top-bar-actions {
    display: flex;
    gap: 8px;
}

.service-label {
    font-size: 12px;
    color: var(--ev-c-text-3);
    font-family: var(--font-mono);
}

.yaml-editor {
    flex: 1;
    width: 100%;
    min-height: 0;
    padding: 16px;
    background-color: var(--color-background-soft);
    border: 1px solid var(--ev-c-gray-2);
    border-radius: 10px;
    color: var(--ev-c-text-1);
    font-family: var(--font-mono);
    font-size: 13px;
    line-height: 1.6;
    resize: none;
    outline: none;
    tab-size: 2;
    transition: border-color 150ms;
}

.yaml-editor:focus {
    border-color: var(--color-accent);
}

.state-message {
    color: var(--ev-c-text-2);
    font-size: 14px;
    text-align: center;
    padding: 40px;
}
.state-message.error { color: var(--color-danger); }

.error-banner {
    padding: 10px 12px;
    background-color: var(--color-danger-soft);
    border: 1px solid var(--color-danger);
    border-radius: 8px;
    color: var(--color-danger);
    font-size: 13px;
    flex-shrink: 0;
}

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
.btn-ghost:hover:not(:disabled) { background-color: var(--ev-c-gray-3); }
.btn-ghost:disabled { opacity: 0.5; cursor: default; }

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
</style>
