// When an unattended update will actually fire.
//
// Stereum's cron entry is `<min> <hour> */<interval_days> * *`, and that day field is a step over
// the DAY OF THE MONTH, not a rolling interval: "every 7 days" fires on the 1st, 8th, 15th, 22nd
// and 29th, then again on the 1st - two or three days later. Every "Every N days" label needs this
// next to it, or the schedule reads as something it isn't.
//
// Cron fires in the server's local time. The zone comes from the node (an IANA name when it has
// one, so DST is right; otherwise the fixed `date +%z` offset, which is right until the next DST
// change), never from this machine.

const DAY_MS = 86_400_000

/** Days of a month the `*\/N` day field matches (1-based). */
export function cronDays(intervalDays) {
    const n = Math.max(1, Math.floor(Number(intervalDays) || 1))
    const out = []
    for (let d = 1; d <= 31; d += n) out.push(d)
    return out
}

/** UTC offset in minutes of an IANA zone at an instant, via Intl (no tz database needed). */
export function zoneOffsetMinutes(instantMs, timeZone) {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone, hourCycle: 'h23',
        year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
    }).formatToParts(new Date(instantMs))
    const get = (t) => Number(parts.find((p) => p.type === t)?.value)
    const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'))
    return Math.round((asUtc - Math.floor(instantMs / 1000) * 1000) / 60_000)
}

/** Offset (minutes) of the server clock at an instant: the zone when known, else the fixed offset. */
export function serverOffsetAt(instantMs, server) {
    if (server?.timeZone) {
        try { return zoneOffsetMinutes(instantMs, server.timeZone) } catch { /* fall through */ }
    }
    return Number.isFinite(server?.offsetMinutes) ? server.offsetMinutes : 0
}

/** The instant (ms) at which the server's wall clock reads y-m-d hh:mm. */
function wallToInstant(y, m, d, hh, mm, server) {
    const wall = Date.UTC(y, m, d, hh, mm)
    // Two passes: the offset at the guess can differ from the offset at the answer across a DST edge.
    const first = wall - serverOffsetAt(wall, server) * 60_000
    return wall - serverOffsetAt(first, server) * 60_000
}

/**
 * The next `count` runs of a schedule, as unix seconds, each with the gap in days since the run
 * before it (null for the first). Empty when the schedule is incomplete or the clock is unknown.
 * @param {{ interval_days:number, hour:number, min:number }} schedule
 * @param {{ now:number, offsetMinutes?:number, timeZone?:string|null }} server
 */
export function nextRuns(schedule, server, count = 5) {
    const { interval_days: n, hour, min } = schedule || {}
    if (![n, hour, min].every(Number.isInteger) || !Number.isFinite(server?.now)) return []
    const days = new Set(cronDays(n))
    const nowMs = server.now * 1000
    // Today's date on the server's wall clock.
    const today = new Date(nowMs + serverOffsetAt(nowMs, server) * 60_000)
    const runs = []
    // 62 days covers two months, enough for any 1-28 step to produce `count` runs.
    for (let i = 0; i < 62 && runs.length < count; i++) {
        const day = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()) + i * DAY_MS)
        if (!days.has(day.getUTCDate())) continue
        const at = wallToInstant(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), hour, min, server)
        if (at <= nowMs) continue
        const prev = runs.at(-1)
        runs.push({ at: Math.floor(at / 1000), gapDays: prev ? Math.round((at / 1000 - prev.at) / 86_400) : null })
    }
    return runs
}

/**
 * Whether the month boundary breaks the rhythm for this interval, and the shortest gap it causes.
 * Interval 1 never does; 7 does (29th -> 1st is 1-3 days); 28 does too (it fires on the 1st and
 * the 29th, so in any month longer than February two runs land 1-3 days apart).
 */
export function monthEndEffect(intervalDays) {
    const n = Math.floor(Number(intervalDays))
    if (!Number.isInteger(n) || n <= 1) return null
    const days = cronDays(n)
    const last = days.at(-1)
    // Gap from the last matching day to the next 1st, across month lengths 28-31.
    const gaps = [28, 29, 30, 31].map((len) => {
        const lastInMonth = days.filter((d) => d <= len).at(-1)
        return len - lastInMonth + 1
    })
    const shortest = Math.min(...gaps)
    const longest = Math.max(...gaps)
    if (shortest === n && longest === n) return null
    return { days, lastDay: last, shortestGap: shortest, longestGap: longest }
}

/** Ordinal day for a short list ("1st, 8th, 15th"). English only, matching the rest of the UI. */
export function ordinal(n) {
    const s = ['th', 'st', 'nd', 'rd']
    const v = n % 100
    return n + (s[(v - 20) % 10] || s[v] || s[0])
}

/** "UTC+2", "UTC-4:30", "UTC" for a minute offset. */
export function formatOffset(minutes) {
    if (!Number.isFinite(minutes) || minutes === 0) return 'UTC'
    const sign = minutes < 0 ? '-' : '+'
    const abs = Math.abs(minutes)
    const h = Math.floor(abs / 60)
    const m = abs % 60
    return `UTC${sign}${h}${m ? `:${String(m).padStart(2, '0')}` : ''}`
}

/** Two-digit "03:05" from hour + minute. */
export function hhmm(hour, min) {
    if (!Number.isInteger(hour) || !Number.isInteger(min)) return '--:--'
    return `${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}`
}

/** "in 2d 4h", "in 35m" - coarse on purpose, the schedule is minute-granular at best. */
export function relativeFromNow(at, now) {
    if (!Number.isFinite(at) || !Number.isFinite(now)) return ''
    const s = Math.max(0, at - now)
    const d = Math.floor(s / 86_400)
    const h = Math.floor((s % 86_400) / 3600)
    const m = Math.floor((s % 3600) / 60)
    if (d) return `in ${d}d${h ? ` ${h}h` : ''}`
    if (h) return `in ${h}h${m ? ` ${m}m` : ''}`
    return `in ${Math.max(1, m)}m`
}

/** "Every day" / "Every 7 days" for an interval. */
export function intervalLabel(intervalDays) {
    if (!Number.isInteger(intervalDays)) return 'Unknown interval'
    return intervalDays === 1 ? 'Every day' : `Every ${intervalDays} days`
}

/**
 * A time spread across the quiet hours (01:00-04:59). Stereum randomises its default for the same
 * reason: thousands of nodes on one minute all hit the same image registries and apt mirrors.
 */
export function randomQuietTime(rand = Math.random) {
    return { hour: 1 + Math.floor(rand() * 4), min: Math.floor(rand() * 60) }
}
