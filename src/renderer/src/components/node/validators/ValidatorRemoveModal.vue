<template>
    <div class="modal-overlay" @click.self="maybeClose">
        <div class="modal" role="dialog" aria-modal="true" aria-labelledby="remove-title">
            <header class="modal-header">
                <div class="head-text">
                    <h3 id="remove-title" class="modal-title">{{ title }}</h3>
                    <p class="head-sub">
                        from <span class="chip mono">{{ clientName }}</span>
                        <template v-if="network"> on <span class="chip mono">{{ network }}</span></template>
                    </p>
                </div>
                <button v-if="stage !== 'removing'" class="icon-btn" aria-label="Close" @click="maybeClose">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                        <path d="M6 6l12 12M18 6L6 18" />
                    </svg>
                </button>
            </header>

            <div class="modal-body">
                <!-- 1. Confirm: say what happens, no checkbox - the button is the decision. -->
                <template v-if="stage === 'confirm'">
                    <div v-if="error" class="callout danger" role="alert">
                        <div class="callout-head">Removal failed</div>
                        <p>{{ error }}</p>
                    </div>

                    <p class="lede">
                        <strong>{{ pubkeys.length }} {{ pubkeys.length === 1 ? 'key' : 'keys' }}</strong> will be removed from
                        <span class="mono">{{ clientName }}</span>, which stops signing for {{ pubkeys.length === 1 ? 'it' : 'them' }}
                        immediately.
                    </p>

                    <ul class="facts">
                        <li>
                            <span class="fact-icon warn">!</span>
                            <span class="fact-text">
                                <span class="fact-title">This is not an exit</span>
                                <span class="fact-sub">
                                    The {{ pubkeys.length === 1 ? 'validator stays' : 'validators stay' }} active on chain. If nothing else
                                    signs for {{ pubkeys.length === 1 ? 'it' : 'them' }}, duties are missed and balance drops until
                                    {{ pubkeys.length === 1 ? 'it is' : 'they are' }} exited or run elsewhere.
                                </span>
                            </span>
                        </li>
                        <li>
                            <span class="fact-icon">
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /></svg>
                            </span>
                            <span class="fact-text">
                                <span class="fact-title">You get the slashing protection file</span>
                                <span class="fact-sub">
                                    The client hands back what these keys have signed (an EIP-3076 file). Save it and attach it when
                                    importing the keys anywhere else; it is what keeps that client from signing the same slot again.
                                </span>
                            </span>
                        </li>
                    </ul>

                    <details class="keys">
                        <summary>Show the {{ pubkeys.length }} {{ pubkeys.length === 1 ? 'key' : 'keys' }}</summary>
                        <ul class="key-list">
                            <li v-for="pk in pubkeys" :key="pk" class="mono">{{ pk }}</li>
                        </ul>
                    </details>
                </template>

                <!-- 2. Running -->
                <div v-else-if="stage === 'removing'" class="running">
                    <span class="spinner large"></span>
                    <p class="running-title">Removing {{ pubkeys.length }} {{ pubkeys.length === 1 ? 'key' : 'keys' }}</p>
                    <p class="running-sub">Stopping them in {{ clientName }} and collecting their signing history.</p>
                </div>

                <!-- 3. Removed: save the protection file. -->
                <template v-else>
                    <div class="tiles">
                        <div class="tile" :class="{ good: removedCount > 0 }">
                            <span class="tile-n mono">{{ removedCount }}</span><span class="tile-label">removed</span>
                        </div>
                        <div class="tile" :class="{ warn: notFound.length > 0 }">
                            <span class="tile-n mono">{{ notFound.length }}</span><span class="tile-label">not held by the client</span>
                        </div>
                        <div class="tile" :class="{ bad: failed.length > 0 }">
                            <span class="tile-n mono">{{ failed.length }}</span><span class="tile-label">could not be stopped</span>
                        </div>
                    </div>

                    <div v-if="failed.length" class="callout danger">
                        <div class="callout-head">{{ failed.length }} {{ failed.length === 1 ? 'key may' : 'keys may' }} still be signing</div>
                        <p>The client could not stop {{ failed.length === 1 ? 'it' : 'them' }}. Do not import {{ failed.length === 1 ? 'it' : 'them' }} anywhere else until that is resolved.</p>
                        <ul class="callout-list mono">
                            <li v-for="r in failed" :key="r.pubkey">{{ shortKey(r.pubkey) }} {{ r.message }}</li>
                        </ul>
                    </div>

                    <section v-if="protection" class="file-card" :class="{ saved: Boolean(savedPath) }">
                        <span class="file-icon">
                            <svg v-if="savedPath" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5L19 7" /></svg>
                            <svg v-else width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /></svg>
                        </span>
                        <span class="file-text">
                            <span class="file-title">Slashing protection file</span>
                            <span v-if="savedPath" class="file-sub mono">{{ savedPath }}</span>
                            <span v-else class="file-sub">
                                Covers {{ coveredCount }} {{ coveredCount === 1 ? 'key' : 'keys' }}<template v-if="!complete">, not every removed key</template>.
                                Keep it with the keystores.
                            </span>
                        </span>
                        <button v-if="!savedPath" class="btn-accent" :disabled="saving" @click="save">{{ saving ? 'Saving…' : 'Save file' }}</button>
                        <button v-else class="link-btn" @click="save">Save another copy</button>
                    </section>
                    <p v-else class="callout warning">The client returned no slashing protection data, so there is nothing to save.</p>

                    <p v-if="saveError" class="check-note warn">{{ saveError }}</p>
                    <p v-if="protection && !savedPath" class="check-note">
                        Closing without saving is recoverable: the client keeps this history, and removing the same keys again
                        returns the same file.
                    </p>
                </template>
            </div>

            <footer class="modal-footer">
                <button v-if="stage === 'confirm'" class="btn-ghost" @click="emit('close')">Cancel</button>
                <button v-if="stage === 'confirm'" class="btn-danger" @click="remove">
                    Remove {{ pubkeys.length }} {{ pubkeys.length === 1 ? 'key' : 'keys' }}
                </button>
                <button v-if="stage === 'done'" :class="savedPath || !protection ? 'btn-accent' : 'btn-ghost'" @click="emit('close')">
                    {{ savedPath || !protection ? 'Done' : 'Close without saving' }}
                </button>
            </footer>
        </div>
    </div>
</template>

<script setup>
import { computed, ref } from 'vue'

defineProps({
    pubkeys: { type: Array, default: () => [] },
    clientName: { type: String, default: '' },
    network: { type: String, default: '' },
})
const emit = defineEmits(['close', 'remove', 'save'])

const stage = ref('confirm')     // confirm -> removing -> done
const error = ref('')
const saveError = ref('')
const saving = ref(false)
const savedPath = ref('')
const results = ref([])
const protection = ref('')
const complete = ref(true)

const title = computed(() => (stage.value === 'done' ? 'Keys removed' : 'Remove validator keys'))
const removedCount = computed(() => results.value.filter((r) => r.status === 'deleted' || r.status === 'not_active').length)
// A key the client could not stop may still be signing - the dangerous outcome; a key it never had
// contributes no history to the file.
const failed = computed(() => results.value.filter((r) => r.status === 'error'))
const notFound = computed(() => results.value.filter((r) => r.status === 'not_found'))
const coveredCount = computed(() => {
    try { return (JSON.parse(protection.value)?.data || []).length } catch { return 0 }
})

function shortKey(pubkey) {
    return pubkey && pubkey.length > 20 ? `${pubkey.slice(0, 10)}…${pubkey.slice(-8)}` : pubkey
}

// Closing while the client is mid-removal would hide an operation that keeps running.
function maybeClose() {
    if (stage.value !== 'removing') emit('close')
}

async function remove() {
    stage.value = 'removing'
    error.value = ''
    const res = await new Promise((resolve) => emit('remove', { done: resolve }))
    if (!res?.ok) {
        stage.value = 'confirm'
        error.value = res?.error || 'The removal failed'
        return
    }
    results.value = res.results || []
    protection.value = res.slashingProtection || ''
    complete.value = res.complete !== false
    stage.value = 'done'
    // Open the save dialog straight away: the file is the reason this step exists.
    if (protection.value) save()
}

async function save() {
    saveError.value = ''
    saving.value = true
    const res = await new Promise((resolve) => emit('save', { content: protection.value, done: resolve }))
    saving.value = false
    if (res?.ok) savedPath.value = res.path
    else if (!res?.canceled) saveError.value = res?.error || 'Could not save the file'
}
</script>

<style scoped>
.modal-overlay {
    position: fixed;
    inset: 0;
    z-index: 320;
    background-color: var(--scrim);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-6);
}
.modal {
    width: 600px;
    max-width: 100%;
    max-height: 88vh;
    display: flex;
    flex-direction: column;
    background-color: var(--color-background-soft);
    border: 1px solid var(--ev-c-gray-3);
    border-radius: var(--radius-xl);
    box-shadow: var(--shadow-menu);
    overflow: hidden;
}
.mono { font-family: var(--font-mono); }

.modal-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-4);
    padding: var(--space-5) var(--space-6) var(--space-4);
    border-bottom: 1px solid var(--ev-c-gray-3);
}
.head-text { display: flex; flex-direction: column; gap: var(--space-1); min-width: 0; }
.modal-title { font-size: var(--font-size-title); font-weight: var(--font-weight-semibold); color: var(--ev-c-text-1); }
.head-sub { font-size: var(--font-size-secondary); color: var(--ev-c-text-3); }
.chip {
    padding: var(--chip-padding);
    border-radius: var(--radius-sm);
    background-color: var(--color-background-mute);
    color: var(--ev-c-text-2);
    font-size: var(--font-size-meta);
}
.icon-btn {
    flex-shrink: 0;
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: none;
    border-radius: var(--radius-md);
    color: var(--ev-c-text-2);
    cursor: pointer;
    transition: background-color var(--transition-fast);
}
.icon-btn:hover { background-color: var(--ev-c-gray-3); }

.modal-body {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-5) var(--space-6);
}
.lede { font-size: var(--font-size-body); color: var(--ev-c-text-2); line-height: 1.6; }
.lede strong { color: var(--ev-c-text-1); font-weight: var(--font-weight-semibold); }

.facts {
    display: flex;
    flex-direction: column;
    margin: 0;
    padding: 0;
    list-style: none;
    border: 1px solid var(--ev-c-gray-3);
    border-radius: var(--radius-lg);
}
.facts li { display: flex; gap: var(--space-3); padding: var(--space-4); }
.facts li + li { border-top: 1px solid var(--ev-c-gray-3); }
.fact-icon {
    width: 24px;
    height: 24px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    background-color: var(--color-accent-soft);
    color: var(--color-accent);
    font-size: var(--font-size-secondary);
    font-weight: var(--font-weight-bold);
}
.fact-icon.warn { background-color: var(--color-warning-soft); color: var(--color-warning); }
.fact-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.fact-title { font-size: var(--font-size-secondary); font-weight: var(--font-weight-semibold); color: var(--ev-c-text-1); }
.fact-sub { font-size: var(--font-size-secondary); color: var(--ev-c-text-2); line-height: 1.6; }

.keys summary {
    cursor: pointer;
    font-size: var(--font-size-secondary);
    color: var(--ev-c-text-2);
}
.keys summary:hover { color: var(--ev-c-text-1); }
.key-list {
    margin: var(--space-2) 0 0;
    padding: var(--space-3) var(--space-4);
    list-style: none;
    max-height: 180px;
    overflow-y: auto;
    background-color: var(--color-background-mute);
    border-radius: var(--radius-md);
    font-size: var(--font-size-meta);
    color: var(--ev-c-text-2);
    word-break: break-all;
}
.key-list li + li { margin-top: var(--space-1); }

.callout {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-4);
    border-radius: var(--radius-md);
    font-size: var(--font-size-secondary);
    line-height: 1.6;
    margin: 0;
}
.callout p { margin: 0; }
.callout.warning { background-color: var(--color-warning-soft); color: var(--ev-c-text-2); }
.callout.danger { background-color: var(--color-danger-soft); color: var(--ev-c-text-1); }
.callout-head { font-weight: var(--font-weight-medium); }
.callout.danger .callout-head { color: var(--color-danger); }
.callout-list { margin: 0; padding-left: var(--space-5); font-size: var(--font-size-meta); }

.running {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-8) 0;
    text-align: center;
}
.running-title { font-size: var(--font-size-body); color: var(--ev-c-text-1); font-weight: var(--font-weight-medium); }
.running-sub { font-size: var(--font-size-secondary); color: var(--ev-c-text-3); }
.spinner {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    border: 2px solid var(--ev-c-gray-2);
    border-top-color: var(--color-accent);
    animation: spin 0.8s linear infinite;
}
.spinner.large { width: 28px; height: 28px; border-width: 3px; }
@keyframes spin { to { transform: rotate(360deg); } }

.tiles { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--space-3); }
.tile {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-4);
    background-color: var(--color-background-mute);
    border-radius: var(--radius-lg);
}
.tile-n { font-size: var(--font-size-page-title); color: var(--ev-c-text-2); }
.tile-label { font-size: var(--font-size-meta); color: var(--ev-c-text-3); }
.tile.good .tile-n { color: var(--color-success); }
.tile.warn .tile-n { color: var(--color-warning); }
.tile.bad .tile-n { color: var(--color-danger); }

.file-card {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    padding: var(--space-4);
    border: 1px solid var(--color-accent-border);
    border-radius: var(--radius-lg);
    background-color: var(--color-accent-wash);
}
.file-card.saved { border-color: var(--ev-c-gray-3); background-color: transparent; }
.file-icon {
    width: 32px;
    height: 32px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-md);
    background-color: var(--color-accent-soft);
    color: var(--color-accent);
}
.file-card.saved .file-icon { background-color: var(--color-success-soft); color: var(--color-success); }
.file-text { flex: 1 1 auto; display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.file-title { font-size: var(--font-size-secondary); font-weight: var(--font-weight-semibold); color: var(--ev-c-text-1); }
.file-sub { font-size: var(--font-size-meta); color: var(--ev-c-text-3); word-break: break-all; }
.check-note { font-size: var(--font-size-meta); color: var(--ev-c-text-3); line-height: 1.6; }
.check-note.warn { color: var(--color-warning); }

.modal-footer {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-3);
    padding: var(--space-4) var(--space-6);
    border-top: 1px solid var(--ev-c-gray-3);
}
.btn-ghost, .btn-accent, .btn-danger {
    padding: var(--button-padding);
    border-radius: var(--radius-lg);
    font-size: var(--font-size-button);
    cursor: pointer;
    flex-shrink: 0;
    transition: background-color var(--transition-fast), opacity var(--transition-fast);
}
.btn-ghost { background-color: transparent; border: 1px solid var(--ev-c-gray-2); color: var(--ev-c-text-1); }
.btn-ghost:hover:not(:disabled) { background-color: var(--ev-c-gray-3); }
.btn-accent { background-color: var(--color-accent); border: none; color: var(--color-accent-text); font-weight: var(--font-weight-semibold); }
.btn-accent:hover:not(:disabled) { background-color: var(--color-accent-hover); }
.btn-accent:disabled { opacity: 0.5; cursor: default; }
.btn-danger { background-color: transparent; border: 1px solid var(--color-danger-border); color: var(--color-danger); font-weight: var(--font-weight-medium); }
.btn-danger:hover { background-color: var(--color-danger-soft); }
.link-btn {
    flex-shrink: 0;
    padding: 0;
    background: none;
    border: none;
    color: var(--ev-c-text-2);
    font-size: var(--font-size-meta);
    cursor: pointer;
    text-decoration: underline;
    text-underline-offset: 2px;
}
.link-btn:hover { color: var(--ev-c-text-1); }
</style>
