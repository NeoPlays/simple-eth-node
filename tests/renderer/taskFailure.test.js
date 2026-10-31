import { describe, it, expect } from 'vitest'
import { taskFailureSummary } from '../../src/renderer/src/utils/taskFailure'

describe('taskFailureSummary', () => {
    it('is null for a task that did not fail', () => {
        expect(taskFailureSummary({ status: 'succeeded' })).toBeNull()
    })

    it('names the failed playbook step first', () => {
        const task = { status: 'failed', error: 'rc 2', subTasks: [{ name: 'Pull image', status: 'OK' }, { name: 'Start container', status: 'FAILED' }] }
        expect(taskFailureSummary(task)).toBe('Failed at "Start container"')
    })

    it('falls back to the first line of the error, clipped', () => {
        expect(taskFailureSummary({ status: 'failed', error: '\n  SSH exec timed out\nmore' })).toBe('SSH exec timed out')
        expect(taskFailureSummary({ status: 'failed', error: 'x'.repeat(300) })).toHaveLength(160)
        expect(taskFailureSummary({ status: 'failed' })).toBe('Failed')
    })

    it('reports a missing task as a failure', () => {
        expect(taskFailureSummary(null)).toMatch(/No result/)
    })
})
