<template>
    <section class="section">
        <div class="section-head">
            <h2 class="section-title">Update policy</h2>
            <span v-if="serverClock" class="server-clock" :title="'Cron on this node runs in its own local time'">
                Server time <span class="mono">{{ serverClock }}</span>, {{ tzLabel }}
            </span>
        </div>

        <div v-if="error" class="policy-card fill">
            <div class="card-head">
                <div class="card-text">
                    <div class="card-title">Could not read the update settings</div>
                    <p class="card-sub error">{{ error }}</p>
                </div>
                <button class="btn-edit" @click="emit('reload')">Retry</button>
            </div>
        </div>

        <div v-else-if="!state" class="policy-card loading fill">
            <span class="loading-dot"></span>
            <span class="card-sub">Reading update settings from the node…</span>
        </div>

        <div v-else-if="state.yamlError" class="policy-card fill">
            <div class="card-text">
                <div class="card-title">Settings file unavailable</div>
                <p class="card-sub error">{{ state.yamlError }}</p>
                <p class="card-sub">Nothing here is editable until the node has a readable settings file.</p>
            </div>
        </div>

        <template v-else>
            <!-- Automatic updates -->
            <div class="policy-card" :class="{ on: saved.install, attention: driftKind }">
                <div class="card-head">
                    <div class="card-text">
                        <div class="card-title">
                            Automatic updates
                            <span class="status-pill" :class="statusPill.kind">{{ statusPill.label }}</span>
                        </div>
                        <p class="card-sub">
                            <template v-if="saved.install && nextSavedRun">
                                {{ savedSummary }}. Next run
                                <strong class="next-run">{{ serverDate(nextSavedRun.at) }}</strong>&nbsp;<span class="rel">({{ relativeFromNow(nextSavedRun.at, now) }})</span>
                            </template>
                            <template v-else-if="saved.install">{{ savedSummary }}</template>
                            <template v-else>Off. The node only updates when you start an update here.</template>
                        </p>
                        <p v-if="unpinned && !driftKind" class="card-note">
                            Set up by an older Stereum version, which picked this time at random. It is only in the
                            cron entry, not the settings file, so re-applying the settings would pick a new random time.
                            Open the schedule and save to keep it.
                        </p>
                    </div>
                    <button class="btn-edit" :disabled="!!busy" @click="openSchedule">
                        {{ saved.install ? 'Edit schedule' : 'Set up' }}
                    </button>
                </div>

                <div v-if="driftKind" class="callout warning">
                    <div class="callout-text">
                        <strong>Not applied on the node.</strong>
                        {{ driftText }}
                    </div>
                    <!-- With no time in the file, re-running the role would roll a random one; choose it instead. -->
                    <button v-if="unpinned" class="btn-edit" :disabled="!!busy" @click="openSchedule">Set schedule</button>
                    <button v-else class="btn-edit" :disabled="!!busy" @click="applySchedule">
                        {{ busy === 'apply' ? 'Applying…' : 'Apply settings' }}
                    </button>
                </div>

            </div>

            <!-- Release channel -->
            <div class="policy-card fill">
                <div class="card-text">
                    <div class="card-title">Release channel</div>
                    <p class="card-sub">Where this node takes new node controls and service versions from, for manual and automatic updates alike.</p>
                </div>
                <div class="lanes" role="radiogroup" aria-label="Release channel">
                    <button
                        v-for="l in LANE_OPTIONS"
                        :key="l.id"
                        class="lane"
                        role="radio"
                        :aria-checked="savedLane === l.id"
                        :class="{ active: savedLane === l.id, pending: pendingLane === l.id }"
                        :disabled="!!busy"
                        @click="requestLane(l.id)"
                    >
                        <span class="radio"></span>
                        <span class="lane-text">
                            <span class="lane-name">
                                {{ l.label }}
                                <span v-if="l.id === 'stable'" class="lane-tag">Recommended</span>
                                <span v-if="pendingLane === l.id" class="lane-tag busy">Switching…</span>
                            </span>
                            <span class="lane-desc">{{ l.desc }}</span>
                        </span>
                    </button>
                </div>
                <p v-if="unknownLane" class="note warn">
                    The settings file names an unknown channel (<span class="mono">{{ state.updates.laneRaw }}</span>). Stereum treats it as Stable.
                </p>
            </div>

        </template>

        <div v-if="laneConfirm" class="modal-overlay" @click.self="laneConfirm = null">
            <div class="modal" role="dialog" aria-modal="true" aria-labelledby="lane-modal-title">
                <header class="modal-header">
                    <h3 id="lane-modal-title" class="modal-title">Switch to the {{ laneLabel(laneConfirm) }} channel?</h3>
                </header>
                <div class="modal-body">
                    <template v-if="laneConfirm === 'dev'">
                        <p>The next update, manual or automatic, installs pre-release node controls and service versions from <span class="mono">updates.dev.json</span>.</p>
                        <ul class="modal-points">
                            <li>Dev builds are not release-tested and can break a running setup.</li>
                            <li>With automatic updates on, they arrive on the schedule without you starting anything.</li>
                        </ul>
                        <label class="ack">
                            <input v-model="laneAck" type="checkbox" />
                            <span>I understand this node may receive untested versions.</span>
                        </label>
                    </template>
                    <template v-else>
                        <p>The next update moves the node back to the latest stable release.</p>
                        <ul class="modal-points">
                            <li>That release can be older than the dev build the node runs now, so the update may step versions back.</li>
                        </ul>
                    </template>
                </div>
                <footer class="modal-footer">
                    <button class="btn-ghost" @click="laneConfirm = null">Cancel</button>
                    <button
                        :class="laneConfirm === 'dev' ? 'btn-warning' : 'btn-accent'"
                        :disabled="laneConfirm === 'dev' && !laneAck"
                        @click="confirmLane"
                    >Switch to {{ laneLabel(laneConfirm) }}</button>
                </footer>
            </div>
        </div>

        <div v-if="scheduleOpen" class="modal-overlay" @click.self="closeSchedule">
            <div class="modal modal-wide" role="dialog" aria-modal="true" aria-labelledby="schedule-modal-title">
                <header class="modal-header">
                    <h3 id="schedule-modal-title" class="modal-title">Automatic updates</h3>
                    <button class="icon-btn" aria-label="Close" :disabled="!!busy" @click="closeSchedule">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                            <path d="M6 6l12 12M18 6L6 18" />
                        </svg>
                    </button>
                </header>
                <div class="modal-body scroll">
                    <div class="switch-row">
                        <div class="card-text">
                            <span class="switch-label">Run updates automatically</span>
                            <span class="card-sub">Off means the node only updates when you start an update here.</span>
                        </div>
                        <button
                            class="switch"
                            role="switch"
                            :aria-checked="draft.install"
                            aria-label="Run updates automatically"
                            :disabled="!!busy"
                            @click="toggleInstall"
                        >
                            <span class="knob"></span>
                        </button>
                    </div>
                        <div v-if="draft.install" class="schedule-form">
                            <div class="field">
                                <div class="field-label">Frequency</div>
                                <div class="seg" role="radiogroup" aria-label="Frequency">
                                    <button
                                        v-for="p in PRESETS"
                                        :key="p.days"
                                        role="radio"
                                        :aria-checked="!customInterval && draft.interval === p.days"
                                        :class="{ active: !customInterval && draft.interval === p.days }"
                                        :disabled="!!busy"
                                        @click="chooseInterval(p.days)"
                                    >{{ p.label }}</button>
                                    <button
                                        role="radio"
                                        :aria-checked="customInterval"
                                        :class="{ active: customInterval }"
                                        :disabled="!!busy"
                                        @click="customInterval = true"
                                    >Custom</button>
                                </div>
                                <div v-if="customInterval" class="stepper-row">
                                    <span class="stepper-label">Every</span>
                                    <div class="stepper">
                                        <button aria-label="Fewer days" :disabled="!!busy || draft.interval <= LIMITS.min" @click="stepInterval(-1)">-</button>
                                        <input
                                            v-model.number="draft.interval"
                                            type="number"
                                            :min="LIMITS.min"
                                            :max="LIMITS.max"
                                            class="mono"
                                            :disabled="!!busy"
                                            aria-label="Interval in days"
                                        />
                                        <button aria-label="More days" :disabled="!!busy || draft.interval >= LIMITS.max" @click="stepInterval(1)">+</button>
                                    </div>
                                    <span class="stepper-label">{{ draft.interval === 1 ? 'day' : 'days' }}</span>
                                    <span v-if="!intervalValid" class="field-error">Pick 1 to 28 days</span>
                                </div>
                            </div>

                            <div class="field">
                                <div class="field-label">
                                    Time
                                    <span class="field-hint">server time, {{ tzLabel }}</span>
                                </div>
                                <div class="time-row">
                                    <input v-model="timeStr" type="time" class="time-input mono" :disabled="!!busy" aria-label="Time of day" />
                                    <span v-if="localEquivalent" class="local-eq">{{ localEquivalent }} on this computer</span>
                                    <button class="btn-ghost small" :disabled="!!busy" title="Spreads nodes across the quiet hours so they don't all update the same minute" @click="randomize">
                                        Pick a quiet time
                                    </button>
                                </div>
                            </div>

                            <div class="field">
                                <div class="field-label">Upcoming runs</div>
                                <ol v-if="draftRuns.length" class="runs">
                                    <li v-for="(r, i) in draftRuns" :key="r.at" class="run" :class="{ first: i === 0, short: isShortGap(r) }">
                                        <span class="run-dot"></span>
                                        <span class="run-date">{{ serverDate(r.at) }}</span>
                                        <span class="run-rel">{{ relativeFromNow(r.at, now) }}</span>
                                        <span v-if="isShortGap(r)" class="run-gap">
                                            {{ r.gapDays }} {{ r.gapDays === 1 ? 'day' : 'days' }} after the previous run
                                        </span>
                                    </li>
                                </ol>
                                <p v-else class="field-hint">Set a valid frequency and time to see the schedule.</p>
                                <p v-if="monthEnd" class="note">
                                    Cron counts days of the month, not days since the last run: this schedule fires on the
                                    {{ monthDaysText }}, then starts over on the 1st. Around the end of a month two runs can
                                    be as little as {{ monthEnd.shortestGap }} {{ monthEnd.shortestGap === 1 ? 'day' : 'days' }} apart.
                                </p>
                            </div>

                            <details class="what-runs" :open="whatRunsOpen">
                                <summary>What an automatic run does</summary>
                                <ol class="steps">
                                    <li>
                                        <span class="step-title">Upgrades all OS packages</span>
                                        <span class="step-desc">apt dist-upgrade, the same as Update OS under Host.</span>
                                    </li>
                                    <li class="risk">
                                        <span class="step-title">Reboots the server if the upgrade requires it</span>
                                        <span class="step-desc">Every service is down until the server is back. The rest of the update resumes after boot.</span>
                                    </li>
                                    <li>
                                        <span class="step-title">Updates node controls</span>
                                        <span class="step-desc">From the {{ laneLabel(savedLane) }} release channel.</span>
                                    </li>
                                    <li>
                                        <span class="step-title">Updates every service and restarts the ones that changed</span>
                                        <span class="step-desc">Validators miss duties while their client restarts.</span>
                                    </li>
                                </ol>
                            </details>
                        </div>
                    <div v-if="scheduleError" class="msg error">{{ scheduleError }}</div>
                </div>
                <footer class="modal-footer split">
                    <span class="change-summary">
                        <template v-if="busy === 'schedule'">Writing settings and updating the cron entry…</template>
                        <template v-else-if="dirty"><span class="change-dot"></span>{{ changeSummary }}</template>
                        <template v-else>No changes</template>
                    </span>
                    <div class="foot-actions">
                        <button class="btn-ghost" :disabled="!!busy" @click="closeSchedule">Cancel</button>
                        <button class="btn-accent" :disabled="!!busy || !dirty || !draftValid" @click="saveSchedule">
                            {{ busy === 'schedule' ? 'Saving…' : 'Save' }}
                        </button>
                    </div>
                </footer>
            </div>
        </div>
    </section>
</template>

<script setup>
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { useTasksStore } from '@stores/useTasks'
import { useLocale } from '@renderer/composables/useLocale'
import { formatDateTime } from '@renderer/utils/datetime'
import {
    nextRuns, monthEndEffect, cronDays, ordinal, formatOffset, hhmm, relativeFromNow,
    intervalLabel, randomQuietTime, serverOffsetAt,
} from '@renderer/utils/updateSchedule'

const props = defineProps({
    nodeId: { type: String, required: true },
    // get-update-settings result; null while loading
    state: { type: Object, default: null },
    error: { type: String, default: null },
})
const emit = defineEmits(['reload', 'flash'])

const tasks = useTasksStore()
const { locales } = useLocale()

const LIMITS = { min: 1, max: 28 }
const PRESETS = [
    { days: 1, label: 'Daily' },
    { days: 3, label: 'Every 3 days' },
    { days: 7, label: 'Weekly' },
    { days: 14, label: 'Every 14 days' },
]
const LANE_OPTIONS = [
    { id: 'stable', label: 'Stable', desc: 'Release-tested versions. The right choice for any node running real validators.' },
    { id: 'dev', label: 'Dev', desc: 'Pre-release builds, published before they reach Stable. For test nodes that should see new versions early.' },
]
const laneLabel = (id) => LANE_OPTIONS.find((l) => l.id === id)?.label ?? id

// ── clock ──────────────────────────────────────────────────────────────────
// The server's "now", advanced locally between reads so "in 3h" and the next run stay current.
const loadedAt = ref(Date.now())
const tick = ref(Date.now())
let timer = null
onMounted(() => { timer = setInterval(() => { tick.value = Date.now() }, 30_000) })
onUnmounted(() => clearInterval(timer))
watch(() => props.state, () => { loadedAt.value = Date.now(); tick.value = Date.now() })

const server = computed(() => {
    const s = props.state?.server
    if (!Number.isFinite(s?.now)) return null
    return { ...s, now: s.now + Math.floor((tick.value - loadedAt.value) / 1000) }
})
const now = computed(() => server.value?.now ?? Math.floor(tick.value / 1000))
const offsetNow = computed(() => (server.value ? serverOffsetAt(now.value * 1000, server.value) : null))
// Zone names that only ever mean UTC - "Etc/UTC (UTC)" says the same thing twice.
const UTC_ZONES = new Set(['UTC', 'Etc/UTC', 'Etc/Universal', 'Universal', 'Etc/Zulu', 'Zulu', 'GMT', 'Etc/GMT'])
const tzLabel = computed(() => {
    if (!server.value) return 'timezone unknown'
    const off = formatOffset(offsetNow.value)
    const tz = server.value.timeZone
    if (!tz || (UTC_ZONES.has(tz) && offsetNow.value === 0)) return off
    return `${tz} (${off})`
})

/** A server-local timestamp: the zone when known, else the fixed offset rendered as UTC. */
function serverDate(at, opts = { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) {
    const base = { dateStyle: undefined, timeStyle: undefined, ...opts }
    if (server.value?.timeZone) return formatDateTime(at, locales.value, { ...base, timeZone: server.value.timeZone })
    return formatDateTime(at + (offsetNow.value ?? 0) * 60, locales.value, { ...base, timeZone: 'UTC' })
}
const serverClock = computed(() => (server.value ? serverDate(now.value, { hour: '2-digit', minute: '2-digit' }) : ''))

// ── saved state vs draft ───────────────────────────────────────────────────
// The cron is what really runs, so it fills any field the file leaves empty (the role would have
// picked a random hour/minute for it).
function savedOf(state) {
    const un = state?.updates?.unattended || {}
    const cron = state?.cron || {}
    return {
        install: !!un.install,
        interval: un.interval_days ?? cron.interval_days ?? null,
        hour: un.hour ?? cron.hour ?? null,
        min: un.min ?? cron.min ?? null,
    }
}
const saved = computed(() => savedOf(props.state))
const savedLane = computed(() => props.state?.updates?.lane || 'stable')
const unknownLane = computed(() => {
    const raw = props.state?.updates?.laneRaw
    return raw != null && !LANE_OPTIONS.some((l) => l.id === raw)
})

const draft = reactive({ install: false, interval: 1, hour: 3, min: 0 })
const customInterval = ref(false)
const whatRunsOpen = ref(false)

function resetDraft() {
    const s = saved.value
    const quiet = randomQuietTime()
    draft.install = s.install
    draft.interval = s.interval ?? 1
    draft.hour = s.hour ?? quiet.hour
    draft.min = s.min ?? quiet.min
    customInterval.value = !PRESETS.some((p) => p.days === draft.interval)
    whatRunsOpen.value = false
}

const timeStr = computed({
    get: () => hhmm(draft.hour, draft.min),
    set: (v) => {
        const m = String(v || '').match(/^(\d{1,2}):(\d{2})/)
        if (!m) return
        draft.hour = Number(m[1])
        draft.min = Number(m[2])
    },
})

const intervalValid = computed(() => Number.isInteger(draft.interval) && draft.interval >= LIMITS.min && draft.interval <= LIMITS.max)
const timeValid = computed(() => Number.isInteger(draft.hour) && Number.isInteger(draft.min))
const draftValid = computed(() => !draft.install || (intervalValid.value && timeValid.value))

function differsFrom(s) {
    if (draft.install !== s.install) return true
    if (!draft.install) return false
    return draft.interval !== s.interval || draft.hour !== s.hour || draft.min !== s.min
}
// A legacy schedule (see `unpinned`) is worth saving unchanged: it writes the cron's time into the file.
const unpinned = computed(() => !!props.state?.updates?.unpinned)
const dirty = computed(() => differsFrom(saved.value) || (draft.install && unpinned.value))

// A reload (after a lane switch, say) must not wipe edits the user hasn't saved yet.
// Compared against the state being replaced: the draft was clean if it matched that one.
watch(() => props.state, (next, prev) => { if (!prev || !differsFrom(savedOf(prev))) resetDraft() }, { immediate: true })

const changeSummary = computed(() => {
    const s = saved.value
    if (!draft.install) return 'Turn off automatic updates'
    const sched = `${intervalLabel(draft.interval).toLowerCase()} at ${hhmm(draft.hour, draft.min)}`
    if (!s.install) return `Turn on, ${sched}`
    const parts = []
    if (!differsFrom(s)) return `Keep ${sched}, saved to the settings file`
    if (draft.interval !== s.interval) parts.push(`${intervalLabel(s.interval).toLowerCase()} → ${intervalLabel(draft.interval).toLowerCase()}`)
    if (draft.hour !== s.hour || draft.min !== s.min) parts.push(`${hhmm(s.hour, s.min)} → ${hhmm(draft.hour, draft.min)}`)
    return `Unsaved: ${parts.join(', ')}`
})

function toggleInstall() {
    draft.install = !draft.install
    // Turning it on is the moment to read what a run does - it can reboot the server.
    if (draft.install && !saved.value.install) whatRunsOpen.value = true
}
function chooseInterval(days) { draft.interval = days; customInterval.value = false }
function stepInterval(delta) {
    const n = Number.isInteger(draft.interval) ? draft.interval : 1
    draft.interval = Math.min(LIMITS.max, Math.max(LIMITS.min, n + delta))
}
function randomize() { Object.assign(draft, randomQuietTime()) }

// The editor lives in a dialog: the card stays a compact summary, and every open starts from the
// saved state, so a cancelled edit never lingers.
const scheduleOpen = ref(false)
const scheduleError = ref('')
function openSchedule() {
    resetDraft()
    scheduleError.value = ''
    // "Set up" on a node that is off means the user came to turn it on.
    if (!saved.value.install) toggleInstall()
    scheduleOpen.value = true
}
function closeSchedule() {
    if (busy.value === 'schedule') return
    scheduleOpen.value = false
    resetDraft()
}

// ── schedule preview ───────────────────────────────────────────────────────
const draftRuns = computed(() => {
    if (!draftValid.value || !server.value) return []
    return nextRuns({ interval_days: draft.interval, hour: draft.hour, min: draft.min }, server.value, 5)
})
const nextSavedRun = computed(() => {
    const s = saved.value
    if (!s.install || !server.value) return null
    return nextRuns({ interval_days: s.interval, hour: s.hour, min: s.min }, server.value, 1)[0] ?? null
})
const savedSummary = computed(() => {
    const s = saved.value
    if (!Number.isInteger(s.interval) || !Number.isInteger(s.hour)) return 'On, no schedule on the node yet'
    return `${intervalLabel(s.interval)} at ${hhmm(s.hour, s.min)} server time`
})
const monthEnd = computed(() => (intervalValid.value ? monthEndEffect(draft.interval) : null))
const monthDaysText = computed(() => {
    const days = cronDays(draft.interval).map(ordinal)
    return days.length > 1 ? `${days.slice(0, -1).join(', ')} and ${days.at(-1)}` : days[0]
})
const isShortGap = (r) => r.gapDays != null && r.gapDays < draft.interval

// Only worth showing when this computer's clock reads differently from the server's.
const localEquivalent = computed(() => {
    const first = draftRuns.value[0]
    if (!first || offsetNow.value == null) return ''
    const localOffset = -new Date(first.at * 1000).getTimezoneOffset()
    if (localOffset === serverOffsetAt(first.at * 1000, server.value)) return ''
    return formatDateTime(first.at, locales.value, { dateStyle: undefined, timeStyle: 'short' })
})

// ── cron drift ─────────────────────────────────────────────────────────────
const driftKind = computed(() => {
    const d = props.state?.drift
    return d && d !== 'ok' ? d : null
})
const cronSchedule = computed(() => {
    const c = props.state?.cron
    if (!c?.present) return ''
    return `${intervalLabel(c.interval_days).toLowerCase()} at ${hhmm(c.hour, c.min)}`
})
const driftText = computed(() => ({
    missing: 'The settings say automatic updates are on, but the node has no cron entry for them, so nothing will run.',
    stale: `The settings say off, but the cron entry is still there and runs ${cronSchedule.value}.`,
    mismatch: `The cron entry runs ${cronSchedule.value}, not the schedule saved in the settings. The cron is what actually runs.`,
}[driftKind.value] || ''))

const statusPill = computed(() => {
    if (driftKind.value) return { kind: 'warning', label: 'Not applied' }
    return saved.value.install ? { kind: 'on', label: 'On' } : { kind: 'off', label: 'Off' }
})

// ── actions ────────────────────────────────────────────────────────────────
const busy = ref(null)        // 'schedule' | 'lane' | 'apply'
const pendingLane = ref(null)
// Outcome messages go to the tab's shared status slot, so a banner never changes this column's height.
const flash = (kind, text) => emit('flash', kind, text)

// onError lets the schedule dialog keep its failure next to the form instead of behind the overlay.
async function runTask(kind, action, args, successText, { onError } = {}) {
    busy.value = kind
    const fail = onError || ((text) => flash('error', text))
    try {
        const taskId = await tasks.runNodeTask(props.nodeId, action, args)
        const task = await tasks.awaitTask(taskId)
        if (task?.status === 'failed') fail(`${task.error || 'The change failed'}. Details are in Tasks.`)
        else flash('success', successText)
        return task
    } catch (e) {
        fail(e?.message || String(e))
        return { status: 'failed' }
    } finally {
        busy.value = null
        emit('reload')
    }
}

async function saveSchedule() {
    if (!draftValid.value) return
    const unattended = draft.install
        ? { install: true, interval_days: draft.interval, hour: draft.hour, min: draft.min }
        : { install: false }
    const text = draft.install ? `Automatic updates on, ${intervalLabel(draft.interval).toLowerCase()} at ${hhmm(draft.hour, draft.min)}.` : 'Automatic updates turned off.'
    scheduleError.value = ''
    const task = await runTask('schedule', 'set-update-settings', [{ unattended }], text, {
        onError: (msg) => { scheduleError.value = msg },
    })
    if (task?.status !== 'failed') scheduleOpen.value = false
}

function applySchedule() {
    return runTask('apply', 'apply-update-schedule', [], 'Cron entry updated from the settings file.')
}

const laneConfirm = ref(null)
const laneAck = ref(false)
function requestLane(id) {
    if (id === savedLane.value || busy.value) return
    laneAck.value = false
    laneConfirm.value = id
}
async function confirmLane() {
    const lane = laneConfirm.value
    laneConfirm.value = null
    pendingLane.value = lane
    try {
        await runTask('lane', 'set-update-settings', [{ lane }], `Release channel set to ${laneLabel(lane)}. It applies from the next update.`)
    } finally {
        pendingLane.value = null
    }
}

function onKey(e) {
    if (e.key !== 'Escape') return
    if (laneConfirm.value) laneConfirm.value = null
    else if (scheduleOpen.value) closeSchedule()
}
onMounted(() => window.addEventListener('keydown', onKey))
onUnmounted(() => window.removeEventListener('keydown', onKey))
</script>

<style scoped>
/* Root is a grid item next to the Host column: stretch to its height and let the last card fill it. */
.section {
    display: flex;
    flex-direction: column;
}
.policy-card.fill {
    flex: 1 1 auto;
    margin-bottom: 0;
}
.section-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-4);
    margin-bottom: 10px;
}
.section-title {
    font-size: var(--font-size-button);
    font-weight: var(--font-weight-semibold);
    color: var(--ev-c-text-2);
    text-transform: uppercase;
    letter-spacing: 0.05em;
}
.server-clock {
    font-size: var(--font-size-meta);
    color: var(--ev-c-text-3);
}
.server-clock .mono { color: var(--ev-c-text-2); }
.mono { font-family: var(--font-mono); }

/* ── cards ── */
.policy-card {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--card-padding);
    background-color: var(--color-background-soft);
    border: 1px solid transparent;
    border-radius: var(--radius-xl);
    margin-bottom: var(--space-3);
    transition: border-color var(--transition-fast);
}
.policy-card.on { border-color: var(--color-accent-border); }
.policy-card.attention { border-color: var(--color-warning); }
.policy-card.loading {
    flex-direction: row;
    align-items: center;
    gap: var(--space-3);
}
.loading-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background-color: var(--color-accent);
    animation: pulse 1.2s ease-in-out infinite;
}
@keyframes pulse { 0%, 100% { opacity: 0.25; } 50% { opacity: 1; } }

.card-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-5);
}
.card-text {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-width: 0;
}
.card-title {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    font-size: var(--font-size-title);
    font-weight: var(--font-weight-semibold);
    color: var(--ev-c-text-1);
}
.card-sub {
    font-size: var(--font-size-secondary);
    color: var(--ev-c-text-2);
    line-height: 1.5;
}
.card-sub.error { color: var(--color-danger); }
.card-note {
    margin-top: var(--space-1);
    font-size: var(--font-size-meta);
    color: var(--ev-c-text-3);
    line-height: 1.5;
}
.next-run { color: var(--ev-c-text-1); font-weight: var(--font-weight-medium); }
.rel { color: var(--ev-c-text-3); }

.status-pill {
    font-size: var(--font-size-micro);
    font-weight: var(--font-weight-semibold);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: var(--chip-padding);
    border-radius: var(--radius-sm);
}
.status-pill.on { color: var(--color-success); background-color: var(--color-success-soft); }
.status-pill.off { color: var(--ev-c-text-2); background-color: var(--ev-c-gray-3); }
.status-pill.warning { color: var(--color-warning); background-color: var(--color-warning-soft); }

/* ── switch ── */
.switch {
    position: relative;
    flex-shrink: 0;
    width: 40px;
    height: 22px;
    margin-top: 2px;
    padding: 0;
    border: none;
    border-radius: 11px;
    background-color: var(--ev-c-gray-2);
    cursor: pointer;
    transition: background-color var(--transition-fast);
}
.switch .knob {
    position: absolute;
    top: 3px;
    left: 3px;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background-color: var(--ev-c-white);
    transition: transform var(--transition-fast);
}
.switch[aria-checked="true"] { background-color: var(--color-accent); }
.switch[aria-checked="true"] .knob { transform: translateX(18px); }
.switch:focus-visible { outline: 2px solid var(--color-accent); outline-offset: 2px; }
.switch:disabled { opacity: 0.5; cursor: default; }

/* ── callout ── */
.callout {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
    padding: var(--space-3) var(--space-4);
    border-radius: var(--radius-md);
    font-size: var(--font-size-secondary);
    line-height: 1.5;
}
.callout.warning { background-color: var(--color-warning-soft); color: var(--ev-c-text-1); }
.callout.warning strong { color: var(--color-warning); font-weight: var(--font-weight-semibold); }

/* ── form ── */
.schedule-form {
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
    padding-top: var(--space-4);
    border-top: 1px solid var(--ev-c-gray-3);
}
.switch-row {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-5);
}
.switch-label {
    font-size: var(--font-size-body);
    font-weight: var(--font-weight-medium);
    color: var(--ev-c-text-1);
}
.field {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
}
.field-label {
    display: flex;
    align-items: baseline;
    gap: var(--space-3);
    font-size: var(--font-size-secondary);
    font-weight: var(--font-weight-medium);
    color: var(--ev-c-text-2);
}
.field-hint {
    font-size: var(--font-size-meta);
    font-weight: normal;
    color: var(--ev-c-text-3);
}
.field-error {
    font-size: var(--font-size-meta);
    color: var(--color-danger);
}

.seg {
    display: inline-flex;
    flex-wrap: wrap;
    align-self: flex-start;
    gap: var(--space-1);
    padding: var(--space-1);
    background-color: var(--color-background-mute);
    border: 1px solid var(--ev-c-gray-3);
    border-radius: var(--radius-lg);
}
.seg button {
    padding: var(--button-padding-small);
    background: transparent;
    border: none;
    border-radius: var(--radius-md);
    color: var(--ev-c-text-2);
    font-size: var(--font-size-secondary);
    cursor: pointer;
    transition: background-color var(--transition-fast), color var(--transition-fast);
}
.seg button:hover:not(:disabled):not(.active) { background-color: var(--ev-c-gray-3); color: var(--ev-c-text-1); }
.seg button.active {
    background-color: var(--color-accent-soft);
    color: var(--color-accent);
    font-weight: var(--font-weight-medium);
}
.seg button:disabled { cursor: default; opacity: 0.6; }

.stepper-row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
}
.stepper-label { font-size: var(--font-size-secondary); color: var(--ev-c-text-2); }
.stepper {
    display: inline-flex;
    align-items: stretch;
    border: 1px solid var(--ev-c-gray-2);
    border-radius: var(--radius-md);
    overflow: hidden;
}
.stepper button {
    width: 28px;
    background-color: var(--color-background-mute);
    border: none;
    color: var(--ev-c-text-1);
    font-size: var(--font-size-body);
    cursor: pointer;
}
.stepper button:hover:not(:disabled) { background-color: var(--ev-c-gray-3); }
.stepper button:disabled { color: var(--ev-c-text-3); cursor: default; }
.stepper input {
    width: 44px;
    padding: var(--space-1) 0;
    text-align: center;
    background-color: var(--color-background);
    border: none;
    border-left: 1px solid var(--ev-c-gray-3);
    border-right: 1px solid var(--ev-c-gray-3);
    color: var(--ev-c-text-1);
    font-size: var(--font-size-secondary);
    -moz-appearance: textfield;
}
.stepper input::-webkit-outer-spin-button,
.stepper input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
.stepper input:focus { outline: none; background-color: var(--color-accent-wash); }

.time-row {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--space-4);
}
.time-input {
    padding: var(--space-1) var(--space-3);
    background-color: var(--color-background-mute);
    border: 1px solid var(--ev-c-gray-2);
    border-radius: var(--radius-md);
    color: var(--ev-c-text-1);
    font-size: var(--font-size-body);
    color-scheme: var(--native-color-scheme);
}
.time-input:focus { outline: none; border-color: var(--color-accent); }
.local-eq {
    font-size: var(--font-size-meta);
    color: var(--ev-c-text-3);
}

/* ── upcoming runs: a small vertical timeline ── */
.runs {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
}
.run {
    position: relative;
    display: grid;
    grid-template-columns: 14px auto auto 1fr;
    align-items: center;
    column-gap: var(--space-3);
    padding: var(--space-1) 0;
    font-size: var(--font-size-secondary);
    color: var(--ev-c-text-2);
}
/* The rail between dots. */
.run:not(:last-child)::after {
    content: '';
    position: absolute;
    left: 6px;
    top: 50%;
    height: 100%;
    width: 2px;
    background-color: var(--ev-c-gray-3);
}
.run-dot {
    position: relative;
    z-index: 1;
    width: 8px;
    height: 8px;
    margin-left: 3px;
    border-radius: 50%;
    background-color: var(--ev-c-gray-1);
}
.run.first .run-dot { background-color: var(--color-accent); box-shadow: 0 0 0 3px var(--color-accent-soft); }
.run.first .run-date { color: var(--ev-c-text-1); font-weight: var(--font-weight-medium); }
.run.short .run-dot { background-color: var(--color-warning); }
.run-date { font-variant-numeric: tabular-nums; }
.run-rel { color: var(--ev-c-text-3); font-size: var(--font-size-meta); }
.run-gap {
    justify-self: start;
    font-size: var(--font-size-meta);
    color: var(--color-warning);
    background-color: var(--color-warning-soft);
    padding: var(--chip-padding);
    border-radius: var(--radius-sm);
}
.note {
    font-size: var(--font-size-meta);
    color: var(--ev-c-text-3);
    line-height: 1.5;
}
.note.warn { color: var(--color-warning); }

/* ── what a run does ── */
.what-runs {
    background-color: var(--color-background-mute);
    border-radius: var(--radius-md);
    padding: var(--space-3) var(--space-4);
}
.what-runs summary {
    cursor: pointer;
    font-size: var(--font-size-secondary);
    font-weight: var(--font-weight-medium);
    color: var(--ev-c-text-1);
    list-style: none;
    display: flex;
    align-items: center;
    gap: var(--space-2);
}
.what-runs summary::-webkit-details-marker { display: none; }
.what-runs summary::before {
    content: '';
    width: 0;
    height: 0;
    border-left: 5px solid var(--ev-c-text-2);
    border-top: 4px solid transparent;
    border-bottom: 4px solid transparent;
    transition: transform var(--transition-fast);
}
.what-runs[open] summary::before { transform: rotate(90deg); }
.steps {
    list-style: none;
    counter-reset: step;
    padding: 0;
    margin: var(--space-3) 0 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
}
.steps li {
    counter-increment: step;
    display: grid;
    grid-template-columns: 20px 1fr;
    column-gap: var(--space-3);
}
.steps li::before {
    content: counter(step);
    grid-row: span 2;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: var(--font-size-micro);
    font-weight: var(--font-weight-semibold);
    color: var(--ev-c-text-2);
    background-color: var(--ev-c-gray-3);
}
.steps li.risk::before { color: var(--color-warning); background-color: var(--color-warning-soft); }
.step-title { font-size: var(--font-size-secondary); color: var(--ev-c-text-1); }
.step-desc { font-size: var(--font-size-meta); color: var(--ev-c-text-3); }

/* ── footer ── */
.change-summary {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--font-size-secondary);
    color: var(--ev-c-text-2);
    min-width: 0;
}
.change-dot {
    flex-shrink: 0;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background-color: var(--color-accent);
}
.foot-actions { display: flex; gap: var(--space-3); flex-shrink: 0; }

/* ── release channel ── */
.lanes {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
    gap: var(--space-3);
}
.lane {
    display: flex;
    align-items: flex-start;
    gap: var(--space-3);
    padding: var(--space-4);
    text-align: left;
    background-color: var(--color-background-mute);
    border: 1px solid var(--ev-c-gray-3);
    border-radius: var(--radius-lg);
    color: inherit;
    font: inherit;
    cursor: pointer;
    transition: border-color var(--transition-fast), background-color var(--transition-fast);
}
.lane:hover:not(:disabled):not(.active) { border-color: var(--ev-c-gray-1); }
.lane.active { border-color: var(--color-accent); background-color: var(--color-accent-wash); cursor: default; }
.lane:disabled:not(.active) { opacity: 0.6; cursor: default; }
.radio {
    flex-shrink: 0;
    width: 14px;
    height: 14px;
    margin-top: 3px;
    border-radius: 50%;
    border: 2px solid var(--ev-c-gray-1);
    transition: border-color var(--transition-fast);
}
.lane.active .radio { border: 4px solid var(--color-accent); }
.lane-text { display: flex; flex-direction: column; gap: var(--space-1); }
.lane-name {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--font-size-body);
    font-weight: var(--font-weight-medium);
    color: var(--ev-c-text-1);
}
.lane-tag {
    font-size: var(--font-size-micro);
    padding: var(--chip-padding);
    border-radius: var(--radius-sm);
    color: var(--color-success);
    background-color: var(--color-success-soft);
}
.lane-tag.busy { color: var(--color-warning); background-color: var(--color-warning-soft); }
.lane-desc { font-size: var(--font-size-meta); color: var(--ev-c-text-2); line-height: 1.5; }


/* ── buttons (scoped per component, as elsewhere) ── */
.btn-ghost {
    padding: var(--button-padding);
    background: transparent;
    border: 1px solid var(--ev-c-gray-2);
    border-radius: var(--radius-lg);
    color: var(--ev-c-text-1);
    font-size: var(--font-size-button);
    cursor: pointer;
    transition: background-color var(--transition-fast);
}
.btn-ghost:hover:not(:disabled) { background-color: var(--ev-c-gray-3); }
.btn-ghost:disabled { opacity: 0.5; cursor: default; }
.btn-ghost.small {
    padding: 2px var(--space-3);
    font-size: var(--font-size-meta);
    border-radius: var(--radius-md);
    color: var(--ev-c-text-2);
}
.btn-accent {
    padding: var(--button-padding);
    background-color: var(--color-accent);
    color: var(--color-accent-text);
    border: none;
    border-radius: var(--radius-lg);
    font-size: var(--font-size-button);
    font-weight: var(--font-weight-medium);
    cursor: pointer;
    transition: background-color var(--transition-fast), opacity var(--transition-fast);
}
.btn-accent:hover:not(:disabled) { background-color: var(--color-accent-hover); }
.btn-accent:disabled { opacity: 0.5; cursor: default; }
.btn-warning {
    padding: var(--button-padding);
    background: transparent;
    border: 1px solid var(--color-warning);
    border-radius: var(--radius-lg);
    color: var(--color-warning);
    font-size: var(--font-size-button);
    font-weight: var(--font-weight-medium);
    cursor: pointer;
    transition: background-color var(--transition-fast), opacity var(--transition-fast);
}
.btn-warning:hover:not(:disabled) { background-color: var(--color-warning-soft); }
.btn-warning:disabled { opacity: 0.4; cursor: default; }
.btn-edit {
    flex-shrink: 0;
    padding: var(--button-padding-small);
    background-color: transparent;
    color: var(--ev-c-text-1);
    border: 1px solid var(--ev-c-gray-2);
    border-radius: var(--radius-md);
    cursor: pointer;
    font-size: var(--font-size-secondary);
    white-space: nowrap;
    transition: background-color var(--transition-fast);
}
.btn-edit:hover:not(:disabled) { background-color: var(--ev-c-gray-3); }
.btn-edit:disabled { opacity: 0.4; cursor: default; }

/* ── modal (same structure as ResyncModal) ── */
.modal-overlay {
    position: fixed;
    inset: 0;
    z-index: 300;
    background-color: var(--scrim);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-8);
}
.modal {
    display: flex;
    flex-direction: column;
    width: min(480px, 92vw);
    background-color: var(--color-background-soft);
    border: 1px solid var(--ev-c-gray-3);
    border-radius: var(--radius-xl);
    overflow: hidden;
}
.modal-wide {
    width: min(620px, 92vw);
    max-height: calc(100vh - 2 * var(--space-8));
}
/* Only the body scrolls, so the title and Save stay reachable on a short window. */
.modal-body.scroll {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    gap: var(--space-5);
}
.modal-footer.split {
    justify-content: space-between;
    align-items: center;
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
.icon-btn:hover:not(:disabled) { background-color: var(--ev-c-gray-3); }
.icon-btn:disabled { opacity: 0.4; cursor: default; }
.modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    padding: var(--space-4) var(--space-5);
    border-bottom: 1px solid var(--ev-c-gray-3);
}
.modal-title {
    font-size: var(--font-size-title);
    font-weight: var(--font-weight-semibold);
    color: var(--ev-c-text-1);
}
.modal-body {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-5);
    font-size: var(--font-size-body);
    color: var(--ev-c-text-1);
    line-height: 1.5;
}
.modal-points {
    margin: 0;
    padding-left: var(--space-5);
    list-style: disc;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    font-size: var(--font-size-secondary);
    color: var(--ev-c-text-2);
}
.ack {
    display: flex;
    align-items: flex-start;
    gap: var(--space-3);
    margin-top: var(--space-2);
    padding: var(--space-3);
    border-radius: var(--radius-md);
    background-color: var(--color-warning-soft);
    font-size: var(--font-size-secondary);
    cursor: pointer;
}
.ack input { margin-top: 3px; accent-color: var(--color-warning); }
.modal-footer {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-3);
    padding: var(--space-4) var(--space-5);
    border-top: 1px solid var(--ev-c-gray-3);
}
</style>
