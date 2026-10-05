// Short, cheap previews of IPC values for the debug log.
//
// The validator calls carry 500-1000 pubkeys per argument, which turned a single `invoke` debug
// line into ~51 KB - 16 such lines were most of a 1 MB log file, burying everything else exactly
// when the log is needed. The response side already capped its output at 100 characters, but did
// so by stringifying the WHOLE response first and then discarding it, paying the full cost of the
// thing it was trying to avoid.
//
// So: collections are summarised by size and never stringified, and only scalars are rendered in
// full (up to a cap). One level deep is enough to keep `{ ok, states: {...} }` readable without
// ever walking into the payload.

export const LOG_MAX = 120

/**
 * A log-safe preview of any IPC value.
 * @param {*} value
 * @param {number} depth - internal; at depth > 0 collections collapse to a size only
 */
export function preview(value, depth = 0) {
    if (Array.isArray(value)) return `Array(${value.length})`
    if (value instanceof Error) return `Error(${value.message})`
    if (value && typeof value === 'object') {
        const keys = Object.keys(value)
        if (depth > 0) return `{${keys.length} fields}`
        const shown = keys.slice(0, 8)
        const parts = shown.map((k) => `${k}: ${preview(value[k], depth + 1)}`)
        const extra = keys.length - shown.length
        return `{ ${parts.join(', ')}${extra > 0 ? `, +${extra} more` : ''} }`
    }
    let s
    try { s = JSON.stringify(value) } catch { return '[unserialisable]' }
    if (s === undefined) return String(value) // undefined, functions, symbols
    return s.length > LOG_MAX ? `${s.slice(0, LOG_MAX)}…(+${s.length - LOG_MAX} chars)` : s
}

/** The `Args: [0]: … [1]: …` tail of an invoke log line. */
export function previewArgs(args = []) {
    return args.map((arg, i) => `[${i}]: ${preview(arg)}`).join(' ')
}
