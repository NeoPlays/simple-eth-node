<template>
    <div class="logs-view">
        <div class="top-bar">
            <button class="btn-ghost" @click="back">← Back</button>
            <div class="top-bar-center">
                <span class="service-label mono">{{ route.params.serviceId }}</span>
                <span class="state-pill" :class="state">{{ state }}</span>
            </div>
            <div class="top-bar-actions">
                <label class="follow-toggle" :title="follow ? 'Auto-scroll on' : 'Auto-scroll off'">
                    <input type="checkbox" v-model="follow" /> Follow
                </label>
                <button class="btn-ghost" @click="copyAll" :disabled="!lines.length">Copy</button>
                <button class="btn-ghost" @click="clear" :disabled="!lines.length">Clear</button>
            </div>
        </div>

        <div v-if="error" class="error-banner">{{ error }}</div>

        <div ref="scrollEl" class="log-scroll" @scroll="onScroll">
            <div v-if="!lines.length && state === 'streaming'" class="empty">Waiting for output…</div>
            <div v-else-if="!lines.length" class="empty">No logs yet.</div>
            <div v-for="(line, i) in lines" :key="i" class="log-line">
                <span v-for="(seg, j) in parseAnsi(line)" :key="j" :class="seg.classes">{{ seg.text }}</span>
            </div>
        </div>
    </div>
</template>

<script setup>
import { useRouter, useRoute } from 'vue-router'
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { parseAnsi, stripAnsi } from '@utils/ansi'

const router = useRouter()
const route = useRoute()

const MAX_BUFFER = 5000
const lines = ref([])
const follow = ref(true)
const state = ref('connecting') // connecting | streaming | closed | error
const error = ref('')
const scrollEl = ref(null)

let sessionId = null
let unsubData = null
let unsubClosed = null
let pendingScroll = false

async function start() {
    state.value = 'connecting'
    error.value = ''
    try {
        sessionId = await window.api.invoke('service-logs-start', route.params.id, route.params.serviceId, 500)
        state.value = 'streaming'
        unsubData = window.api.on('service-log-data', (payload) => {
            if (payload.sessionId !== sessionId) return
            lines.value.push(payload.line)
            if (lines.value.length > MAX_BUFFER) {
                lines.value.splice(0, lines.value.length - MAX_BUFFER)
            }
            if (follow.value) scheduleScroll()
        })
        unsubClosed = window.api.on('service-log-closed', (payload) => {
            if (payload.sessionId !== sessionId) return
            state.value = payload.error ? 'error' : 'closed'
            if (payload.error) error.value = payload.error
        })
    } catch (e) {
        state.value = 'error'
        error.value = e?.message || String(e)
    }
}

function scheduleScroll() {
    if (pendingScroll) return
    pendingScroll = true
    nextTick(() => {
        pendingScroll = false
        const el = scrollEl.value
        if (el) el.scrollTop = el.scrollHeight
    })
}

function onScroll() {
    if (!follow.value) return
    const el = scrollEl.value
    if (!el) return
    // Disable follow if the user scrolled up by more than ~one screen
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 20
    if (!atBottom) follow.value = false
}

async function stop() {
    unsubData?.(); unsubData = null
    unsubClosed?.(); unsubClosed = null
    if (sessionId) {
        try { await window.api.invoke('service-logs-stop', sessionId) } catch { /* ignore */ }
        sessionId = null
    }
}

function clear() {
    lines.value = []
}

async function copyAll() {
    try { await navigator.clipboard.writeText(lines.value.map(stripAnsi).join('\n')) } catch { /* ignore */ }
}

function back() {
    router.back()
}

onMounted(start)
onBeforeUnmount(stop)
</script>

<style scoped>
.logs-view {
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
    align-items: center;
    gap: var(--space-3);
}

.top-bar-actions {
    display: flex;
    gap: var(--space-3);
    align-items: center;
}

.service-label {
    font-size: var(--font-size-secondary);
    color: var(--ev-c-text-3);
}

.state-pill {
    font-size: var(--font-size-meta);
    padding: 2px var(--space-3);
    border-radius: var(--radius-sm);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    background-color: var(--ev-c-gray-3);
    color: var(--ev-c-text-2);
}
.state-pill.streaming {
    background-color: var(--color-success-soft);
    color: var(--color-success);
}
.state-pill.connecting {
    background-color: var(--color-warning-soft);
    color: var(--color-warning);
}
.state-pill.closed {
    background-color: var(--ev-c-gray-3);
    color: var(--ev-c-text-3);
}
.state-pill.error {
    background-color: var(--color-danger-soft);
    color: var(--color-danger);
}

.follow-toggle {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--font-size-secondary);
    color: var(--ev-c-text-2);
    cursor: pointer;
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

.error-banner {
    padding: var(--space-3) var(--space-4);
    background-color: var(--color-danger-soft);
    border: 1px solid var(--color-danger);
    border-radius: var(--radius-lg);
    color: var(--color-danger);
    font-size: var(--font-size-button);
    flex-shrink: 0;
}

.log-scroll {
    flex: 1;
    min-height: 0;
    width: 100%;
    padding: var(--space-4);
    background-color: var(--color-background-soft);
    border: 1px solid var(--ev-c-gray-2);
    border-radius: var(--radius-xl);
    font-family: var(--font-mono);
    font-size: var(--font-size-meta);
    line-height: 1.55;
    color: var(--ev-c-text-1);
    overflow-y: auto;
    overflow-x: auto;
}

.log-line {
    white-space: pre;
}
/* ANSI SGR styles for log output live in main.css (need theme overrides via :root). */


.empty {
    color: var(--ev-c-text-3);
    text-align: center;
    padding: var(--space-9) 0;
}
</style>
