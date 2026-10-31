// One line saying why a task failed, for the inline error on the card that started it. The full
// story stays in the task panel; this only has to point at the right place.

const MAX = 160

const firstLine = (text) => String(text ?? '').split('\n').map((l) => l.trim()).find(Boolean) ?? ''
const clip = (text) => (text.length > MAX ? `${text.slice(0, MAX - 1)}…` : text)

/**
 * @param {object|null} task - task DTO ({ status, error, subTasks: [{ name, status }] })
 * @returns {string|null} null when the task did not fail
 */
export function taskFailureSummary(task) {
    if (!task) return 'No result came back from the node'
    if (task.status !== 'failed') return null
    // The failed playbook step names the actual problem better than the generic exit error.
    const step = (task.subTasks || []).find((s) => s?.status === 'FAILED')
    if (step?.name) return clip(`Failed at "${firstLine(step.name)}"`)
    const error = firstLine(task.error)
    return error ? clip(error) : 'Failed'
}
