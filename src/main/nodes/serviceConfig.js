/**
 * Safety net for hand-edited service configs (pure; the exec side lives in Node).
 *
 * A config edit is one typo away from a client that will not start, so a write is checked first
 * and the file it replaces is kept. Backups live under `/etc/stereum-lite/`, OUTSIDE
 * `/etc/stereum/services`: both lite's and stereum's service discovery list every file in that
 * folder, so a `<id>.yaml.bak` there would show up as a broken extra service.
 */
import YAML from 'yaml'

export const SERVICES_DIR = '/etc/stereum/services'
export const BACKUP_DIR = '/etc/stereum-lite/config-backups'

/** Service ids are UUIDs; anything else never reaches a path. */
export const isServiceId = (id) => /^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/.test(String(id ?? ''))

export const configPath = (id) => `${SERVICES_DIR}/${id}.yaml`
export const backupPath = (id) => `${BACKUP_DIR}/${id}.yaml`

/**
 * Problems that would make the written config unusable, empty when it is fine. Only what is
 * certainly wrong is refused: unparseable YAML, a non-mapping, a missing `service`, or an `id`
 * that no longer matches the file (stereum keys the service by it).
 * @returns {string[]}
 */
export function checkServiceConfig(content, serviceId) {
    let doc
    try {
        doc = YAML.parse(String(content ?? ''))
    } catch (err) {
        return [`Not valid YAML: ${String(err?.message ?? err).split('\n')[0]}`]
    }
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return ['The config must be a YAML mapping (key: value lines)']
    const problems = []
    if (typeof doc.service !== 'string' || !doc.service.trim()) problems.push('The "service" field is missing')
    if (doc.id !== undefined && String(doc.id) !== String(serviceId)) {
        problems.push(`The "id" field (${doc.id}) must stay ${serviceId}: stereum finds the service by it`)
    }
    return problems
}

/** Copies the current config to its backup, keeping the file's time. Fails when there is no config. */
export const buildBackupCommand = (id) => `sh -c 'mkdir -p ${BACKUP_DIR} && cp -p ${configPath(id)} ${backupPath(id)}'`

/** Prints `<unix mtime>` on the first line, then the backup; prints nothing when there is none. */
export const buildBackupReadCommand = (id) => `sh -c 'if [ -f ${backupPath(id)} ]; then stat -c %Y ${backupPath(id)}; cat ${backupPath(id)}; fi'`

/** @returns {{ exists: boolean, content?: string, savedAt?: number }} savedAt in unix seconds */
export function parseBackupRead(stdout) {
    const text = String(stdout ?? '')
    const nl = text.indexOf('\n')
    if (!text.trim() || nl < 0) return { exists: false }
    const savedAt = Number(text.slice(0, nl).trim())
    if (!Number.isFinite(savedAt)) return { exists: false }
    return { exists: true, content: text.slice(nl + 1), savedAt }
}
