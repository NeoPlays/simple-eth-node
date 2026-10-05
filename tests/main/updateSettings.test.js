import { describe, it, expect } from 'vitest'
import YAML from 'yaml'
import {
    buildUpdateStateScript, normalizeUpdates, parseUnattendedCron, cronDrift, parseServerTime,
    parseTimeZone, parseUpdateState, validateUpdatePatch, applyUpdatePatch, UNATTENDED_CRON_NAME,
} from '@main/nodes/updateSettings'

// The file exactly as a real node carries it.
const NODE_YAML = `stereum_settings:
  settings:
    controls_install_path: /opt/stereum
    arch: x86_64
    updates:
      lane: stable
      unattended:
        install: true
        interval_days: 1
        hour: 0
        min: 26
`

// What ansible.builtin.cron writes into root's crontab.
const CRONTAB = `#Ansible: stereum auto unattended update
26 0 */1 * * cd "/opt/stereum/ansible/controls" && ./unattended-update.sh
#Ansible: resume stereum-services-update
@reboot cd "/opt/stereum/ansible/controls" && ./stereum-services-update.sh
`

const stateOutput = ({ yaml = NODE_YAML, cron = CRONTAB, time = '1759672800 +0200', tz = 'Europe/Vienna' } = {}) =>
    ['===UPD_YAML===', yaml, '===UPD_CRON===', cron, '===UPD_TIME===', time, '===UPD_TZ===', tz].join('\n')

describe('buildUpdateStateScript', () => {
    it('reads the file, root crontab, clock and timezone in one script', () => {
        const s = buildUpdateStateScript()
        expect(s).toContain('cat /etc/stereum/stereum.yaml')
        expect(s).toContain('crontab -l -u root')
        expect(s).toContain("date '+%s %z'")
        expect(s).toContain('timedatectl show -p Timezone --value')
    })
})

describe('normalizeUpdates', () => {
    it('reads the real node file', () => {
        expect(normalizeUpdates(YAML.parse(NODE_YAML))).toEqual({
            lane: 'stable', laneRaw: 'stable',
            unattended: { install: true, interval_days: 1, hour: 0, min: 26 },
            unpinned: false,
        })
    })
    it('keeps a missing hour/minute null instead of inventing stereum defaults', () => {
        // The role substitutes a random value for these, so any default shown would be a lie.
        const u = normalizeUpdates({ stereum_settings: { settings: { updates: { unattended: { install: true } } } } })
        expect(u.unattended).toEqual({ install: true, interval_days: null, hour: null, min: null })
    })
    it('flags a legacy file that only says install: true as unpinned', () => {
        const legacy = YAML.parse('stereum_settings:\n  settings:\n    controls_install_path: /opt/stereum\n    updates:\n      lane: stable\n      unattended:\n        install: true\n')
        expect(normalizeUpdates(legacy).unpinned).toBe(true)
    })
    it('is never unpinned while off', () => {
        expect(normalizeUpdates({ stereum_settings: { settings: { updates: { unattended: { install: false } } } } }).unpinned).toBe(false)
    })
    it('treats an unknown lane as stable but keeps the raw value visible', () => {
        const u = normalizeUpdates({ stereum_settings: { settings: { updates: { lane: 'beta' } } } })
        expect(u.lane).toBe('stable')
        expect(u.laneRaw).toBe('beta')
    })
    it('tolerates a missing file', () => {
        expect(normalizeUpdates(null).unattended.install).toBe(false)
    })
})

describe('parseUnattendedCron', () => {
    it('finds the ansible-marked entry and its schedule', () => {
        expect(parseUnattendedCron(CRONTAB)).toMatchObject({ present: true, disabled: false, min: 26, hour: 0, interval_days: 1 })
    })
    it('reads a bare * day field as every day', () => {
        const c = parseUnattendedCron(`#Ansible: ${UNATTENDED_CRON_NAME}\n0 3 * * * x`)
        expect(c.interval_days).toBe(1)
    })
    it('reports an absent entry', () => {
        expect(parseUnattendedCron('#Ansible: resume stereum-services-update\n@reboot x')).toEqual({ present: false })
        expect(parseUnattendedCron('')).toEqual({ present: false })
    })
    it('flags a commented-out entry as disabled', () => {
        expect(parseUnattendedCron(`#Ansible: ${UNATTENDED_CRON_NAME}\n#0 3 */7 * * x`).disabled).toBe(true)
    })
})

describe('cronDrift', () => {
    const on = { install: true, interval_days: 7, hour: 3, min: 0 }
    it('is ok when both agree', () => {
        expect(cronDrift(on, { present: true, min: 0, hour: 3, interval_days: 7 })).toBe('ok')
        expect(cronDrift({ ...on, install: false }, { present: false })).toBe('ok')
    })
    it('is missing when the file says on but nothing is scheduled', () => {
        expect(cronDrift(on, { present: false })).toBe('missing')
        expect(cronDrift(on, { present: true, disabled: true, min: 0, hour: 3, interval_days: 7 })).toBe('missing')
    })
    it('is stale when the file says off but cron still fires', () => {
        expect(cronDrift({ ...on, install: false }, { present: true, min: 0, hour: 3, interval_days: 7 })).toBe('stale')
    })
    it('accepts whatever the role picked for fields the file leaves out (legacy install: true)', () => {
        const legacy = { install: true, interval_days: null, hour: null, min: null }
        expect(cronDrift(legacy, { present: true, min: 41, hour: 2, interval_days: 1 })).toBe('ok')
        // ...but the role's day-step default is 1, so anything else is not what it would have written
        expect(cronDrift(legacy, { present: true, min: 41, hour: 2, interval_days: 7 })).toBe('mismatch')
        expect(cronDrift(legacy, { present: false })).toBe('missing')
    })
    it('still checks the fields the file does pin', () => {
        expect(cronDrift({ install: true, interval_days: null, hour: 3, min: null }, { present: true, min: 10, hour: 4, interval_days: 1 })).toBe('mismatch')
    })
    it('is a mismatch when the schedules differ', () => {
        expect(cronDrift(on, { present: true, min: 26, hour: 0, interval_days: 1 })).toBe('mismatch')
    })
})

describe('parseServerTime / parseTimeZone', () => {
    it('parses epoch and offset, including negative and half-hour offsets', () => {
        expect(parseServerTime('1759672800 +0200')).toEqual({ now: 1759672800, offsetMinutes: 120 })
        expect(parseServerTime('1 -0430')).toEqual({ now: 1, offsetMinutes: -270 })
        expect(parseServerTime('garbage')).toEqual({ now: null, offsetMinutes: null })
    })
    it('accepts only zone names Intl understands', () => {
        expect(parseTimeZone('Europe/Vienna\n')).toBe('Europe/Vienna')
        expect(parseTimeZone('Etc/UTC')).toBe('Etc/UTC')
        expect(parseTimeZone('')).toBeNull()
        expect(parseTimeZone('Not/AZone')).toBeNull()
        expect(parseTimeZone('$(rm -rf /)')).toBeNull()
    })
})

describe('parseUpdateState', () => {
    it('assembles the whole state from one script run', () => {
        const s = parseUpdateState(stateOutput(), YAML.parse)
        expect(s.yamlError).toBeNull()
        expect(s.drift).toBe('ok')
        expect(s.controlsPath).toBe('/opt/stereum')
        expect(s.arch).toBe('x86_64')
        expect(s.server).toEqual({ now: 1759672800, offsetMinutes: 120, timeZone: 'Europe/Vienna' })
        expect(s.settings.stereum_settings.settings.updates.unattended.min).toBe(26)
    })
    it('reports a missing file without guessing drift', () => {
        const s = parseUpdateState(stateOutput({ yaml: '' }), YAML.parse)
        expect(s.yamlError).toMatch(/missing or empty/)
        expect(s.drift).toBeNull()
    })
    it('reports an unparseable file', () => {
        const s = parseUpdateState(stateOutput({ yaml: 'a: [' }), YAML.parse)
        expect(s.yamlError).toMatch(/Could not parse/)
    })
    it('falls back to a fixed offset when no zone name is available', () => {
        expect(parseUpdateState(stateOutput({ tz: '' }), YAML.parse).server.timeZone).toBeNull()
    })
})

describe('validateUpdatePatch', () => {
    it('accepts a full valid patch', () => {
        expect(validateUpdatePatch({ lane: 'dev', unattended: { install: true, interval_days: 28, hour: 23, min: 59 } })).toEqual([])
    })
    it('accepts a partial patch', () => {
        expect(validateUpdatePatch({ unattended: { install: false } })).toEqual([])
    })
    it('rejects out-of-range and non-integer values', () => {
        expect(validateUpdatePatch({ unattended: { interval_days: 29 } })).toHaveLength(1)
        expect(validateUpdatePatch({ unattended: { interval_days: 0 } })).toHaveLength(1)
        expect(validateUpdatePatch({ unattended: { hour: 24 } })).toHaveLength(1)
        expect(validateUpdatePatch({ unattended: { min: 1.5 } })).toHaveLength(1)
        expect(validateUpdatePatch({ unattended: { min: '5' } })).toHaveLength(1)
    })
    it('rejects unknown keys, lanes and non-boolean install', () => {
        expect(validateUpdatePatch({ controls_install_path: '/' })[0]).toMatch(/Unknown setting/)
        expect(validateUpdatePatch({ unattended: { cmd: 'x' } })[0]).toMatch(/Unknown setting/)
        expect(validateUpdatePatch({ lane: 'nightly' })[0]).toMatch(/Release channel/)
        expect(validateUpdatePatch({ unattended: { install: 'yes' } })[0]).toMatch(/true or false/)
        expect(validateUpdatePatch(null)).toHaveLength(1)
    })
})

describe('applyUpdatePatch', () => {
    it('moves only the patched keys and keeps everything else', () => {
        const settings = YAML.parse(NODE_YAML)
        settings.stereum_settings.settings.custom = { keep: true }
        const next = applyUpdatePatch(settings, { unattended: { interval_days: 7, hour: 3, min: 0 } })
        expect(next.stereum_settings.settings).toEqual({
            controls_install_path: '/opt/stereum',
            arch: 'x86_64',
            custom: { keep: true },
            updates: { lane: 'stable', unattended: { install: true, interval_days: 7, hour: 3, min: 0 } },
        })
    })
    it('does not mutate its input', () => {
        const settings = YAML.parse(NODE_YAML)
        applyUpdatePatch(settings, { lane: 'dev' })
        expect(settings.stereum_settings.settings.updates.lane).toBe('stable')
    })
    it('creates the updates block when the file has none', () => {
        const next = applyUpdatePatch({ stereum_settings: { settings: { controls_install_path: '/opt/stereum' } } }, { lane: 'dev' })
        expect(next.stereum_settings.settings.updates).toEqual({ lane: 'dev' })
    })
    it('refuses a file without controls_install_path rather than writing a broken one', () => {
        expect(() => applyUpdatePatch({}, { lane: 'dev' })).toThrow(/refusing/)
        expect(() => applyUpdatePatch({ stereum_settings: { settings: {} } }, { lane: 'dev' })).toThrow(/refusing/)
    })
})
