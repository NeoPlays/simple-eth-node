<template>
    <!-- dragover/drop prevented on the whole overlay: a file dropped beside a drop zone must do nothing. -->
    <div class="modal-overlay" @click.self="maybeClose" @dragover.prevent @drop.prevent>
        <div class="modal" role="dialog" aria-modal="true" aria-labelledby="import-title">
            <header class="modal-header">
                <div class="head-text">
                    <h3 id="import-title" class="modal-title">{{ title }}</h3>
                    <p class="head-sub">
                        into <span class="chip mono">{{ clientName }}</span>
                        <template v-if="network"> on <span class="chip mono">{{ network }}</span></template>
                    </p>
                </div>
                <button v-if="stage !== 'importing'" class="icon-btn" aria-label="Close" @click="maybeClose">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                        <path d="M6 6l12 12M18 6L6 18" />
                    </svg>
                </button>
            </header>

            <!-- Stepper: where you are, what is done. Hidden once the import runs. -->
            <ol v-if="stepIndex >= 0" class="stepper">
                <li v-for="(s, i) in STEPS" :key="s.key" :class="{ active: i === stepIndex, done: i < stepIndex }">
                    <span class="step-dot">
                        <svg v-if="i < stepIndex" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5L19 7" /></svg>
                        <template v-else>{{ i + 1 }}</template>
                    </span>
                    <span class="step-label">{{ s.label }}</span>
                </li>
            </ol>

            <div class="modal-body">
                <!-- 1. Keystores -->
                <template v-if="stage === 'files'">
                    <div
                        class="dropzone"
                        :class="{ over: dragDepth > 0, compact: files.length > 0 }"
                        @dragenter.prevent="dragDepth++"
                        @dragover.prevent
                        @dragleave.prevent="dragDepth = Math.max(0, dragDepth - 1)"
                        @drop.prevent="onDropKeystores"
                    >
                        <svg class="dz-icon" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M12 15V4M7 9l5-5 5 5" />
                            <path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
                        </svg>
                        <div class="dz-text">
                            <span class="dz-title">
                                {{ dragDepth > 0 ? 'Drop to add' : files.length ? 'Drop more keystores here' : 'Drop keystore files or a folder' }}
                            </span>
                            <span class="dz-sub">keystore-*.json, e.g. the validator_keys folder from the deposit CLI</span>
                        </div>
                        <button class="btn-ghost dz-btn" :disabled="picking || reading" @click="pickKeystores">
                            {{ reading ? 'Reading…' : 'Choose files' }}
                        </button>
                    </div>

                    <div v-if="skipped.length" class="callout warning">
                        <div class="callout-head">
                            <span>{{ skipped.length }} {{ skipped.length === 1 ? 'file was' : 'files were' }} skipped</span>
                            <button class="link-btn" @click="skipped = []">Dismiss</button>
                        </div>
                        <ul class="callout-list">
                            <li v-for="(m, i) in skipped" :key="i">{{ m }}</li>
                        </ul>
                    </div>

                    <section v-if="files.length" class="panel">
                        <header class="panel-head">
                            <span class="panel-title">{{ files.length }} {{ files.length === 1 ? 'keystore' : 'keystores' }}</span>
                            <span v-if="onchainBadge" class="panel-meta" :class="onchainBadge.kind">{{ onchainBadge.text }}</span>
                            <button class="link-btn" @click="files = []">Clear all</button>
                        </header>
                        <ul class="key-list">
                            <li v-for="f in files" :key="f.pubkey" :class="{ flagged: verdictOf(f.pubkey) === 'active' }">
                                <span class="key-main">
                                    <span class="mono">{{ shortKey(f.pubkey) }}</span>
                                    <span class="key-file">{{ f.name }}</span>
                                </span>
                                <span v-if="verdictOf(f.pubkey) === 'active'" class="tag danger" :title="activeTitle(f.pubkey)">signing on chain</span>
                                <button class="link-btn" @click="removeFile(f.pubkey)">Remove</button>
                            </li>
                        </ul>
                    </section>
                </template>

                <!-- 2. Password -->
                <template v-else-if="stage === 'password'">
                    <div class="field">
                        <label class="field-label" for="validator-import-password">Keystore password</label>
                        <div class="input-wrap">
                            <input
                                id="validator-import-password"
                                ref="passwordEl"
                                v-model="password"
                                class="value-input"
                                :type="showPassword ? 'text' : 'password'"
                                autocomplete="off"
                                spellcheck="false"
                                @keydown.enter="next"
                            />
                            <button class="input-action" type="button" @click="showPassword = !showPassword">
                                {{ showPassword ? 'Hide' : 'Show' }}
                            </button>
                        </div>
                        <!-- The keymanager API takes a passwords array positional to the keystores, so one
                             value is sent for every slot: it only works if it unlocks all of them. -->
                        <p class="field-hint">
                            Used for all {{ files.length }} {{ files.length === 1 ? 'keystore' : 'keystores' }}. If they were
                            created with different passwords, import them in separate batches.
                        </p>
                    </div>
                </template>

                <!-- 3. Safety checks: the gate the whole flow exists for. -->
                <template v-else-if="stage === 'protection'">
                    <div v-if="importError" class="callout danger" role="alert">
                        <div class="callout-head"><span>Import failed</span></div>
                        <p>{{ importError }}</p>
                    </div>

                    <p class="lede">
                        <strong>Never run a key in two places at once.</strong> Both checks below exist to stop exactly
                        that; slashing protection alone cannot, since two clients signing at the same time never see
                        each other's history.
                    </p>

                    <!-- A. On-chain activity -->
                    <section class="check" :class="onchainState">
                        <header class="check-head">
                            <span class="check-icon">
                                <span v-if="onchainState === 'running'" class="spinner"></span>
                                <svg v-else-if="onchainState === 'pass'" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5L19 7" /></svg>
                                <svg v-else-if="onchainState === 'fail'" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
                                <span v-else class="bang">!</span>
                            </span>
                            <div class="check-text">
                                <span class="check-title">On-chain activity</span>
                                <span class="check-sub">{{ onchainSubtitle }}</span>
                            </div>
                            <button v-if="onchainState !== 'running'" class="link-btn" @click="runOnchainCheck">Check again</button>
                        </header>

                        <div v-if="onchain?.ok" class="tally">
                            <span v-for="t in tallies" :key="t.key" class="tally-item" :class="t.kind">
                                <span class="tally-n mono">{{ t.n }}</span> {{ t.label }}
                            </span>
                        </div>

                        <template v-if="activeKeys.length">
                            <p class="check-note">
                                {{ activeKeys.length === 1 ? 'This key is' : 'These keys are' }} signing right now, so another client
                                runs {{ activeKeys.length === 1 ? 'it' : 'them' }}. Stop that client and wait a few epochs before
                                importing {{ activeKeys.length === 1 ? 'it' : 'them' }} here.
                            </p>
                            <ul class="key-list compact">
                                <li v-for="k in activeKeys" :key="k.pubkey" class="flagged">
                                    <span class="mono">{{ shortKey(k.pubkey) }}</span>
                                    <span class="key-file">validator {{ k.index }}, signed in epoch {{ k.signedIn.join(', ') }}</span>
                                </li>
                            </ul>
                            <button class="btn-ghost small" @click="removeActive">
                                Remove {{ activeKeys.length === 1 ? 'it' : `these ${activeKeys.length}` }} from the import
                            </button>
                        </template>

                        <p v-if="activityUnverified" class="check-note warn">
                            {{ onchain?.ok ? `${onchain.counts.unknown} ${onchain.counts.unknown === 1 ? 'key' : 'keys'} could not be checked for every epoch.` : onchain?.error }}
                            Make sure no other client runs these keys before importing.
                        </p>
                    </section>

                    <!-- B. Signing history -->
                    <section class="check" :class="historyState">
                        <header class="check-head">
                            <span class="check-icon">
                                <span v-if="validating" class="spinner"></span>
                                <svg v-else-if="historyState === 'pass'" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5L19 7" /></svg>
                                <svg v-else-if="historyState === 'fail'" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
                                <span v-else class="bang">!</span>
                            </span>
                            <div class="check-text">
                                <span class="check-title">Signing history</span>
                                <span class="check-sub">Optional: the slashing protection file from the keys' previous client</span>
                            </div>
                        </header>

                        <div
                            class="dropzone compact"
                            :class="{ over: protectionDrag > 0, filled: Boolean(protectionFile) }"
                            @dragenter.prevent="protectionDrag++"
                            @dragover.prevent
                            @dragleave.prevent="protectionDrag = Math.max(0, protectionDrag - 1)"
                            @drop.prevent="onDropProtection"
                        >
                            <div class="dz-text">
                                <span v-if="protectionFile" class="dz-title mono">{{ protectionFile.name }}</span>
                                <span v-else class="dz-title">Drop the slashing protection file here</span>
                            </div>
                            <button v-if="protectionFile" class="link-btn" :disabled="validating" @click="clearProtection">Remove</button>
                            <button class="btn-ghost dz-btn" :disabled="picking || validating" @click="pickProtection">
                                {{ protectionFile ? 'Replace' : 'Choose file' }}
                            </button>
                        </div>

                        <p v-if="!protectionFile" class="check-note warn">
                            No file attached, so the client starts with no signing history for these keys. That is fine
                            for keys that have never signed; for keys that have, attach the file exported from their
                            previous client.
                        </p>
                        <p v-else-if="validating" class="check-note">Checking the file against this chain and the selected keys…</p>
                        <template v-else-if="validation">
                            <p v-if="validationClean" class="check-note ok">Covers all {{ files.length }} {{ files.length === 1 ? 'key' : 'keys' }}, and belongs to this chain.</p>
                            <ul v-if="validation.errors.length || validation.warnings.length" class="problem-list">
                                <li v-for="(e, i) in validation.errors" :key="`e${i}`" class="bad">{{ e }}</li>
                                <li v-for="(w, i) in validation.warnings" :key="`w${i}`" class="warn">{{ w }}</li>
                            </ul>
                            <p v-if="validation.errors.length" class="check-note bad">This file does not fit these keys. Replace it, or remove it to import without history.</p>
                            <p v-if="validation.missing.length" class="check-note warn">
                                {{ validation.missing.length }} of the selected {{ files.length === 1 ? 'key is' : 'keys are' }} not in
                                this file and import without history.
                            </p>
                        </template>
                    </section>

                    <p v-if="fileError" class="check-note bad">{{ fileError }}</p>
                </template>

                <!-- 4. Running -->
                <div v-else-if="stage === 'importing'" class="running">
                    <span class="spinner large"></span>
                    <p class="running-title">Importing {{ files.length }} {{ files.length === 1 ? 'key' : 'keys' }} into {{ clientName }}</p>
                    <p class="running-sub">
                        The client decrypts every keystore before it answers, about a second per key.
                        <span class="mono">{{ elapsedText }}</span>
                    </p>
                </div>

                <!-- 5. Outcome. Each key is reported independently, so a partial result is normal. -->
                <template v-else>
                    <div class="tiles">
                        <div class="tile" :class="{ good: importedCount > 0 }">
                            <span class="tile-n mono">{{ importedCount }}</span><span class="tile-label">imported</span>
                        </div>
                        <div class="tile" :class="{ warn: duplicateCount > 0 }">
                            <span class="tile-n mono">{{ duplicateCount }}</span><span class="tile-label">already present</span>
                        </div>
                        <div class="tile" :class="{ bad: failedResults.length > 0 }">
                            <span class="tile-n mono">{{ failedResults.length }}</span><span class="tile-label">failed</span>
                        </div>
                    </div>

                    <div v-if="importWarnings.length" class="callout warning">
                        <p v-for="(w, i) in importWarnings" :key="i">{{ w }}</p>
                    </div>

                    <ul v-if="nonImported.length" class="problem-list">
                        <li v-for="r in nonImported" :key="r.pubkey" :class="r.status === 'duplicate' ? 'warn' : 'bad'">
                            <span class="mono">{{ shortKey(r.pubkey) }}</span> {{ r.message }}
                        </li>
                    </ul>

                    <p class="lede muted">
                        The keys are loaded in <span class="mono">{{ clientName }}</span>; that is all an import does. Deposits,
                        activation and exits are on-chain state it does not touch.
                        <template v-if="duplicateCount"> A duplicate means the client already held that key: nothing changed.</template>
                    </p>
                </template>
            </div>

            <footer class="modal-footer">
                <span class="foot-hint">{{ footHint }}</span>
                <div class="foot-actions">
                    <button v-if="stage !== 'importing' && stage !== 'done'" class="btn-ghost" @click="back">
                        {{ stage === 'files' ? 'Cancel' : 'Back' }}
                    </button>
                    <button v-if="stage !== 'importing' && stage !== 'done'" class="btn-accent" :disabled="!canContinue" @click="next">
                        {{ stage === 'protection' ? `Import ${files.length} ${files.length === 1 ? 'key' : 'keys'}` : 'Continue' }}
                    </button>
                    <button v-if="stage === 'done'" class="btn-accent" @click="emit('close')">Done</button>
                </div>
            </footer>
        </div>
    </div>
</template>

<script setup>
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import { readDroppedJson } from '@renderer/utils/droppedFiles'

defineProps({
    clientName: { type: String, default: '' },
    network: { type: String, default: '' },
})
const emit = defineEmits(['close', 'pick-keystores', 'pick-protection', 'validate', 'check-onchain', 'apply'])

const STEPS = [
    { key: 'files', label: 'Keystores' },
    { key: 'password', label: 'Password' },
    { key: 'protection', label: 'Safety checks' },
]

const stage = ref('files')          // files -> password -> protection -> importing -> done
const files = ref([])               // { name, content, pubkey }
const skipped = ref([])             // why dropped/picked files were not added
const fileError = ref('')
const picking = ref(false)
const password = ref('')
const showPassword = ref(false)
const passwordEl = ref(null)
const protectionFile = ref(null)    // { name, content }, optional
const validation = ref(null)        // { errors, warnings, missing }
const validating = ref(false)
const outcomes = ref([])
const importWarnings = ref([])      // what the import could not vouch for, from the main process
const importError = ref('')

const stepIndex = computed(() => STEPS.findIndex((s) => s.key === stage.value))
const title = computed(() => (stage.value === 'done' ? 'Import finished' : 'Import validator keys'))
const footHint = computed(() => (stepIndex.value >= 0 ? `Step ${stepIndex.value + 1} of ${STEPS.length}` : ''))

// ── on-chain activity ─────────────────────────────────────────────────────
// Runs in the background as soon as keys are picked (results flag rows in step 1), and again on
// demand. A key that signed in the current epoch or the 3 before is running somewhere else.
const onchain = ref(null)           // check-keys-onchain result
const onchainRunning = ref(false)
let onchainSeq = 0
let onchainTimer = null

async function runOnchainCheck() {
    clearTimeout(onchainTimer)
    const pubkeys = files.value.map((f) => f.pubkey)
    if (!pubkeys.length) { onchain.value = null; return }
    const seq = ++onchainSeq
    onchainRunning.value = true
    const res = await new Promise((resolve) => emit('check-onchain', { pubkeys, done: resolve }))
    if (seq !== onchainSeq) return   // the selection changed meanwhile; a newer check is coming
    onchain.value = res || { ok: false, error: 'The check did not answer' }
    onchainRunning.value = false
}

const verdictOf = (pubkey) => onchain.value?.results?.[pubkey]?.verdict ?? null
const activeKeys = computed(() => (onchain.value?.ok
    ? Object.entries(onchain.value.results)
        .filter(([, r]) => r.verdict === 'active')
        .map(([pubkey, r]) => ({ pubkey, ...r }))
    : []))
function activeTitle(pubkey) {
    const r = onchain.value?.results?.[pubkey]
    return r ? `Validator ${r.index} signed in epoch ${r.signedIn.join(', ')}` : ''
}
// Could not check (beacon down, epochs missing): a warning, not a blocker - the operator decides.
const activityUnverified = computed(() => !onchainRunning.value && Boolean(onchain.value)
    && (!onchain.value.ok || onchain.value.counts.unknown > 0))
const onchainState = computed(() => {
    if (onchainRunning.value || !onchain.value) return 'running'
    if (activeKeys.value.length) return 'fail'
    return activityUnverified.value ? 'warn' : 'pass'
})
const onchainSubtitle = computed(() => {
    if (onchainRunning.value || !onchain.value) return 'Asking the beacon node whether any key signed recently…'
    if (!onchain.value.ok) return 'Could not be checked'
    const e = onchain.value.currentEpoch
    return `Epoch ${e} and the 3 before it (${e - 3} to ${e})`
})
const tallies = computed(() => {
    const c = onchain.value?.counts || {}
    return [
        { key: 'active', n: c.active || 0, label: 'signing', kind: 'bad' },
        { key: 'inactive', n: c.inactive || 0, label: 'idle', kind: 'good' },
        { key: 'pending', n: c.pending || 0, label: 'pending activation', kind: '' },
        { key: 'not-on-chain', n: c['not-on-chain'] || 0, label: 'not on chain', kind: '' },
        { key: 'unknown', n: c.unknown || 0, label: 'unchecked', kind: 'warn' },
    ].filter((t) => t.n > 0)
})
const onchainBadge = computed(() => {
    if (onchainRunning.value) return { kind: '', text: 'checking on-chain activity…' }
    if (!onchain.value) return null
    if (!onchain.value.ok) return { kind: 'warn', text: 'on-chain check unavailable' }
    if (activeKeys.value.length) return { kind: 'bad', text: `${activeKeys.value.length} signing on chain` }
    return { kind: 'good', text: 'none signing on chain' }
})
// Only a key seen signing blocks; the check must have finished so that is known.
const onchainOk = computed(() => !onchainRunning.value && Boolean(onchain.value) && !activeKeys.value.length)
function removeActive() {
    const drop = new Set(activeKeys.value.map((k) => k.pubkey))
    files.value = files.value.filter((f) => !drop.has(f.pubkey))
}

// ── signing history ───────────────────────────────────────────────────────
const validationClean = computed(() => Boolean(validation.value)
    && !validation.value.errors.length
    && !validation.value.warnings.length
    && !validation.value.missing.length)
// A validated file is only a pass when nothing blocking came back. Warnings and uncovered keys are
// informational; errors mean the file cannot be trusted for these keys.
// No file is allowed (with a warning). An attached file must fit: one with errors (wrong chain,
// malformed) blocks until it is replaced or removed, because importing it would teach the client
// a history that is not these keys'.
const protectionBroken = computed(() => Boolean(protectionFile.value) && Boolean(validation.value?.errors.length))
const historyOk = computed(() => !validating.value && !protectionBroken.value && (!protectionFile.value || Boolean(validation.value)))
const historyState = computed(() => {
    if (validating.value) return 'running'
    if (protectionBroken.value) return 'fail'
    return protectionFile.value && validation.value ? 'pass' : 'warn'
})
function clearProtection() {
    protectionFile.value = null
    validation.value = null
    fileError.value = ''
}

const canContinue = computed(() => {
    if (stage.value === 'files') return files.value.length > 0
    if (stage.value === 'password') return password.value.length > 0
    if (stage.value === 'protection') return historyOk.value && onchainOk.value
    return false
})

const importedCount = computed(() => outcomes.value.filter((r) => r.status === 'imported').length)
const duplicateCount = computed(() => outcomes.value.filter((r) => r.status === 'duplicate').length)
const failedResults = computed(() => outcomes.value.filter((r) => r.status === 'error'))
const nonImported = computed(() => outcomes.value.filter((r) => r.status !== 'imported'))

function shortKey(pubkey) {
    return pubkey && pubkey.length > 20 ? `${pubkey.slice(0, 10)}…${pubkey.slice(-8)}` : pubkey
}

// EIP-2335 keystores store `pubkey` bare, the keymanager API and every protection file use the
// 0x form. Normalising here keeps the validate call and the on-screen key comparable to both.
function normalizePubkey(raw) {
    const hex = String(raw).trim().toLowerCase()
    return hex.startsWith('0x') ? hex : `0x${hex}`
}

function readKeystore(file) {
    let json
    try { json = JSON.parse(file.content) } catch { throw new Error(`${file.name} is not a valid JSON file`) }
    // The deposit CLI writes deposit_data-*.json next to the keystores, so a dropped folder has one.
    if (Array.isArray(json)) throw new Error(`${file.name} is deposit data, not a keystore`)
    if (!json || typeof json.pubkey !== 'string' || !json.pubkey.trim()) {
        throw new Error(`${file.name} has no pubkey - it is not a validator keystore`)
    }
    return { name: file.name, content: file.content, pubkey: normalizePubkey(json.pubkey) }
}

async function pickKeystores() {
    picking.value = true
    const res = await new Promise((resolve) => emit('pick-keystores', { done: resolve }))
    picking.value = false
    if (!res?.ok) {
        if (!res?.canceled) skipped.value = [res?.error || 'Could not read the selected files']
        return
    }
    addKeystoreFiles(res.files || [])
}

// Drag-and-drop: the same { name, content } list the file dialog returns, so both paths share the
// validation below. A drag that crosses child elements fires enter/leave in pairs, hence a depth
// counter instead of a boolean.
const dragDepth = ref(0)
const protectionDrag = ref(0)
const reading = ref(false)
async function onDropKeystores(e) {
    dragDepth.value = 0
    reading.value = true
    try {
        const { files: dropped, ignored } = await readDroppedJson(e.dataTransfer)
        if (!dropped.length) {
            skipped.value = [ignored ? 'Nothing dropped was a .json file' : 'Nothing to import was dropped']
            return
        }
        addKeystoreFiles(dropped)
    } catch (err) {
        skipped.value = [err?.message || 'Could not read the dropped files']
    } finally {
        reading.value = false
    }
}
async function onDropProtection(e) {
    protectionDrag.value = 0
    if (validating.value) return
    fileError.value = ''
    const { files: dropped } = await readDroppedJson(e.dataTransfer)
    if (dropped.length !== 1) {
        fileError.value = dropped.length ? 'Drop a single slashing protection file' : 'Drop a .json slashing protection file'
        return
    }
    protectionFile.value = dropped[0]
    await validateProtection()
}

function addKeystoreFiles(list) {
    const errors = []
    for (const file of list) {
        let parsed
        try { parsed = readKeystore(file) } catch (err) { errors.push(err.message); continue }
        // The same key twice would consume two positional password slots and come back as a
        // duplicate from the client - drop it here so the list matches what is actually sent.
        if (files.value.some((f) => f.pubkey === parsed.pubkey)) {
            errors.push(`${file.name} holds a key that is already selected`)
            continue
        }
        files.value.push(parsed)
    }
    skipped.value = errors
}

function removeFile(pubkey) {
    files.value = files.value.filter((f) => f.pubkey !== pubkey)
}

async function pickProtection() {
    fileError.value = ''
    const res = await new Promise((resolve) => emit('pick-protection', { done: resolve }))
    if (!res?.ok) {
        if (!res?.canceled) fileError.value = res?.error || 'Could not read the file'
        return
    }
    protectionFile.value = res.file
    await validateProtection()
}

async function validateProtection() {
    validating.value = true
    validation.value = null
    const res = await new Promise((resolve) => emit('validate', {
        protection: protectionFile.value?.content,
        pubkeys: files.value.map((f) => f.pubkey),
        done: resolve,
    }))
    validating.value = false
    if (!res?.ok) {
        // A file that could not be checked is not a file that passed - keep it out of the gate.
        protectionFile.value = null
        fileError.value = res?.error || 'The slashing protection file could not be read'
        return
    }
    validation.value = {
        errors: res.errors || [],
        warnings: res.warnings || [],
        missing: res.missing || [],
    }
}

// Any status the client invents (Prysm's SDK returns "unknown") is treated as a failure, never as
// a silent success - the user must see that key as not imported.
function normalizeStatus(status) {
    return status === 'imported' || status === 'duplicate' || status === 'error' ? status : 'error'
}

function messageFor(status, message) {
    if (message) return message
    if (status === 'duplicate') return 'Already held by this client'
    return 'Not imported'
}

function next() {
    if (!canContinue.value) return
    if (stage.value === 'files') { stage.value = 'password'; return }
    if (stage.value === 'password') { stage.value = 'protection'; return }
    runImport()
}

function back() {
    if (stage.value === 'files') { emit('close'); return }
    fileError.value = ''
    stage.value = stage.value === 'protection' ? 'password' : 'files'
}

// Elapsed time while the client decrypts - a long silent wait otherwise looks like a hang.
const startedAt = ref(0)
const now = ref(0)
let tick = null
const elapsedText = computed(() => {
    const s = Math.max(0, Math.floor((now.value - startedAt.value) / 1000))
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
})
onUnmounted(() => { clearInterval(tick); clearTimeout(onchainTimer) })

async function runImport() {
    stage.value = 'importing'
    importError.value = ''
    startedAt.value = now.value = Date.now()
    tick = setInterval(() => { now.value = Date.now() }, 1000)
    const res = await new Promise((resolve) => emit('apply', {
        keystores: files.value.map((f) => f.content),
        // Positional to `keystores`: the same password is repeated for every slot.
        passwords: files.value.map(() => password.value),
        slashingProtection: protectionFile.value?.content || null,
        done: resolve,
    }))
    clearInterval(tick)
    if (!res?.ok) {
        stage.value = 'protection'
        importError.value = res?.error || 'The import failed'
        // The main process ran its own on-chain check; show what it found.
        if (res?.onchain) onchain.value = res.onchain
        return
    }
    importWarnings.value = res.warnings || []
    outcomes.value = (res.results || []).map((r) => {
        const status = normalizeStatus(r.status)
        return { pubkey: r.pubkey, status, message: messageFor(status, r.message) }
    })
    stage.value = 'done'
}

// Closing mid-import would hide an operation that keeps running on the client.
function maybeClose() {
    if (stage.value !== 'importing') emit('close')
}

// A changed selection invalidates both checks: re-run them (the on-chain one debounced, since a
// folder drop adds many files at once).
watch(files, () => {
    clearTimeout(onchainTimer)
    onchainTimer = setTimeout(runOnchainCheck, 400)
    if (protectionFile.value) validateProtection()
}, { deep: true })

watch(stage, (value) => {
    if (value === 'password') nextTick(() => passwordEl.value?.focus())
})
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
    width: 640px;
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

/* ── header + stepper ── */
.modal-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-4);
    padding: var(--space-5) var(--space-6) var(--space-4);
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

.stepper {
    display: flex;
    gap: var(--space-2);
    margin: 0;
    padding: 0 var(--space-6) var(--space-4);
    list-style: none;
    border-bottom: 1px solid var(--ev-c-gray-3);
}
.stepper li {
    flex: 1 1 0;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding-top: var(--space-2);
    border-top: 2px solid var(--ev-c-gray-3);
    font-size: var(--font-size-secondary);
    color: var(--ev-c-text-3);
    transition: border-color var(--transition-fast), color var(--transition-fast);
}
.stepper li.active { border-top-color: var(--color-accent); color: var(--ev-c-text-1); }
.stepper li.done { border-top-color: var(--color-accent-border); color: var(--ev-c-text-2); }
.step-dot {
    width: 20px;
    height: 20px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    font-size: var(--font-size-micro);
    font-weight: var(--font-weight-semibold);
    background-color: var(--ev-c-gray-3);
    color: var(--ev-c-text-2);
}
.stepper li.active .step-dot { background-color: var(--color-accent); color: var(--color-accent-text); }
.stepper li.done .step-dot { background-color: var(--color-accent-soft); color: var(--color-accent); }

/* ── body ── */
.modal-body {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-5) var(--space-6);
}
.lede { font-size: var(--font-size-secondary); color: var(--ev-c-text-2); line-height: 1.6; }
.lede strong { color: var(--ev-c-text-1); font-weight: var(--font-weight-semibold); }
.lede.muted { color: var(--ev-c-text-3); }

/* drop zones */
.dropzone {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    padding: var(--space-7) var(--space-6);
    border: 1px dashed var(--ev-c-gray-1);
    border-radius: var(--radius-lg);
    background-color: var(--color-background-mute);
    transition: border-color var(--transition-fast), background-color var(--transition-fast), padding var(--transition-fast);
}
.dropzone.compact { padding: var(--space-3) var(--space-4); }
.dropzone.over { border-color: var(--color-accent); background-color: var(--color-accent-wash); }
.dropzone.filled { border-style: solid; border-color: var(--ev-c-gray-2); }
.dz-icon { flex-shrink: 0; color: var(--ev-c-text-3); }
.dropzone.over .dz-icon { color: var(--color-accent); }
.dz-text { flex: 1 1 auto; display: flex; flex-direction: column; gap: var(--space-1); min-width: 0; }
.dz-title { font-size: var(--font-size-body); color: var(--ev-c-text-1); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dz-sub { font-size: var(--font-size-meta); color: var(--ev-c-text-3); }
.dropzone.compact .dz-sub, .dropzone.compact .dz-icon { display: none; }
.dz-btn { flex-shrink: 0; }

/* callouts */
.callout {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-4);
    border-radius: var(--radius-md);
    font-size: var(--font-size-secondary);
    line-height: 1.6;
}
.callout.warning { background-color: var(--color-warning-soft); color: var(--ev-c-text-2); }
.callout.danger { background-color: var(--color-danger-soft); color: var(--ev-c-text-1); }
.callout-head { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); font-weight: var(--font-weight-medium); }
.callout.warning .callout-head { color: var(--color-warning); }
.callout.danger .callout-head { color: var(--color-danger); }
.callout-list { margin: 0; padding-left: var(--space-5); font-size: var(--font-size-meta); }
.callout p { margin: 0; }

/* panel with the selected keys */
.panel { border: 1px solid var(--ev-c-gray-3); border-radius: var(--radius-lg); overflow: hidden; }
.panel-head {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    background-color: var(--color-background-mute);
    border-bottom: 1px solid var(--ev-c-gray-3);
}
.panel-title { font-size: var(--font-size-secondary); font-weight: var(--font-weight-semibold); color: var(--ev-c-text-1); }
.panel-meta { flex: 1 1 auto; font-size: var(--font-size-meta); color: var(--ev-c-text-3); }
.panel-meta.good { color: var(--color-success); }
.panel-meta.bad { color: var(--color-danger); }
.panel-meta.warn { color: var(--color-warning); }

.key-list { margin: 0; padding: 0; list-style: none; max-height: 260px; overflow-y: auto; }
.key-list li {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-4);
    font-size: var(--font-size-meta);
    color: var(--ev-c-text-1);
    border-bottom: 1px solid var(--ev-c-gray-3);
}
.key-list li:last-child { border-bottom: none; }
.key-list li.flagged { background-color: var(--color-danger-soft); }
.key-list.compact { border: 1px solid var(--ev-c-gray-3); border-radius: var(--radius-md); max-height: 160px; }
.key-main { flex: 1 1 auto; display: flex; align-items: baseline; gap: var(--space-3); min-width: 0; }
.key-file { color: var(--ev-c-text-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tag { padding: var(--chip-padding); border-radius: var(--radius-sm); font-size: var(--font-size-micro); white-space: nowrap; }
.tag.danger { color: var(--color-danger); background-color: var(--color-danger-soft); border: 1px solid var(--color-danger-border); }

/* password */
.field { display: flex; flex-direction: column; gap: var(--space-2); }
.field-label { font-size: var(--font-size-secondary); color: var(--ev-c-text-2); }
.input-wrap {
    display: flex;
    align-items: center;
    border: 1px solid var(--ev-c-gray-2);
    border-radius: var(--radius-md);
    background-color: var(--color-background-mute);
    transition: border-color var(--transition-fast);
}
.input-wrap:focus-within { border-color: var(--color-accent); }
.value-input {
    flex: 1 1 auto;
    min-width: 0;
    padding: var(--space-3) var(--space-4);
    background: transparent;
    border: none;
    color: var(--ev-c-text-1);
    font-family: var(--font-mono);
    font-size: var(--font-size-body);
}
.value-input:focus { outline: none; }
.input-action {
    padding: 0 var(--space-4);
    align-self: stretch;
    background: transparent;
    border: none;
    border-left: 1px solid var(--ev-c-gray-3);
    color: var(--ev-c-text-2);
    font-size: var(--font-size-secondary);
    cursor: pointer;
}
.input-action:hover { color: var(--ev-c-text-1); }
.field-hint { font-size: var(--font-size-meta); color: var(--ev-c-text-3); line-height: 1.6; }

/* safety checks */
.check {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-4);
    border: 1px solid var(--ev-c-gray-3);
    border-radius: var(--radius-lg);
    transition: border-color var(--transition-fast);
}
.check.fail { border-color: var(--color-danger-border); }
.check-head { display: flex; align-items: center; gap: var(--space-3); }
.check-icon {
    width: 24px;
    height: 24px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    background-color: var(--ev-c-gray-3);
    color: var(--ev-c-text-2);
}
.check.pass .check-icon { background-color: var(--color-success-soft); color: var(--color-success); }
.check.fail .check-icon { background-color: var(--color-danger-soft); color: var(--color-danger); }
.check.warn .check-icon { background-color: var(--color-warning-soft); color: var(--color-warning); }
.bang { font-size: var(--font-size-secondary); font-weight: var(--font-weight-bold); }
.check-text { flex: 1 1 auto; display: flex; flex-direction: column; min-width: 0; }
.check-title { font-size: var(--font-size-body); font-weight: var(--font-weight-semibold); color: var(--ev-c-text-1); }
.check-sub { font-size: var(--font-size-meta); color: var(--ev-c-text-3); }
.check-note { font-size: var(--font-size-secondary); color: var(--ev-c-text-2); line-height: 1.6; }
.check-note.ok { color: var(--color-success); }
.check-note.warn { color: var(--color-warning); }
.check-note.bad { color: var(--color-danger); }

.tally { display: flex; flex-wrap: wrap; gap: var(--space-2); }
.tally-item {
    padding: var(--chip-padding);
    border-radius: var(--radius-sm);
    background-color: var(--color-background-mute);
    font-size: var(--font-size-meta);
    color: var(--ev-c-text-2);
}
.tally-n { color: var(--ev-c-text-1); font-weight: var(--font-weight-semibold); }
.tally-item.good .tally-n { color: var(--color-success); }
.tally-item.bad { background-color: var(--color-danger-soft); }
.tally-item.bad .tally-n { color: var(--color-danger); }
.tally-item.warn .tally-n { color: var(--color-warning); }

.problem-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    margin: 0;
    padding: var(--space-3) var(--space-4);
    list-style: none;
    background-color: var(--color-background-mute);
    border-radius: var(--radius-md);
    font-size: var(--font-size-meta);
    max-height: 180px;
    overflow-y: auto;
}
.problem-list .bad { color: var(--color-danger); }
.problem-list .warn { color: var(--color-warning); }

/* running */
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
.running-sub .mono { color: var(--ev-c-text-2); margin-left: var(--space-2); }

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

/* outcome */
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

/* footer + buttons */
.modal-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    padding: var(--space-4) var(--space-6);
    border-top: 1px solid var(--ev-c-gray-3);
}
.foot-hint { font-size: var(--font-size-meta); color: var(--ev-c-text-3); }
.foot-actions { display: flex; gap: var(--space-3); }
.btn-ghost, .btn-accent {
    padding: var(--button-padding);
    border-radius: var(--radius-lg);
    font-size: var(--font-size-button);
    cursor: pointer;
    transition: background-color var(--transition-fast), opacity var(--transition-fast);
}
.btn-ghost { background-color: transparent; border: 1px solid var(--ev-c-gray-2); color: var(--ev-c-text-1); }
.btn-ghost:hover:not(:disabled) { background-color: var(--ev-c-gray-3); }
.btn-ghost:disabled { opacity: 0.5; cursor: default; }
.btn-ghost.small { align-self: flex-start; padding: var(--button-padding-small); font-size: var(--font-size-secondary); border-radius: var(--radius-md); }
.btn-accent { background-color: var(--color-accent); border: none; color: var(--color-accent-text); font-weight: var(--font-weight-semibold); }
.btn-accent:hover:not(:disabled) { background-color: var(--color-accent-hover); }
.btn-accent:disabled { opacity: 0.5; cursor: default; }
.link-btn {
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
