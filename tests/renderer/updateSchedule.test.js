import { describe, it, expect } from 'vitest'
import {
    cronDays, zoneOffsetMinutes, nextRuns, monthEndEffect, ordinal, formatOffset, hhmm,
    relativeFromNow, intervalLabel, randomQuietTime,
} from '@renderer/utils/updateSchedule'

const at = (iso) => Math.floor(Date.parse(iso) / 1000)

describe('cronDays', () => {
    it('steps over the day of the month from the 1st', () => {
        expect(cronDays(7)).toEqual([1, 8, 15, 22, 29])
        expect(cronDays(1)).toHaveLength(31)
        expect(cronDays(28)).toEqual([1, 29])
    })
})

describe('zoneOffsetMinutes', () => {
    it('follows DST for a named zone', () => {
        expect(zoneOffsetMinutes(Date.parse('2026-01-15T12:00:00Z'), 'Europe/Vienna')).toBe(60)
        expect(zoneOffsetMinutes(Date.parse('2026-07-15T12:00:00Z'), 'Europe/Vienna')).toBe(120)
        expect(zoneOffsetMinutes(Date.parse('2026-07-15T12:00:00Z'), 'Etc/UTC')).toBe(0)
    })
})

describe('nextRuns', () => {
    const vienna = (iso) => ({ now: at(iso), timeZone: 'Europe/Vienna' })

    it('daily: the next run is today when the time has not passed yet', () => {
        const runs = nextRuns({ interval_days: 1, hour: 3, min: 0 }, vienna('2026-10-05T00:30:00Z'), 2)
        // 03:00 Vienna (UTC+2 in October) = 01:00Z
        expect(runs[0].at).toBe(at('2026-10-05T01:00:00Z'))
        expect(runs[0].gapDays).toBeNull()
        expect(runs[1].gapDays).toBe(1)
    })

    it('daily: rolls to tomorrow once the time has passed', () => {
        const runs = nextRuns({ interval_days: 1, hour: 3, min: 0 }, vienna('2026-10-05T10:00:00Z'), 1)
        expect(runs[0].at).toBe(at('2026-10-06T01:00:00Z'))
    })

    it('every 7 days lands on the month days, including the short 29th -> 1st gap', () => {
        const runs = nextRuns({ interval_days: 7, hour: 3, min: 0 }, vienna('2026-10-20T12:00:00Z'), 4)
        expect(runs.map((r) => new Date(r.at * 1000).toISOString().slice(0, 10)))
            .toEqual(['2026-10-22', '2026-10-29', '2026-11-01', '2026-11-08'])
        expect(runs.map((r) => r.gapDays)).toEqual([null, 7, 3, 7])
    })

    it('keeps the wall-clock time across a DST change', () => {
        // Vienna leaves DST on 2026-10-25: 03:00 is 01:00Z before and 02:00Z after.
        const runs = nextRuns({ interval_days: 1, hour: 3, min: 0 }, vienna('2026-10-24T12:00:00Z'), 2)
        expect(runs[0].at).toBe(at('2026-10-25T02:00:00Z'))
        expect(runs[1].at).toBe(at('2026-10-26T02:00:00Z'))
    })

    it('uses the fixed offset when the node has no zone name', () => {
        const runs = nextRuns({ interval_days: 1, hour: 3, min: 0 }, { now: at('2026-10-05T10:00:00Z'), offsetMinutes: -240 }, 1)
        expect(runs[0].at).toBe(at('2026-10-06T07:00:00Z'))
    })

    it('is empty for an incomplete schedule or unknown clock', () => {
        expect(nextRuns({ interval_days: 1, hour: null, min: 0 }, vienna('2026-10-05T00:00:00Z'))).toEqual([])
        expect(nextRuns({ interval_days: 1, hour: 3, min: 0 }, { now: null })).toEqual([])
    })
})

describe('monthEndEffect', () => {
    it('is null for a daily schedule', () => {
        expect(monthEndEffect(1)).toBeNull()
    })
    it('reports the short gap for a weekly step', () => {
        expect(monthEndEffect(7)).toMatchObject({ shortestGap: 1, longestGap: 7 })
    })
    it('catches the 28-day step that also fires on the 29th', () => {
        expect(monthEndEffect(28).shortestGap).toBe(1)
    })
})

describe('formatting helpers', () => {
    it('ordinal', () => {
        expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 29].map(ordinal))
            .toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '29th'])
    })
    it('formatOffset', () => {
        expect(formatOffset(0)).toBe('UTC')
        expect(formatOffset(120)).toBe('UTC+2')
        expect(formatOffset(-270)).toBe('UTC-4:30')
    })
    it('hhmm', () => {
        expect(hhmm(3, 5)).toBe('03:05')
        expect(hhmm(null, 5)).toBe('--:--')
    })
    it('relativeFromNow', () => {
        expect(relativeFromNow(1000 + 2 * 86400 + 4 * 3600, 1000)).toBe('in 2d 4h')
        expect(relativeFromNow(1000 + 35 * 60, 1000)).toBe('in 35m')
        expect(relativeFromNow(1000 + 3600, 1000)).toBe('in 1h')
    })
    it('intervalLabel', () => {
        expect(intervalLabel(1)).toBe('Every day')
        expect(intervalLabel(7)).toBe('Every 7 days')
    })
    it('randomQuietTime stays inside 01:00-04:59', () => {
        expect(randomQuietTime(() => 0)).toEqual({ hour: 1, min: 0 })
        expect(randomQuietTime(() => 0.9999)).toEqual({ hour: 4, min: 59 })
    })
})
