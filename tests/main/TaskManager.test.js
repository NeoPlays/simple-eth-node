import { describe, it, expect, beforeEach, vi } from 'vitest'
import { TaskManager, parseSubTasks, taskContext } from '@main/tasks/TaskManager'

vi.mock('electron-log', () => ({ default: { debug: vi.fn(), info: vi.fn(), error: vi.fn(), warn: vi.fn() } }))

// A realistic stereumjson stdout: two recorded tasks plus a START_TASK marker that must be skipped.
const STDOUT = [
    'START_TASK\nTASK: kicking off\nACTION: noop',
    'TASK: Pull image\nACTION: docker_image\nCATEGORY: OK\nchanged: true',
    'TASK: Start container\nACTION: docker_container\nCATEGORY: OK\nok',
    '', // trailing block (the launcher pops the last element)
].join('\n\n')

describe('parseSubTasks', () => {
    it('returns [] for empty input', () => {
        expect(parseSubTasks()).toEqual([])
        expect(parseSubTasks('')).toEqual([])
    })

    it('parses TASK/ACTION/CATEGORY blocks and skips START_TASK + non-task blocks', () => {
        const subs = parseSubTasks(STDOUT)
        expect(subs).toHaveLength(2)
        expect(subs[0]).toMatchObject({ name: 'Pull image', action: 'docker_image', status: 'OK' })
        expect(subs[1]).toMatchObject({ name: 'Start container', action: 'docker_container', status: 'OK' })
        expect(subs[0].data).toContain('changed: true')
    })

    it('falls back to action when TASK header is absent', () => {
        const subs = parseSubTasks('ACTION: lonely_action\nCATEGORY: OK')
        expect(subs).toHaveLength(1)
        expect(subs[0].name).toBe('lonely_action')
    })
})

describe('TaskManager', () => {
    let tm
    beforeEach(() => { tm = new TaskManager() })

    // run() is fire-and-forget: resolve once the (single) task reaches a terminal status.
    function settled(taskId) {
        return new Promise((resolve) => {
            const off = tm.onUpdate((dto) => {
                if (dto.id === taskId && dto.status !== 'running') { off(); resolve(dto) }
            })
        })
    }

    it('starts empty', () => {
        expect(tm.list()).toEqual([])
        expect(tm.get('nope')).toBeNull()
    })

    it('run() returns a task id immediately and records a succeeded task', async () => {
        const id = tm.run('Start service', () => Promise.resolve({ stdout: STDOUT, stderr: '', rc: 0 }))
        expect(id).toBeTypeOf('string')
        // Task exists and is running synchronously, before the op resolves.
        expect(tm.list()[0]).toMatchObject({ id, label: 'Start service', status: 'running' })
        const done = await settled(id)
        expect(done.status).toBe('succeeded')
        expect(done.subTasks).toHaveLength(2)
        expect(done.endedAt).toBeTypeOf('number')
    })

    it('parses sub-tasks from the structured log field, preferred over stdout', async () => {
        // runPlaybook puts the parseable blocks on `log`; stdout has only the play recap.
        const id = tm.run('Op', () => Promise.resolve({ stdout: 'PLAY RECAP noise', log: STDOUT, rc: 0 }))
        const done = await settled(id)
        expect(done.subTasks).toHaveLength(2)
        expect(done.output).toContain('CATEGORY: OK')
        expect(done.output).not.toContain('PLAY RECAP')
    })

    it('marks the task failed when any sub-task CATEGORY is FAILED', async () => {
        const out = 'TASK: ok step\nACTION: a\nCATEGORY: OK\n\nTASK: bad step\nACTION: b\nCATEGORY: FAILED'
        const id = tm.run('Update OS', () => Promise.resolve({ stdout: out, rc: 0 }))
        const done = await settled(id)
        expect(done.status).toBe('failed')
    })

    it('captures stdout/stderr and marks failed when the op rejects (never throws)', async () => {
        const err = Object.assign(new Error('boom'), { stdout: 'TASK: x\nACTION: a\nCATEGORY: FAILED', stderr: 'oops' })
        const id = tm.run('Restart', () => Promise.reject(err))
        const task = await settled(id)
        expect(task.status).toBe('failed')
        expect(task.error).toBe('boom')
        expect(task.output).toContain('oops')
        expect(task.subTasks).toHaveLength(1)
    })

    it('records an array of ansible responses (e.g. restartChangedServices)', async () => {
        const responses = [
            { stdout: 'TASK: a\nACTION: x\nCATEGORY: OK', rc: 0 },
            { stdout: 'TASK: b\nACTION: y\nCATEGORY: OK', rc: 0 },
        ]
        const id = tm.run('Restart changed', () => Promise.resolve(responses))
        const done = await settled(id)
        expect(done.subTasks).toHaveLength(2)
        expect(done.status).toBe('succeeded')
    })

    it('emits an update on create and on completion', async () => {
        const updates = []
        tm.onUpdate((dto) => updates.push(dto.status))
        const id = tm.run('Op', () => Promise.resolve({ stdout: '', rc: 0 }))
        await settled(id)
        expect(updates).toEqual(['running', 'succeeded'])
    })

    it('streams sub-tasks live via the task-context reporter, accumulating segments in order', async () => {
        const snapshots = []
        tm.onUpdate((dto) => snapshots.push(dto.subTasks.map((s) => s.name)))
        const sub = (name) => ({ name, action: 'a', status: 'OK', data: name })

        const id = tm.run('Composite', async () => {
            const r = taskContext.getStore()
            expect(r).toBeTruthy()
            const a = r.begin('Update controls')
            r.report(a, [sub('p1-t1')])
            const b = r.begin('Update services')
            r.report(b, [sub('p2-t1')])
            r.report(a, [sub('p1-t1'), sub('p1-t2')]) // first playbook's segment grows
        })
        await settled(id)

        // segment a (in order) then segment b — regardless of report interleaving
        expect(tm.get(id).subTasks.map((s) => s.name)).toEqual(['p1-t1', 'p1-t2', 'p2-t1'])
        // live: panel saw intermediate states, not just the final one
        expect(snapshots).toContainEqual(['p1-t1'])
        expect(snapshots).toContainEqual(['p1-t1', 'p2-t1'])
    })

    it('keeps sub-tasks grouped per playbook, in begin() order, with a roll-up status', async () => {
        const sub = (name, status = 'OK') => ({ name, action: 'a', status, data: name })
        const id = tm.run('Composite', async () => {
            const r = taskContext.getStore()
            const a = r.begin('Update controls')
            r.report(a, [sub('p1-t1')])
            const b = r.begin('Update services')
            r.report(b, [sub('p2-t1', 'FAILED')])
        })
        await settled(id)

        const groups = tm.get(id).groups
        expect(groups.map((g) => g.label)).toEqual(['Update controls', 'Update services'])
        expect(groups[0]).toMatchObject({ status: 'ok', subTasks: [{ name: 'p1-t1' }] })
        expect(groups[1].status).toBe('failed')
    })

    it('does not re-parse the result when sub-tasks already streamed', async () => {
        const sub = { name: 'streamed', action: 'a', status: 'OK', data: 'd' }
        const id = tm.run('Op', async () => {
            taskContext.getStore().report(taskContext.getStore().begin(), [sub])
            return { log: 'TASK: fromresult\nACTION: a\nCATEGORY: OK' } // must be ignored
        })
        await settled(id)
        expect(tm.get(id).subTasks.map((s) => s.name)).toEqual(['streamed'])
    })

    it('keeps newest first and exposes full DTO via get()', async () => {
        const first = tm.run('first', () => Promise.resolve({ rc: 0 }))
        const second = tm.run('second', () => Promise.resolve({ rc: 0 }))
        await Promise.all([settled(first), settled(second)])
        const list = tm.list()
        expect(list[0].label).toBe('second')
        const full = tm.get(second)
        expect(full).toHaveProperty('output')
        expect(full).toHaveProperty('subTasks')
    })
})
