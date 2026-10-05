/**
 * Node-persisted update policy: the `updates` block of /etc/stereum/stereum.yaml, and the root
 * cron entry that actually carries it out. Pure, unit-testable helpers; the exec side lives in
 * Node.getUpdateSettings / Node.setUpdateSettings.
 *
 * Mirrors stereum-dev/ethereum-node: the launcher's `setStereumSettings` rewrites the whole file,
 * then runs the `configure-updates` role, which adds or removes a root cron entry marked
 * "#Ansible: stereum auto unattended update" (minute, hour, a day-of-month step of interval_days,
 * running `<controls>/ansible/controls/unattended-update.sh`). Writing the file alone changes nothing on the node - the cron is only touched by that role. So
 * the cron is read back as well: it is what will really run, and a failed or skipped role run
 * leaves the two disagreeing.
 *
 * The whole schema (controls/roles/setup/templates/stereum.yaml) is controls_install_path, arch,
 * updates.lane and updates.unattended.{install,interval_days,hour,min}. Only `updates` is
 * writable here: controls_install_path is where every role cd's into, and arch is detected at
 * install, so changing either would break the node rather than configure it.
 */

export const STEREUM_SETTINGS_PATH = '/etc/stereum/stereum.yaml'
export const UNATTENDED_CRON_NAME = 'stereum auto unattended update'

export const LANES = ['stable', 'dev']

// interval_days lands in the cron day-of-month field as `*/N`, so it is a step over days 1-31, not
// a rolling interval. Stereum's UI stops at 28 for the same reason; 29+ would run once a month at
// most and read as a bug.
export const LIMITS = {
    interval_days: { min: 1, max: 28 },
    hour: { min: 0, max: 23 },
    min: { min: 0, max: 59 },
}

const SECTION = (name) => `===UPD_${name}===`

/**
 * One exec reading everything the update policy UI needs: the settings file, root's crontab, the
 * server clock and its timezone. The clock matters because cron fires in server-local time, which
 * is rarely the operator's own.
 *
 * Timezone sources in order of trust: timedatectl (systemd), /etc/timezone (Debian), the
 * /etc/localtime symlink target. Any of them can be missing in a container or minimal image, and
 * then `date +%z` is the fallback (a fixed offset, so DST shifts are not modelled).
 */
export function buildUpdateStateScript() {
    return [
        `echo '${SECTION('YAML')}'`,
        `cat ${STEREUM_SETTINGS_PATH} 2>/dev/null`,
        `echo '${SECTION('CRON')}'`,
        'crontab -l -u root 2>/dev/null',
        `echo '${SECTION('TIME')}'`,
        "date '+%s %z'",
        `echo '${SECTION('TZ')}'`,
        'tz=$(timedatectl show -p Timezone --value 2>/dev/null)',
        '[ -z "$tz" ] && tz=$(cat /etc/timezone 2>/dev/null)',
        '[ -z "$tz" ] && tz=$(readlink /etc/localtime 2>/dev/null | sed "s#.*/zoneinfo/##")',
        'echo "$tz"',
    ].join('\n')
}

function splitSections(stdout = '') {
    const out = {}
    let current = null
    for (const line of String(stdout).split('\n')) {
        const m = line.match(/^===UPD_([A-Z]+)===$/)
        if (m) { current = m[1]; out[current] = []; continue }
        if (current) out[current].push(line)
    }
    return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.join('\n')]))
}

const toInt = (v) => {
    if (typeof v === 'boolean' || v === null || v === undefined || v === '') return null
    const n = Number(v)
    return Number.isInteger(n) ? n : null
}

/**
 * The `updates` block as the UI sees it. Missing fields stay null rather than being filled with
 * stereum's defaults: the role would substitute a *random* hour/minute for a missing one, so a
 * made-up value here would claim a schedule the node does not have.
 *
 * `unpinned`: on, but some schedule field missing. Older stereum versions wrote only
 * `install: true` and let `configure-updates` decide - `default(59 | random)` minute,
 * `default(3 | random)` hour, `default(1)` day step. That schedule lives only in the cron entry,
 * and since `random` is unseeded, every later run of the role would roll a NEW time.
 */
export function normalizeUpdates(settings) {
    const u = settings?.stereum_settings?.settings?.updates || {}
    const un = u.unattended || {}
    const unattended = {
        install: un.install === true || un.install === 'true',
        interval_days: toInt(un.interval_days),
        hour: toInt(un.hour),
        min: toInt(un.min),
    }
    return {
        lane: LANES.includes(u.lane) ? u.lane : 'stable',
        laneRaw: u.lane ?? null,
        unattended,
        unpinned: unattended.install && [unattended.interval_days, unattended.hour, unattended.min].some((v) => v === null),
    }
}

/**
 * The unattended-update entry from `crontab -l`, as written by ansible.builtin.cron: a
 * `#Ansible: <name>` marker line followed by the job. `present: false` when the role removed it
 * (install: false) or never ran.
 */
export function parseUnattendedCron(crontab = '') {
    const lines = String(crontab).split('\n')
    const at = lines.findIndex((l) => l.trim() === `#Ansible: ${UNATTENDED_CRON_NAME}`)
    if (at < 0) return { present: false }
    const job = lines.slice(at + 1).find((l) => l.trim())
    if (!job) return { present: false }
    const fields = job.trim().split(/\s+/)
    const [minute, hour, day] = fields
    let interval = null
    if (day === '*') interval = 1
    else {
        const step = day?.match(/^\*\/(\d+)$/)
        if (step) interval = Number(step[1])
    }
    return {
        present: true,
        // Commented out by hand (or `disabled: yes`) - the entry exists but never fires.
        disabled: job.trim().startsWith('#'),
        line: job.trim(),
        min: toInt(minute),
        hour: toInt(hour),
        interval_days: interval,
    }
}

/**
 * How the cron compares to the settings file.
 *   'ok'       - both agree (on with the same schedule, or both off)
 *   'missing'  - settings say on, but no cron entry: nothing will run
 *   'stale'    - settings say off, but a cron entry still fires
 *   'mismatch' - both on, different schedule: the cron's schedule is the one that runs
 */
export function cronDrift(unattended, cron) {
    if (unattended.install) {
        if (!cron?.present || cron.disabled) return 'missing'
        // A field the file leaves out was the role's choice (random hour/minute, day step 1), so
        // only the fields the file actually pins can disagree with the cron.
        const agrees = (field, fallback = null) => {
            const want = unattended[field] ?? fallback
            return want === null || cron[field] === want
        }
        return agrees('min') && agrees('hour') && agrees('interval_days', 1) ? 'ok' : 'mismatch'
    }
    return cron?.present && !cron.disabled ? 'stale' : 'ok'
}

/** Server clock: unix seconds + UTC offset in minutes from `date '+%s %z'`. */
export function parseServerTime(text = '') {
    const m = String(text).trim().match(/^(\d+)\s+([+-])(\d{2})(\d{2})$/)
    if (!m) return { now: null, offsetMinutes: null }
    const sign = m[2] === '-' ? -1 : 1
    return { now: Number(m[1]), offsetMinutes: sign * (Number(m[3]) * 60 + Number(m[4])) }
}

/** An IANA zone name, or null - only names Intl accepts, so the renderer can pass it through. */
export function parseTimeZone(text = '') {
    const tz = String(text).trim().split('\n')[0]?.trim()
    if (!tz || !/^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)*$/.test(tz)) return null
    try {
        new Intl.DateTimeFormat('en-US', { timeZone: tz })
        return tz
    } catch {
        return null
    }
}

/**
 * Parse the state script's output. `yaml` is handed to the caller's parser (the main process
 * already depends on `yaml`), keeping this module free of it for the tests.
 * @param {string} stdout
 * @param {(text: string) => object} parseYaml
 */
export function parseUpdateState(stdout, parseYaml) {
    const s = splitSections(stdout)
    let settings = null
    let yamlError = null
    if (!s.YAML?.trim()) yamlError = `${STEREUM_SETTINGS_PATH} is missing or empty`
    else {
        try { settings = parseYaml(s.YAML) } catch (e) { yamlError = `Could not parse ${STEREUM_SETTINGS_PATH}: ${e?.message || e}` }
    }
    const updates = normalizeUpdates(settings)
    const cron = parseUnattendedCron(s.CRON)
    return {
        settings,
        yamlError,
        updates,
        cron,
        drift: settings ? cronDrift(updates.unattended, cron) : null,
        controlsPath: settings?.stereum_settings?.settings?.controls_install_path ?? null,
        arch: settings?.stereum_settings?.settings?.arch ?? null,
        server: { ...parseServerTime(s.TIME), timeZone: parseTimeZone(s.TZ) },
    }
}

/**
 * Validate an update-policy patch: `{ lane?, unattended?: { install?, interval_days?, hour?, min? } }`.
 * Unknown keys are rejected rather than ignored - this writes a root-owned file every role reads.
 * @returns {string[]} errors; empty when the patch is acceptable
 */
export function validateUpdatePatch(patch) {
    const errors = []
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return ['Patch must be an object']
    for (const k of Object.keys(patch)) if (!['lane', 'unattended'].includes(k)) errors.push(`Unknown setting: ${k}`)
    if ('lane' in patch && !LANES.includes(patch.lane)) errors.push(`Release channel must be one of ${LANES.join(', ')}`)
    const un = patch.unattended
    if (un !== undefined) {
        if (!un || typeof un !== 'object' || Array.isArray(un)) errors.push('unattended must be an object')
        else {
            for (const k of Object.keys(un)) if (!['install', ...Object.keys(LIMITS)].includes(k)) errors.push(`Unknown setting: unattended.${k}`)
            if ('install' in un && typeof un.install !== 'boolean') errors.push('unattended.install must be true or false')
            for (const [k, { min, max }] of Object.entries(LIMITS)) {
                if (!(k in un)) continue
                if (!Number.isInteger(un[k]) || un[k] < min || un[k] > max) errors.push(`unattended.${k} must be a whole number from ${min} to ${max}`)
            }
        }
    }
    return errors
}

/**
 * The settings object with the patch applied; every other key is carried through untouched.
 * Throws when the file lacks the `stereum_settings.settings` block: writing a fresh one would drop
 * controls_install_path, and every later playbook run would fail.
 */
export function applyUpdatePatch(settings, patch) {
    const base = settings?.stereum_settings?.settings
    if (!base || typeof base !== 'object' || !base.controls_install_path) {
        throw new Error(`${STEREUM_SETTINGS_PATH} has no stereum_settings.settings.controls_install_path - refusing to rewrite it`)
    }
    const next = structuredClone(settings)
    const s = next.stereum_settings.settings
    s.updates = { ...(s.updates || {}) }
    if ('lane' in patch) s.updates.lane = patch.lane
    if (patch.unattended) s.updates.unattended = { ...(s.updates.unattended || {}), ...patch.unattended }
    return next
}
