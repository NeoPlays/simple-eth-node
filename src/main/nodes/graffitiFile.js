/**
 * Lighthouse's graffiti file (pure helpers, the exec side lives in Node).
 *
 * Stereum always starts Lighthouse with `--graffiti-file=/opt/app/graffitis/graffitis.yaml`.
 * While that flag is set, Lighthouse refuses the keymanager graffiti API but still answers 202,
 * so a keymanager write looks successful and changes nothing (found by upstream stereum on real
 * nodes). The graffiti therefore lives in the file, which Lighthouse re-reads on every proposal:
 * no restart is needed.
 *
 * Format: one `default: <text>` line and one `0x<pubkey>: <text>` line per key, split at the
 * first colon. Lighthouse rejects the WHOLE file over one invalid line, so updates drop blank
 * lines and never write a value containing a newline (isValidGraffiti refuses control chars).
 */
import { shellQuote } from "@main/nodes/metrics";

const FLAG = '--graffiti-file='
const PUBKEY_LINE = /^(0x[0-9a-fA-F]{96}):/
// Path chars we are willing to hand to the shell, even quoted.
const SAFE_PATH = /^\/[A-Za-z0-9._\-/]+$/

/**
 * Host path of a Lighthouse VC's graffiti file, or null when this service does not use one
 * (another client, no flag, or a flag pointing outside every volume).
 */
export function graffitiFilePath(config) {
    if (config?.service !== 'LighthouseValidatorService') return null
    const command = Array.isArray(config.command) ? config.command : String(config.command ?? '').split(/\s+/)
    const flag = command.find((c) => String(c).startsWith(FLAG))
    if (!flag) return null
    const inContainer = String(flag).slice(FLAG.length)
    for (const v of (config.volumes || [])) {
        const [host, container] = String(v).split(':')
        if (!host?.startsWith('/') || !container) continue
        const prefix = container.replace(/\/+$/, '')
        if (!inContainer.startsWith(prefix + '/')) continue
        const path = host.replace(/\/+$/, '') + inContainer.slice(prefix.length)
        if (!SAFE_PATH.test(path) || path.split('/').includes('..')) return null
        return path
    }
    return null
}

/** `{ default, keys: { pubkey(lowercase): text } }`; default is null when the file has none. */
export function parseGraffitiFile(text) {
    const keys = {}
    let fallback = null
    for (const line of String(text ?? '').split('\n')) {
        const i = line.indexOf(':')
        if (i < 0) continue
        const key = line.slice(0, i).trim()
        const value = line.slice(i + 1).trim()
        if (key === 'default') fallback = value
        else if (/^0x[0-9a-fA-F]{96}$/.test(key)) keys[key.toLowerCase()] = value
    }
    return { default: fallback, keys }
}

/**
 * The file with each key in `changes` set (string) or removed (null). Every other line is kept
 * as written, blank lines go, and a key listed twice collapses to one line.
 * @param {Map<string, string|null>} changes - keyed by lowercase pubkey
 */
export function updateGraffitiFile(text, changes) {
    const out = []
    const done = new Set()
    for (const line of String(text ?? '').split('\n')) {
        if (!line.trim()) continue
        const key = line.match(PUBKEY_LINE)?.[1].toLowerCase()
        if (key && changes.has(key)) {
            if (!done.has(key) && changes.get(key) !== null) out.push(`${key}: ${changes.get(key)}`)
            done.add(key)
            continue
        }
        out.push(line)
    }
    for (const [key, value] of changes) if (!done.has(key) && value !== null) out.push(`${key}: ${value}`)
    return out.length ? out.join('\n') + '\n' : ''
}

/** Graffiti for a key as Lighthouse will use it: its own line, else the file's default, else null. */
export function graffitiFromFile(parsed, pubkey) {
    return parsed.keys[String(pubkey).toLowerCase()] ?? parsed.default ?? null
}

/** Read command: prints the file, nothing when it does not exist yet. */
export const buildGraffitiReadCommand = (path) => `cat ${shellQuote(path)} 2>/dev/null || true`

/** Write commands, run in order. The content goes over stdin, so no graffiti text reaches the shell. */
export function buildGraffitiWriteCommands(path) {
    const dir = path.replace(/\/[^/]+$/, '') || '/'
    return { mkdir: `mkdir -p ${shellQuote(dir)}`, write: `tee ${shellQuote(path)} > /dev/null` }
}
