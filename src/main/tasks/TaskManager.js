import { randomUUID } from 'crypto'
import { AsyncLocalStorage } from 'async_hooks'
import log from 'electron-log'

// Cap the in-memory history. Tasks live in the main process: they survive
// renderer navigation but not an app restart (cross-restart history is the
// separate audit-log feature). Newest first; older tasks fall off the end.
const MAX_TASKS = 100

// Ambient progress channel: TaskManager.run() runs the op inside this context with a
// reporter; `runPlaybook` (possibly several calls deep in a composite op) reads it via
// getStore() and streams live sub-tasks — no callback threading through Node methods.
export const taskContext = new AsyncLocalStorage()

/**
 * Parse a playbook's `stereumjson` stdout into sub-tasks, mirroring the launcher's
 * TaskManager. The callback emits blocks separated by a blank line; each block has
 * `TASK:` / `ACTION:` / `CATEGORY:` lines (CATEGORY ∈ OK / FAILED / SKIPPED) plus
 * raw data. `START_TASK` marker blocks (the "task started" notices) are skipped.
 * @param {string} stdout
 * @returns {{ name: string, action: string|null, status: string|null, data: string }[]}
 */
export function parseSubTasks(stdout = '') {
    if (!stdout) return []
    const blocks = stdout.split('\n\n').filter((b) => b.trim() && !b.includes('START_TASK'))
    const subTasks = []
    for (const block of blocks) {
        const name = /^TASK: (.*)/m.exec(block)?.[1]
        const action = /^ACTION: (.*)/m.exec(block)?.[1]
        const status = /^CATEGORY: (.*)/m.exec(block)?.[1]
        // Skip blocks that aren't stereumjson task records (no recognised header).
        if (!name && !action && !status) continue
        subTasks.push({
            name: name || action || 'task',
            action: action || null,
            status: status || null,
            data: block,
        })
    }
    return subTasks
}

/** Derive a group's roll-up status from its sub-tasks: failed if any FAILED, else ok. */
function groupStatus(subTasks) {
    return subTasks.some((s) => s.status === 'FAILED') ? 'failed' : 'ok'
}

export class TaskManager {
    constructor() {
        this.tasks = [] // newest first
        this._listeners = new Set()
    }

    /** Subscribe to per-task updates (create + every status transition). Returns an unsubscribe fn. */
    onUpdate(cb) {
        this._listeners.add(cb)
        return () => this._listeners.delete(cb)
    }

    _emit(task) {
        const dto = this.toDTO(task)
        for (const cb of this._listeners) {
            try { cb(dto) } catch (e) { log.error('TaskManager listener error:', e?.message || e) }
        }
    }

    /** Lightweight DTO for the list (no output/subtask payload). */
    toListDTO(t) {
        return {
            id: t.id,
            label: t.label,
            nodeId: t.nodeId,
            status: t.status,
            createdAt: t.createdAt,
            startedAt: t.startedAt,
            endedAt: t.endedAt,
            subTaskCount: t.subTasks.length,
            error: t.error,
        }
    }

    /**
     * Full DTO including per-playbook groups, the flattened sub-task list, and captured
     * output. `groups` is `[{ label, status, subTasks }]` — one per playbook run so a
     * composite op (e.g. a full update) shows each playbook's steps separately; `subTasks`
     * is the flattened view kept for status/count.
     */
    toDTO(t) {
        return { ...this.toListDTO(t), groups: t.groups, subTasks: t.subTasks, output: t.output }
    }

    /** All tasks as full DTOs (newest first). The renderer keeps the list hydrated. */
    list() {
        return this.tasks.map((t) => this.toDTO(t))
    }

    get(id) {
        const t = this.tasks.find((t) => t.id === id)
        return t ? this.toDTO(t) : null
    }

    clear() {
        this.tasks = []
    }

    /**
     * Run an operation as a tracked task — **fire-and-forget**. The task is created and
     * `fn` started in the background; `run` returns the task id immediately. Callers
     * observe progress/completion via the `task-updated` stream (renderer) or by id, so
     * a long playbook no longer holds an IPC call open and survives renderer navigation.
     * Errors are captured on the task (status `failed` + `error`), never thrown — there
     * is no caller awaiting them.
     *
     * On completion the op's ansible output is parsed into sub-tasks; a single ansible
     * response, or an array of them, is recognised.
     * @param {string} label - human-facing label, e.g. "Start service · prod-1"
     * @param {() => Promise<any>} fn - the operation to run and observe
     * @param {{ nodeId?: string }} [opts]
     * @returns {string} the new task's id
     */
    run(label, fn, { nodeId = null } = {}) {
        const now = Date.now()
        const task = {
            id: randomUUID(),
            label,
            nodeId,
            status: 'running',
            createdAt: now,
            startedAt: now,
            endedAt: null,
            groups: [], // [{ label, status, subTasks }] — one per playbook run
            subTasks: [], // flattened view across groups (status + count)
            output: '',
            error: null,
        }
        this.tasks.unshift(task)
        if (this.tasks.length > MAX_TASKS) this.tasks.length = MAX_TASKS
        this._emit(task)

        const reporter = this._makeReporter(task)

        Promise.resolve()
            .then(() => taskContext.run(reporter, () => fn()))
            .then((result) => {
                // Live progress (reporter) is the source of truth for sub-tasks when a
                // playbook ran. Fall back to parsing the result only when nothing streamed
                // (non-playbook ops, or a result that carries its own log/stdout).
                if (!task.subTasks.length) this._recordResult(task, result)
                if (task.subTasks.some((s) => s.status === 'FAILED')) task.status = 'failed'
                else if (task.status === 'running') task.status = 'succeeded'
                task.endedAt = Date.now()
                this._emit(task)
            })
            .catch((error) => {
                // Capture whatever streamed before the failure; if nothing did, parse the
                // error's own log/stdout (a rejected ansible call carries it).
                if (!task.subTasks.length && error && (error.log || error.stdout || error.stderr)) {
                    this._recordResult(task, error)
                }
                task.status = 'failed'
                task.error = error?.message || String(error)
                task.endedAt = Date.now()
                this._emit(task)
                log.error(`Task failed: ${label}:`, error?.message || error)
            })

        return task.id
    }

    /**
     * Build the ambient reporter for a task. Each playbook within the op claims a segment
     * (`begin(label)`) that becomes a group; `report(segment, subTasks)` replaces that
     * group's steps. Groups stay in `begin()` order — so a composite op (multiple, even
     * parallel, playbooks) shows each playbook's steps under its own heading, updating
     * live as ansible logs them.
     */
    _makeReporter(task) {
        const segments = [] // { label, subTasks }
        const sync = () => {
            task.groups = segments.map((s) => ({
                label: s.label,
                status: groupStatus(s.subTasks),
                subTasks: s.subTasks,
            }))
            task.subTasks = segments.flatMap((s) => s.subTasks)
            this._emit(task)
        }
        return {
            begin: (label = 'Playbook') => {
                segments.push({ label, subTasks: [] })
                return segments.length - 1
            },
            report: (segment, subTasks) => {
                if (segments[segment]) segments[segment].subTasks = subTasks
                sync()
            },
        }
    }

    /**
     * Pull captured output + parsed sub-tasks out of an op result. Accepts a single
     * ansible response (`{ log, stdout, stderr, rc }`) or an array of them. The
     * structured `log` (the stereumjson per-task records written by `runPlaybook`) is
     * what carries the parseable `TASK:/ACTION:/CATEGORY:` blocks — stdout does not — so
     * it's preferred for both sub-task parsing and output. Non-ansible results (e.g.
     * restart summaries) simply contribute no output.
     */
    _recordResult(task, result) {
        const responses = Array.isArray(result) ? result : [result]
        const groups = []
        let output = ''
        for (const r of responses) {
            if (!r || typeof r !== 'object') continue
            const logText = r.log || r.stdout || ''
            if (logText) output += logText + '\n'
            if (r.stderr) output += r.stderr + '\n'
            const subTasks = logText ? parseSubTasks(logText) : []
            if (!subTasks.length) continue
            if (subTasks.some((s) => s.status === 'FAILED')) task.status = 'failed'
            groups.push({ label: 'Playbook', status: groupStatus(subTasks), subTasks })
        }
        task.groups = groups
        task.subTasks = groups.flatMap((g) => g.subTasks)
        task.output = output.trim()
    }
}

const taskManager = new TaskManager()
export default taskManager
