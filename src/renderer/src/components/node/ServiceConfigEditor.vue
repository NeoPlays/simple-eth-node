<template>
    <div class="editor-view">
        <div class="top-bar">
            <button class="btn-ghost" :disabled="saving" @click="reviewing ? (reviewing = false) : cancel()">
                {{ reviewing ? '← Keep editing' : '← Back' }}
            </button>
            <div class="top-bar-center">
                <span class="service-label">{{ route.params.serviceId }}</span>
            </div>
            <div class="top-bar-actions">
                <button
                    v-if="backup?.exists && !reviewing"
                    class="btn-ghost"
                    :disabled="loading || saving"
                    :title="`Version from ${backupTime}, kept when this config was last saved from Stereum Lite`"
                    @click="loadPrevious"
                >
                    Load previous version
                </button>
                <button v-if="!reviewing" class="btn-accent" :disabled="loading || saving || Boolean(loadError)" @click="review">
                    Review changes
                </button>
                <button v-else class="btn-accent" :disabled="saving" @click="save">
                    {{ saving ? 'Saving…' : 'Save' }}
                </button>
            </div>
        </div>

        <div v-if="loading" class="state-message">Loading config…</div>

        <div v-else-if="loadError" class="state-message error">{{ loadError }}</div>

        <template v-else>
            <div v-if="saveError" class="error-banner">{{ saveError }}</div>
            <div v-if="notice" class="info-banner">{{ notice }}</div>

            <template v-if="reviewing">
                <p class="review-note">
                    {{ addedCount }} {{ addedCount === 1 ? 'line' : 'lines' }} added, {{ removedCount }} removed.
                    The current version is kept on the node and can be loaded here again. Changes take effect
                    when the service restarts.
                </p>
                <div class="diff" role="region" aria-label="Changes">
                    <template v-for="(d, i) in diffView" :key="i">
                        <div v-if="d.type === 'skip'" class="diff-skip">{{ d.count }} unchanged {{ d.count === 1 ? 'line' : 'lines' }}</div>
                        <div v-else class="diff-line" :class="d.type">
                            <span class="diff-sign">{{ d.type === 'add' ? '+' : d.type === 'del' ? '-' : ' ' }}</span>
                            <span class="diff-text">{{ d.text || ' ' }}</span>
                        </div>
                    </template>
                </div>
            </template>

            <textarea
                v-else
                v-model="content"
                class="yaml-editor"
                spellcheck="false"
                autocorrect="off"
                autocapitalize="off"
            />
        </template>
    </div>
</template>

<script setup>
import { useRouter, useRoute } from 'vue-router'
import { computed, onMounted, ref } from 'vue'
import { useNodesStore } from '@stores/useNodes'
import { useLocale } from '@renderer/composables/useLocale'
import { formatDateTime } from '@utils/datetime'
import { diffLines, hasChanges, withContext } from '@utils/lineDiff'

const router = useRouter()
const route = useRoute()
const store = useNodesStore()
const { locales } = useLocale()

const original = ref('')            // what is on the node now
const content = ref('')
const backup = ref(null)            // { exists, content, savedAt }
const loading = ref(true)
const saving = ref(false)
const reviewing = ref(false)
const loadError = ref('')
const saveError = ref('')
const notice = ref('')

const diff = computed(() => diffLines(original.value, content.value))
const diffView = computed(() => withContext(diff.value, 3))
const addedCount = computed(() => diff.value.filter((d) => d.type === 'add').length)
const removedCount = computed(() => diff.value.filter((d) => d.type === 'del').length)
const backupTime = computed(() => formatDateTime(backup.value?.savedAt, locales.value))

async function load() {
    loading.value = true
    loadError.value = ''
    try {
        const raw = await window.api.invoke('get-raw-service-config', route.params.id, route.params.serviceId)
        original.value = raw
        content.value = raw
    } catch (err) {
        loadError.value = err?.message || 'Failed to load config'
    } finally {
        loading.value = false
    }
    // A missing backup is normal (never saved from lite yet), so failures only hide the button.
    try {
        const res = await window.api.invoke('get-service-config-backup', route.params.id, route.params.serviceId)
        backup.value = res?.ok ? res : null
    } catch { backup.value = null }
}

function loadPrevious() {
    content.value = backup.value.content
    saveError.value = ''
    notice.value = `Loaded the version from ${backupTime.value}. Review and save to restore it.`
}

function review() {
    saveError.value = ''
    if (!hasChanges(diff.value)) {
        notice.value = 'Nothing has changed.'
        return
    }
    notice.value = ''
    reviewing.value = true
}

async function save() {
    saving.value = true
    saveError.value = ''
    try {
        await window.api.invoke('write-service-config', route.params.id, route.params.serviceId, content.value)
        delete store.nodeCache[route.params.id]
        router.back()
    } catch (err) {
        // Electron prefixes rejected invoke errors; the main process message is what matters.
        saveError.value = String(err?.message || 'Failed to write config').replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
        reviewing.value = false
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
    padding: var(--view-padding);
    gap: var(--space-5);
    overflow: hidden;
}

.top-bar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: var(--space-3);
    flex-shrink: 0;
}

.top-bar-center {
    flex: 1;
    display: flex;
    justify-content: center;
    min-width: 0;
}

.top-bar-actions {
    display: flex;
    gap: var(--space-3);
}

.service-label {
    font-size: var(--font-size-secondary);
    color: var(--ev-c-text-3);
    font-family: var(--font-mono);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.yaml-editor,
.diff {
    flex: 1;
    width: 100%;
    min-height: 0;
    padding: var(--space-5);
    background-color: var(--color-background-soft);
    border: 1px solid var(--ev-c-gray-2);
    border-radius: var(--radius-xl);
    color: var(--ev-c-text-1);
    font-family: var(--font-mono);
    font-size: var(--font-size-button);
    line-height: 1.6;
}

.yaml-editor {
    resize: none;
    outline: none;
    tab-size: 2;
    transition: border-color var(--transition-fast);
}

.yaml-editor:focus {
    border-color: var(--color-accent);
}

.diff {
    overflow: auto;
    padding: var(--space-3) 0;
}

.diff-line {
    display: flex;
    padding: 0 var(--space-5);
    white-space: pre;
}
.diff-line.add { background-color: var(--color-success-soft); }
.diff-line.del { background-color: var(--color-danger-soft); }
.diff-sign { width: 16px; flex-shrink: 0; color: var(--ev-c-text-3); user-select: none; }
.diff-line.add .diff-sign { color: var(--color-success); }
.diff-line.del .diff-sign { color: var(--color-danger); }

.diff-skip {
    padding: var(--space-1) var(--space-5);
    color: var(--ev-c-text-3);
    font-family: var(--font-sans);
    font-size: var(--font-size-meta);
}

.review-note {
    font-size: var(--font-size-secondary);
    color: var(--ev-c-text-2);
    flex-shrink: 0;
}

.state-message {
    color: var(--ev-c-text-2);
    font-size: var(--font-size-body);
    text-align: center;
    padding: var(--space-9);
}
.state-message.error { color: var(--color-danger); }

.error-banner,
.info-banner {
    padding: var(--space-3) var(--space-4);
    border-radius: var(--radius-lg);
    font-size: var(--font-size-button);
    flex-shrink: 0;
}
.error-banner {
    background-color: var(--color-danger-soft);
    border: 1px solid var(--color-danger);
    color: var(--color-danger);
}
.info-banner {
    background-color: var(--color-accent-soft);
    border: 1px solid var(--color-accent);
    color: var(--ev-c-text-1);
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
.btn-ghost:hover:not(:disabled) { background-color: var(--ev-c-gray-3); }
.btn-ghost:disabled { opacity: 0.5; cursor: default; }

.btn-accent {
    padding: var(--button-padding);
    background-color: var(--color-accent);
    color: var(--color-accent-text);
    border: none;
    border-radius: var(--radius-lg);
    cursor: pointer;
    font-size: var(--font-size-button);
    font-weight: var(--font-weight-medium, 500);
    transition: background-color var(--transition-fast), opacity var(--transition-fast);
}
.btn-accent:hover:not(:disabled) { background-color: var(--color-accent-hover); }
.btn-accent:disabled { opacity: 0.5; cursor: default; }
</style>
