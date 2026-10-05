import { describe, it, expect } from 'vitest'
import { formatDateTime, formatTime, formatNumber } from '@renderer/utils/datetime'

// 2026-09-25T12:20:11Z. Asserted through Intl rather than against literal strings so the tests
// describe the contract (locale is honoured) and not one ICU version's punctuation.
const TS = Date.UTC(2026, 8, 25, 12, 20, 11) / 1000
const UTC = { timeZone: 'UTC' }

describe('formatDateTime', () => {
    it('honours the locale it is given', () => {
        const gb = formatDateTime(TS, 'en-GB', UTC)
        const us = formatDateTime(TS, 'en-US', UTC)
        expect(gb).not.toBe(us)
        // Day-first vs month-first is the whole point of the change.
        expect(gb.indexOf('25')).toBeLessThan(gb.indexOf('Sep'))
        expect(us.indexOf('Sep')).toBeLessThan(us.indexOf('25'))
    })
    it('accepts a preference list and uses the first supported entry', () => {
        expect(formatDateTime(TS, ['en-GB', 'en-US'], UTC)).toBe(formatDateTime(TS, 'en-GB', UTC))
    })
    it('falls back to the runtime default for an empty or missing locale', () => {
        const dflt = formatDateTime(TS, undefined, UTC)
        expect(formatDateTime(TS, [], UTC)).toBe(dflt)
        expect(formatDateTime(TS, '', UTC)).toBe(dflt)
    })
    it('returns an empty string for an unknown time', () => {
        for (const bad of [null, undefined, NaN, 'nonsense']) expect(formatDateTime(bad, 'en-GB')).toBe('')
    })
})

describe('formatTime', () => {
    it('formats a time in the given locale', () => {
        expect(formatTime(TS, 'en-GB', UTC)).toContain('12:20:11')
        expect(formatTime(TS, 'en-US', UTC)).toMatch(/PM/i)
    })
    it('returns an empty string for an unknown time', () => {
        expect(formatTime(null, 'en-GB')).toBe('')
    })
})

describe('formatNumber', () => {
    it('groups digits the way the locale does', () => {
        expect(formatNumber(1274903, 'en-US')).toBe('1,274,903')
        expect(formatNumber(1274903, 'de-DE')).toBe('1.274.903')
    })
    it('returns an empty string for a non-number', () => {
        for (const bad of [null, undefined, NaN, 'x']) expect(formatNumber(bad, 'en-US')).toBe('')
    })
})
