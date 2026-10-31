// Line diff for reviewing a config edit before it is written (LCS; configs are a few hundred lines).

const MAX_CELLS = 4_000_000

/**
 * @returns {Array<{ type: 'same'|'add'|'del', text: string }>} in display order, deletions before
 * the additions that replace them. Past MAX_CELLS it degrades to "all removed, all added" rather
 * than freezing the UI.
 */
export function diffLines(before, after) {
    const a = String(before ?? '').split('\n')
    const b = String(after ?? '').split('\n')
    // A trailing newline is not a line of its own.
    if (a.length > 1 && a[a.length - 1] === '') a.pop()
    if (b.length > 1 && b[b.length - 1] === '') b.pop()
    if (a.length * b.length > MAX_CELLS) {
        return [...a.map((text) => ({ type: 'del', text })), ...b.map((text) => ({ type: 'add', text }))]
    }
    // lcs[i][j] = common-subsequence length of a[i..] and b[j..]
    const lcs = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1))
    for (let i = a.length - 1; i >= 0; i--) {
        for (let j = b.length - 1; j >= 0; j--) {
            lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
        }
    }
    const out = []
    let i = 0
    let j = 0
    while (i < a.length && j < b.length) {
        if (a[i] === b[j]) { out.push({ type: 'same', text: a[i] }); i++; j++ }
        else if (lcs[i + 1][j] >= lcs[i][j + 1]) out.push({ type: 'del', text: a[i++] })
        else out.push({ type: 'add', text: b[j++] })
    }
    while (i < a.length) out.push({ type: 'del', text: a[i++] })
    while (j < b.length) out.push({ type: 'add', text: b[j++] })
    return out
}

/** Whether a diff has any change. */
export const hasChanges = (diff) => diff.some((d) => d.type !== 'same')

/**
 * Keep `context` unchanged lines around each change and fold longer unchanged runs into
 * `{ type: 'skip', count }`, so a one-flag edit in a long config reads as one small hunk.
 */
export function withContext(diff, context = 3) {
    const keep = diff.map(() => false)
    diff.forEach((d, i) => {
        if (d.type === 'same') return
        for (let k = Math.max(0, i - context); k <= Math.min(diff.length - 1, i + context); k++) keep[k] = true
    })
    const out = []
    let skipped = 0
    diff.forEach((d, i) => {
        if (keep[i]) {
            if (skipped) { out.push({ type: 'skip', count: skipped }); skipped = 0 }
            out.push(d)
        } else skipped++
    })
    if (skipped) out.push({ type: 'skip', count: skipped })
    return out
}
