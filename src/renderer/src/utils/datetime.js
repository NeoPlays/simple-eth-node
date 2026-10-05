// Date, time and number formatting in the user's own regional preferences.
//
// `toLocaleString()` with no locale does NOT mean "the user's machine": in Electron it resolves to
// the locale Chromium picked for the app UI, which falls back to en-US whenever the app ships no
// matching translation. A user whose machine is set to German or British English would then be
// shown US date order (9/25/2026, 2:20 PM) by an app that is otherwise correct about their system.
//
// So the locale comes from the OS via `get-system-locale`, and every formatter takes it explicitly.
// Passing `undefined` (or an empty list) falls back to Intl's own default, which is the right
// behaviour before the OS has answered and if it never does.

/** Normalise whatever the main process returned into something Intl accepts, or undefined. */
function asLocales(locales) {
    if (typeof locales === 'string' && locales) return locales
    if (Array.isArray(locales) && locales.length) return locales
    return undefined
}

/** Guard against the nulls that flow through from an unknown genesis time or missing slot. */
function toDate(unixSeconds) {
    if (unixSeconds == null || !Number.isFinite(Number(unixSeconds))) return null
    const d = new Date(Number(unixSeconds) * 1000)
    return Number.isNaN(d.getTime()) ? null : d
}

/** Date + time, e.g. "25/09/2026, 14:20" on an en-GB machine. Empty string when unknown. */
export function formatDateTime(unixSeconds, locales, options = {}) {
    const d = toDate(unixSeconds)
    if (!d) return ''
    return new Intl.DateTimeFormat(asLocales(locales), { dateStyle: 'medium', timeStyle: 'short', ...options }).format(d)
}

/** Time only, e.g. "14:20:11". Empty string when unknown. */
export function formatTime(unixSeconds, locales, options = {}) {
    const d = toDate(unixSeconds)
    if (!d) return ''
    return new Intl.DateTimeFormat(asLocales(locales), { timeStyle: 'medium', ...options }).format(d)
}

/** A number with the machine's own grouping separators, e.g. "1.274.903" on a German machine. */
export function formatNumber(value, locales, options = {}) {
    if (value == null || !Number.isFinite(Number(value))) return ''
    return new Intl.NumberFormat(asLocales(locales), options).format(Number(value))
}
