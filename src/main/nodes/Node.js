import { SSHService, SSHParams } from "@main/ssh/SSHService";
import { taskContext, parseSubTasks } from "@main/tasks/TaskManager";
import {
    SYSTEM_METRICS_CMD, parseSystemMetrics,
    buildClientProbeScript, parseClientMetrics,
    buildDiskBreakdownCommand, parseDiskBreakdown,
    CURL_IMAGE, STEREUM_DOCKER_NETWORK,
    PROMETHEUS_SERVICE, PROMETHEUS_PORT,
    CLIENT_REGISTRY, shellQuote,
} from "@main/nodes/metrics";
import {
    normalizeBeaconUrl, buildBeaconValidatorsScript, parseBeaconStates, configuredBeaconBases,
    BEACON_ENDPOINT_FLAGS, buildValidatorIdentitiesScript, parseValidatorIdentities,
} from "@main/nodes/beaconValidators";
import {
    isResyncable, resolveDataDir, isSafeDataDir, updateSyncCommand, supportsCheckpointSync,
} from "@main/nodes/resync";
import { buildCheckpointProbeScript, parseCheckpointResult } from "@main/nodes/checkpoint";
import {
    keymanagerInfo, keymanagerTarget, keymanagerUrl, buildKeymanagerRequest, wrapSidecar,
    buildCurlConfigBatch, buildBatchSidecarCommand, parseBatchResponses,
    buildTokenReadCommand, parseToken, buildWeb3SignerRequest, keymanagerHttpError,
    parseKeymanagerResponse, parseKeystoresList, parseWeb3SignerPubkeys, validatorListable,
    feeRecipientPath, graffitiPath, parseFeeRecipient, parseGraffiti,
    isValidFeeRecipient, isValidGraffiti, graffitiByteLength, GRAFFITI_MAX_BYTES,
    isWriteSuccess, isClearSuccess, isValidPubkey, describeCurlFailure, buildWalletPermissionFix,
    buildCurlConfig, buildSidecarStdinCommand, buildImportBody, parseImportKeystoresResponse,
    KEYSTORES_PATH, DELETE_OK_STATUSES, parseDeleteKeystoresResponse,
    deleteErrors, deleteNotFound, protectionCoversAll,
} from "@main/nodes/keymanager";
import {
    buildClusterLockReadCommand, parseClusterLock, isDvtService,
    buildDvtProbeScript, parseDvtProbe, classifyVcBackend, mapSharesToDv,
} from "@main/nodes/dvt";
import {
    buildChainContextScript, parseChainContext, buildDutiesScript, parseDuties,
    dutiesByIndex, dutiesMeta,
} from "@main/nodes/validatorDuties";
import { validateInterchange, minimalInterchange, mergeInterchanges, KNOWN_GENESIS_ROOTS } from "@main/nodes/slashingProtection";
import { DELETE_CHUNK, chunked, importChunks, isPrysmWalletMissing, prysmWalletCommands } from "@main/nodes/importChecks";
import { buildDepositQueueScript, parseDepositQueue, depositQueuedState } from "@main/nodes/depositQueue";
import { checkEpochs, buildOnchainCheckScript, parseOnchainCheck, onchainVerdicts, summarizeVerdicts } from "@main/nodes/onchainCheck";
import {
    STEREUM_SETTINGS_PATH, buildUpdateStateScript, parseUpdateState, validateUpdatePatch, applyUpdatePatch,
} from "@main/nodes/updateSettings";
import {
    graffitiFilePath, parseGraffitiFile, updateGraffitiFile, graffitiFromFile,
    buildGraffitiReadCommand, buildGraffitiWriteCommands,
} from "@main/nodes/graffitiFile";
import {
    epochFromSlot, exitEligibility, parseSignedExit, exitBroadcastBody,
    isExitAccepted, exitStatusMessage, VOLUNTARY_EXIT_PATH, EXIT_POOL_PATH,
    usesPrysmRestExit, prysmExitEpoch, PRYSM_EXIT_ISSUE,
} from "@main/nodes/voluntaryExit";
import {
    isServiceId, configPath, checkServiceConfig, buildBackupCommand, buildBackupReadCommand, parseBackupRead,
} from "@main/nodes/serviceConfig";
import YAML from 'yaml';
import { randomUUID, randomBytes } from "crypto";
import log from 'electron-log';

// Prysm comes back from a restart after a wallet is created; poll its keymanager this long.
const PRYSM_READY_TIMEOUT_MS = 90_000
const PRYSM_READY_POLL_MS = 5_000

// Interval for re-reading a running playbook's log to stream live sub-tasks (task context only).
const PLAYBOOK_POLL_MS = 2000;

// Names all three sources so the user knows which one to fix.
const NO_BEACON_ERROR = 'No beacon available: this node has no running consensus client, its validator client names none, and no stats beacon is set';

/**
 * Represents a remote node managed via SSH
 */

/** What a protection-file check against `root` could not vouch for (see Node._genesisRoot). */
export function rootWarnings(root, known) {
    if (!root) return ['No beacon node answered and the network has no known genesis root, so the slashing protection file could not be confirmed to belong to this chain.']
    if (known) return [`No beacon node answered, so the slashing protection file was checked against the known genesis root of ${known}.`]
    return []
}

/** Import time limit: a minute of headroom plus 15s per keystore, at most 30 minutes. */
export function importTimeoutMs(count) {
    return Math.min(30 * 60_000, 60_000 + 15_000 * Math.max(1, Number(count) || 1))
}

export class Node {

    constructor(sshCredentials) {
        this.id = randomUUID();
        this.status = 'disconnected';
        this._statusListeners = new Set();
        this.sshService = new SSHService(
            new SSHParams(sshCredentials.host, sshCredentials.port, sshCredentials.username, sshCredentials.password, sshCredentials.privateKey, sshCredentials.passphrase),
            (state) => this._setStatus(state)
        );
        this.settings = null;
        this.services = [];
        this.setups = null;
    }

    _setStatus(status) {
        if (this.status === status) return;
        log.info(`Node :: ${this.sshService.SSHParams.host} :: ${this.status} → ${status}`);
        this.status = status;
        for (const cb of this._statusListeners) {
            try { cb(status) } catch (e) { log.error('status listener error:', e) }
        }
    }

    onStatusChange(cb) {
        this._statusListeners.add(cb);
        return () => this._statusListeners.delete(cb);
    }

    /**
     * @returns lightweight list DTO (no SSH calls)
     */
    toListDTO(){
        return {
            id: this.id,
            name: this.sshService.SSHParams.name,
            host: this.sshService.SSHParams.host,
            connected: this.sshService.connections.length > 0,
            status: this.status,
        }
    }

    async toDTO(refresh = false){
        await this.fetchSettings(refresh);
        await this.fetchServices(refresh);
        await this.fetchServiceConfigs();
        await this.fetchSetups(refresh);
        const containerStatuses = await this.fetchContainerStatuses();
        // serviceId -> its setup, so each service DTO carries its group + network.
        const setupByService = {}
        for (const setup of this.setups) {
            for (const sid of setup.services) setupByService[sid] = setup
        }
        return {
            id: this.id,
            name: this.sshService.SSHParams.name,
            host: this.sshService.SSHParams.host,
            port: this.sshService.SSHParams.port,
            username: this.sshService.SSHParams.username,
            status: this.status,
            settings: this.settings,
            setups: this.setups,
            services: this.services.map(s => {
                const su = setupByService[s.id]
                return {
                    ...s,
                    container: containerStatuses[s.id] ?? null,
                    setup: su ? { id: su.id, name: su.name, network: su.network, type: su.type, color: su.color } : null,
                    // Resync capability is a property of the client type (see resync.js) - the
                    // renderer can't import main-process modules, so surface it on the DTO.
                    resyncable: isResyncable(s.config),
                    supportsCheckpoint: supportsCheckpointSync(s.config),
                    // Validators tab: whether this service answers a keymanager-style read
                    // (the 5 VCs with the API flag on, + Web3Signer). reason = 'api-not-enabled'
                    // lets the UI explain a known client whose keymanager flag is off.
                    ...(() => { const km = keymanagerInfo(s.config); return { keymanagerCapable: km.capable, keymanagerReason: km.reason } })(),
                    // Whether the Validators tab can list keys for this service (keymanager API
                    // or Obol's cluster-lock.json). SSV lists via an external API - not yet wired.
                    validatorListable: validatorListable(s.config),
                }
            }),
        }
    }

    /**
     * Read `/etc/stereum/multisetup.yaml` (NOT under controls_install_path): map keyed by setup id;
     * type `common` = node-wide services. Absent on single-setup/older nodes - treated as no setups.
     * @returns {Promise<{ id, name, network, color, type, services: string[] }[]>}
     */
    async fetchSetups(refresh = false) {
        if (refresh || !this.setups) {
            const path = '/etc/stereum/multisetup.yaml'
            const response = await this.sshService.exec(`cat ${path}`)
            // Missing file (rc 1) means no multi-setup grouping; log it and carry on.
            if (response.rc !== 0 && response.rc !== null) {
                log.warn(`Node :: ${this.sshService.SSHParams.host} :: ${path} not found or unreadable (rc=${response.rc}): ${response.stderr?.trim() || 'no stderr'}`)
                this.setups = []
                return this.setups
            }
            const parsed = response.stdout?.trim() ? YAML.parse(response.stdout) : null
            this.setups = parsed && typeof parsed === 'object'
                ? Object.entries(parsed).map(([id, s]) => ({
                    id,
                    name: s?.name ?? id,
                    network: s?.network ?? null,
                    color: s?.color ?? null,
                    type: s?.type ?? null,
                    services: Array.isArray(s?.services) ? s.services : [],
                }))
                : []
        }
        return this.setups
    }

    /**
     * Fetch the node settings
     * @param {Boolean} refresh - force re-fetch
     * @returns parsed settings object
     */
    async fetchSettings(refresh = false) {
        if (refresh || !this.settings) {
            const response = await this.sshService.exec("cat /etc/stereum/stereum.yaml");
            if (response.rc !== 0) throw new Error(response.stderr || 'fetchSettings failed');
            this.settings = YAML.parse(response.stdout);
        }
        return this.settings;
    }
    /**
     * Fetch the node's services
     * @param {Boolean} refresh - force re-fetch
     * @returns parsed services object
     */
    async fetchServices(refresh = false) {
        if (refresh || !this.services || this.services.length === 0) {
            const response = await this.sshService.exec("ls /etc/stereum/services");
            if (response.rc !== 0) throw new Error(response.stderr || 'fetchServices failed');
            const serviceIDs = response.stdout.split('\n').filter(s => s.trim() !== '').map(s => s.replace('.yaml', '').trim());
            this.services = serviceIDs.map(id => ({ id }));
        }
        return this.services;
    }

    async fetchContainerStatuses() {
        const response = await this.sshService.exec("docker ps -a --format '{{json .}}'")
        if (response.rc !== 0) throw new Error(response.stderr || 'fetchContainerStatuses failed')
        const statuses = {}
        for (const line of response.stdout.split('\n').filter(l => l.trim())) {
            try {
                const c = JSON.parse(line)
                const match = c.Names?.match(/stereum-([a-f0-9-]{36})/)
                if (match) statuses[match[1]] = { state: c.State, status: c.Status, image: c.Image }
            } catch { /* skip malformed lines */ }
        }
        return statuses
    }

    async fetchRawServiceConfig(serviceId) {
        const response = await this.sshService.exec(`cat /etc/stereum/services/${serviceId}.yaml`)
        if (response.rc !== 0) throw new Error(response.stderr || `fetchRawServiceConfig failed for ${serviceId}`)
        return response.stdout
    }

    /**
     * Replace a service config. Refuses content that is certainly broken (checkServiceConfig) and
     * keeps the file it replaces under /etc/stereum-lite/config-backups first; if that copy fails,
     * nothing is written. The content goes over stdin, never through the shell.
     */
    async writeServiceConfig(serviceId, content) {
        if (!isServiceId(serviceId)) throw new Error(`Invalid service id: ${serviceId}`)
        const problems = checkServiceConfig(content, serviceId)
        if (problems.length) throw new Error(problems.join(' '))

        const backup = await this.sshService.exec(buildBackupCommand(serviceId))
        if (backup.rc !== 0 && backup.rc !== null) {
            throw new Error(`Could not back up the current config, nothing was written${backup.stderr ? `: ${String(backup.stderr).trim()}` : ''}`)
        }
        const response = await this.sshService.exec(`tee ${configPath(serviceId)} > /dev/null`, true, { input: String(content) })
        if (response.rc !== 0 && response.rc !== null) throw new Error(response.stderr || `writeServiceConfig failed for ${serviceId}`)
    }

    /**
     * The config as it was before the last write from lite, for review and restore.
     * @returns {Promise<{ exists: boolean, content?: string, savedAt?: number }>}
     */
    async fetchServiceConfigBackup(serviceId) {
        if (!isServiceId(serviceId)) throw new Error(`Invalid service id: ${serviceId}`)
        const res = await this.sshService.exec(buildBackupReadCommand(serviceId))
        return parseBackupRead(res.stdout)
    }

    /**
     * The node's update policy: the `updates` block of stereum.yaml, the root cron entry that
     * carries it out, and the server clock/timezone cron fires in. Read-only. Also refreshes the
     * cached settings, so a later playbook run never works from a file older than what the UI shows.
     */
    async getUpdateSettings() {
        const res = await this.sshService.exec(`sh -c ${shellQuote(buildUpdateStateScript())}`, true)
        if (res.rc !== 0 && res.rc !== null) throw new Error(res.stderr || 'Could not read update settings')
        const { settings, ...state } = parseUpdateState(res.stdout, (text) => YAML.parse(text))
        if (settings) this.settings = settings
        return state
    }

    /**
     * Change the update policy (release channel and/or unattended schedule), the way the launcher's
     * setStereumSettings does: rewrite stereum.yaml, then run `configure-updates` so the cron entry
     * follows. The file is re-read first so a change made elsewhere since the last read survives;
     * only the patched keys move. A failed role run leaves the file written and the cron as it was -
     * getUpdateSettings reports that as drift, and applyUpdateSchedule re-runs just the role.
     * @param {{ lane?: string, unattended?: { install?: boolean, interval_days?: number, hour?: number, min?: number } }} patch
     */
    async setUpdateSettings(patch) {
        const errors = validateUpdatePatch(patch)
        if (errors.length) throw new Error(errors.join('; '))
        const current = await this.fetchSettings(true)
        const next = applyUpdatePatch(current, patch)
        await this.writeStereumSettings(next)
        this.settings = next
        await this.applyUpdateSchedule()
        return this.getUpdateSettings()
    }

    /** Re-sync the cron entry with stereum.yaml (the `configure-updates` role reads the file itself). */
    async applyUpdateSchedule() {
        return this.runPlaybook('configure-updates')
    }

    /**
     * Replace stereum.yaml atomically: decode to a sibling temp file, then rename over the original.
     * Every playbook reads this file, so a write cut off halfway must never be what is left behind.
     */
    async writeStereumSettings(settings) {
        const b64 = Buffer.from(YAML.stringify(settings)).toString('base64')
        const tmp = `${STEREUM_SETTINGS_PATH}.tmp`
        const script = `base64 -d > ${tmp} && chmod 644 ${tmp} && mv ${tmp} ${STEREUM_SETTINGS_PATH}`
        const response = await this.sshService.exec(`echo '${b64}' | sudo sh -c ${shellQuote(script)}`, false)
        if (response.rc !== 0 && response.rc !== null) throw new Error(response.stderr || `Could not write ${STEREUM_SETTINGS_PATH}`)
    }

    async startService(serviceId) {
        return this.runPlaybook('manage-service', {
            manage_service: { state: 'started', configuration: { id: serviceId } }
        })
    }

    async stopService(serviceId) {
        return this.runPlaybook('manage-service', {
            manage_service: { state: 'stopped', configuration: { id: serviceId } }
        })
    }

    async restartService(serviceId) {
        return this.runPlaybook('manage-service', {
            manage_service: { state: 'restarted', configuration: { id: serviceId } }
        })
    }

    /**
     * Wipe a client's chain data and re-sync from scratch. Genesis by default; a checkpointUrl
     * (consensus clients only) fast-syncs from a trusted source. Composite task op: stop ->
     * wipe data dir -> (CL) rewrite checkpoint flag + write config -> start.
     *
     * Safety: the data dir is resolved from the config and gated by isSafeDataDir BEFORE any
     * stop/rm/write - an unresolved/unsafe path aborts the whole op (never a partial wipe). The
     * wipe runs as `sudo sh -c 'rm -rf <dir>/*'` so root expands the glob (root-owned dirs are
     * unlistable to the SSH user, so a bare `sudo rm -rf <dir>/*` would silently delete nothing).
     * @param {string} serviceId
     * @param {string|null} checkpointUrl - CL checkpoint-sync URL; null/empty = genesis sync
     */
    async resyncService(serviceId, checkpointUrl = null) {
        const raw = await this.fetchRawServiceConfig(serviceId)
        const config = YAML.parse(raw)
        if (!isResyncable(config)) throw new Error(`Service type ${config?.service ?? '?'} is not resyncable`)

        const dataDir = resolveDataDir(config)
        const controlsPath = this.settings?.stereum_settings?.settings?.controls_install_path
        if (!isSafeDataDir(dataDir, { serviceId, controlsPath })) {
            throw new Error(`Refusing resync: unsafe or unresolved data dir (${dataDir})`)
        }

        await this.stopService(serviceId)

        // Write the (reversible) config change BEFORE the (irreversible) wipe: if the write
        // fails, we abort with data still intact rather than wiped-with-a-stale-command.
        // Consensus clients carry the checkpoint/genesis flag in their command; EL clients
        // resync from a wipe alone, so their config is left untouched.
        if (supportsCheckpointSync(config)) {
            config.command = updateSyncCommand(config.command, config.service, checkpointUrl || null)
            await this.writeServiceConfig(serviceId, YAML.stringify(config))
        }

        // Long timeout: deleting a synced client's data (hundreds of GB) runs silent for well
        // over the 15s idle exec timeout. Same rationale as pruneDocker's timeout override.
        const wipe = await this.sshService.exec(
            `sh -c 'rm -rf ${shellQuote(dataDir)}/*'`, true, { timeoutMs: SSHService.PLAYBOOK_TIMEOUT_MS })
        if (wipe.rc !== 0 && wipe.rc !== null) throw new Error(wipe.stderr || `failed to wipe ${dataDir}`)

        await this.startService(serviceId)
    }

    /**
     * Validate a checkpoint-sync URL the way stereum's one-click installer does: HEAD-probe
     * `<url>/eth/v2/debug/beacon/states/finalized` (5s) and accept iff it answers HTTP 200.
     * Runs from a throwaway curl sidecar (guaranteed curl, no host apt-get) - the check is
     * outbound-only, so no stereum network is needed. Read-only; never mutates the node.
     * @param {string} url
     * @returns {Promise<{ ok: boolean, httpCode?: number, error?: string }>}
     */
    async checkCheckpointSync(url) {
        const script = buildCheckpointProbeScript(url)
        if (!script) return { ok: false, error: 'Enter a valid http(s) URL' }
        const escaped = script.replace(/'/g, `'"'"'`)
        const cmd = `docker run --rm --entrypoint sh ${CURL_IMAGE} -c '${escaped}'`
        const response = await this.sshService.exec(cmd, true, { timeoutMs: 20_000 })
        return parseCheckpointResult(response.stdout)
    }

    /**
     * List the validator keys a client is signing for, via the standard Keymanager REST API
     * over a curl sidecar (matches stereum's ValidatorAccountManager). Web3Signer is listed via
     * its own pubkeys endpoint. Read-only. Returns `{ ok, keys:[{pubkey,readonly,derivationPath?}] }`
     * or a soft error object (never throws) so the tab can render a reason instead of a blank.
     *
     * The bearer token travels in the curl config piped over stdin, never on the command line,
     * so it does not appear in the host process list.
     * @param {string} serviceId - the key-holding service (a *ValidatorService or Web3SignerService)
     */
    async listValidators(serviceId) {
        const raw = await this.fetchRawServiceConfig(serviceId)
        const config = YAML.parse(raw)

        // Obol: the real distributed-validator pubkeys come from the DVT client's cluster-lock.json
        // (read off the host), NOT the VC's share keystores. Matches stereum's getDVTKeys, which
        // handles CharonService and PlutoService in one combined case.
        if (isDvtService(config)) {
            const cmd = buildClusterLockReadCommand(config)
            if (!cmd) return { ok: false, error: 'Could not resolve the DVT client data directory', keys: [] }
            const res = await this.sshService.exec(cmd)
            if (res.rc !== 0 && res.rc !== null) return { ok: false, error: 'Could not read cluster-lock.json (is the cluster set up?)', keys: [] }
            return { ok: true, keys: parseClusterLock(res.stdout) }
        }

        const info = keymanagerInfo(config)
        if (!info.capable) return { ok: false, reason: info.reason || 'unsupported', keys: [] }

        // Web3Signer: no bearer token, its own /api/v1/eth2/publicKeys endpoint.
        if (info.web3signer) {
            const req = buildWeb3SignerRequest(serviceId)
            const res = await this.sshService.exec(req.command, true, { timeoutMs: 20_000, input: req.input })
            const { httpCode, body } = parseKeymanagerResponse(res.stdout)
            if (httpCode !== 200) return { ok: false, error: httpCode ? `Web3Signer HTTP ${httpCode}` : 'Web3Signer unreachable', httpCode, keys: [] }
            return { ok: true, keys: parseWeb3SignerPubkeys(body) }
        }

        // Validator client: GET /eth/v1/keystores, authenticated with the client's bearer token.
        const r = await this._keymanagerRequest(serviceId, config, { method: 'GET', path: '/eth/v1/keystores' })
        if (r.error) return { ok: false, error: r.error, keys: [] }
        // Prysm answers 503 until a wallet exists; the first import creates one.
        if (config.service === 'PrysmValidatorService' && isPrysmWalletMissing(r.body)) return { ok: true, keys: [], walletMissing: true }
        if (r.httpCode !== 200) return { ok: false, error: keymanagerHttpError(r), httpCode: r.httpCode, keys: [] }
        return { ok: true, keys: parseKeystoresList(r.body) }
    }

    /**
     * Put back the file permissions a client needs before it rewrites its key store (Prysm: see
     * buildWalletPermissionFix). Best effort: a failure is logged and the write goes ahead, so the
     * client's own error still reaches the user if this was not the cause.
     */
    async _prepareKeystoreWrite(config) {
        const cmd = buildWalletPermissionFix(config)
        if (!cmd) return
        try {
            const res = await this.sshService.exec(cmd, true)
            if (res.rc !== 0 && res.rc !== null) log.warn('wallet permission fix failed:', res.stderr || res.rc)
        } catch (e) {
            log.warn('wallet permission fix failed:', e?.message || e)
        }
    }

    /** Read a validator client's keymanager bearer token. Returns `{ token }` or `{ error }`. */
    async _keymanagerToken(serviceId, config) {
        const tokenCmd = buildTokenReadCommand({ id: serviceId, config })
        if (!tokenCmd) return { error: 'Could not resolve the keymanager token path' }
        const res = await this.sshService.exec(tokenCmd)
        if (res.rc !== 0 && res.rc !== null) return { error: 'Could not read the keymanager token (is the client running?)' }
        return { token: parseToken(config.service, res.stdout) }
    }

    /**
     * Run one authenticated keymanager request. The shared primitive behind every validator read
     * and write: it reads the bearer token (unless one is passed in, so bulk callers read it once)
     * and pipes the whole request as a curl config over stdin, keeping the token and any body out
     * of the host's process list.
     *
     * `error` means we never got an answer (token unreadable, endpoint unresolvable). Otherwise
     * `httpCode` carries the client's verdict - 0 when curl could not connect at all. Callers must
     * judge success from `httpCode`, never from the exec's rc.
     * @returns {Promise<{ httpCode?: number, body?: string, error?: string }>}
     */
    async _keymanagerRequest(serviceId, config, { method = 'GET', path, body, token, timeoutMs = 25_000 } = {}) {
        let bearer = token
        if (!bearer) {
            const t = await this._keymanagerToken(serviceId, config)
            if (t.error) return { error: t.error }
            bearer = t.token
        }
        // curl's own limit sits just under the exec's idle timeout: curl is silent while it waits,
        // so the exec timer would otherwise fire first and lose curl's "why".
        const timeoutS = Math.max(5, Math.floor(timeoutMs / 1000) - 5)
        const req = buildKeymanagerRequest({
            serviceId, target: keymanagerTarget(config), method, path, token: bearer, body, timeoutS,
        })
        if (!req) return { error: 'Could not resolve the keymanager endpoint' }
        const res = await this.sshService.exec(req.command, true, { timeoutMs, input: req.input })
        const parsed = parseKeymanagerResponse(res.stdout)
        return { httpCode: parsed.httpCode, body: parsed.body, curlError: parsed.httpCode ? null : describeCurlFailure(res.stderr), timeoutS }
    }

    /**
     * Run one keymanager request PER pubkey in a single sidecar, returning the responses keyed by
     * pubkey. Bulk actions can touch a thousand keys, so this must never become a loop of SSH
     * execs. Reads the bearer token once and reuses it for every request in the batch.
     * @param {(pubkey: string) => { method: string, path: string, body?: any }} makeRequest
     * @returns {Promise<{ responses?: object, error?: string }>}
     */
    async _keymanagerBatch(serviceId, config, pubkeys, makeRequest, { timeoutMs = 60_000 } = {}) {
        const t = await this._keymanagerToken(serviceId, config)
        if (t.error) return { error: t.error }
        const target = keymanagerTarget(config)
        if (!target) return { error: 'Could not resolve the keymanager endpoint' }

        const requests = []
        for (const pubkey of pubkeys) {
            // A malformed key would otherwise be interpolated straight into the URL path.
            // Skipping it here surfaces as "No response from the client" for that key, which is
            // the correct outcome: nothing was written for it.
            if (!isValidPubkey(pubkey)) continue
            const spec = makeRequest(pubkey)
            const url = keymanagerUrl({ serviceId, scheme: target.scheme, port: target.port, path: spec.path })
            if (!url) continue
            const headers = { Authorization: `Bearer ${t.token}` }
            if (spec.body !== undefined) headers['Content-Type'] = 'application/json'
            requests.push({ key: pubkey, url, method: spec.method, headers, body: spec.body, insecure: target.insecure })
        }
        const input = buildCurlConfigBatch(requests)
        if (!input) return { error: 'No valid keys to act on' }

        const res = await this.sshService.exec(buildBatchSidecarCommand(), true, { timeoutMs, input })
        return { responses: parseBatchResponses(res.stdout) }
    }

    /** Resolve a key-holding service's parsed config, or throw if it is not a keymanager client. */
    async _validatorConfig(serviceId, { write = false } = {}) {
        const config = YAML.parse(await this.fetchRawServiceConfig(serviceId))
        const info = keymanagerInfo(config)
        if (!info.capable || info.web3signer) return { error: 'This service does not support validator settings' }
        if (write) {
            // The UI gates these too, but a key share must never be written to on the UI's word alone.
            const behind = await this._dvtBehind(serviceId)
            if (behind) {
                return { error: `Refused: this validator client runs behind ${behind}, so it holds key shares of distributed validators. Exits, key changes and fee recipient are multi-party actions (Obol DV Launchpad).` }
            }
        }
        return { config }
    }

    /**
     * Which DVT client, if any, this validator client works behind - in its own setup, or on another
     * machine via its configured beacon endpoint (see `detectDvtBackends`). Null for a solo client.
     * @returns {Promise<string|null>} a description for the refusal message
     */
    async _dvtBehind(serviceId) {
        if (this.setups === null) await this.fetchSetups()
        if (!this.services?.length) await this.fetchServices()
        if (this.services.some(s => !s.config)) await this.fetchServiceConfigs()
        // Same grouping as the Validators tab: the service's setup, or every setup-less service.
        const setup = (this.setups || []).find((su) => su.services.includes(serviceId))
        const inSetup = setup
            ? (s) => setup.services.includes(s.id)
            : (s) => !(this.setups || []).some((su) => su.services.includes(s.id))
        const local = this.services.find((s) => inSetup(s) && isDvtService(s.config))
        if (local) return `${local.config.service} in the same setup`
        const backend = (await this.detectDvtBackends())[serviceId]
        if (backend?.client) return `${backend.client === 'pluto' ? 'Pluto' : 'Charon'} at ${backend.endpoint}`
        return null
    }

    /**
     * For every validator client on this node: is its beacon endpoint really a DVT client
     * (Charon/Pluto), possibly on another machine? One sidecar probes every configured endpoint's
     * /eth/v1/node/version, which Charon answers itself (see dvt.js). Cached for the node's lifetime;
     * `refresh` re-probes (the Validators tab does on open, so a reconfigured client is picked up).
     * @returns {Promise<{ [serviceId]: { client, endpoint, version, detectedBy, beacons } }>}
     */
    async detectDvtBackends({ refresh = false } = {}) {
        if (this._dvtBackends && !refresh) return this._dvtBackends
        if (!this.services?.length) await this.fetchServices()
        if (this.services.some(s => !s.config)) await this.fetchServiceConfigs()
        const containers = await this.fetchContainerStatuses()
        const vcs = this.services.filter((s) => BEACON_ENDPOINT_FLAGS[s.config?.service] && !isDvtService(s.config))
        const basesBy = Object.fromEntries(vcs.map((s) => [s.id, configuredBeaconBases([s], containers)]))
        let probe = {}
        const script = buildDvtProbeScript(Object.values(basesBy).flat())
        if (script) {
            const res = await this.sshService.exec(wrapSidecar(script), true, { timeoutMs: 30_000 })
            probe = parseDvtProbe(res.stdout)
        }
        const out = {}
        for (const [id, bases] of Object.entries(basesBy)) out[id] = classifyVcBackend(bases, probe)
        this._dvtBackends = out
        return out
    }

    /**
     * On-chain state for a validator client's keys when it runs behind a (possibly remote) DVT
     * client. Its keys are key shares, which have no beacon state of their own:
     *  1. Charon is asked with the shares; it maps each to its distributed validator and answers
     *     with that validator's index/status/balance - but with the pubkey rewritten back to the share.
     *  2. The distributed validator's own pubkey is then looked up BY INDEX: on a real beacon when one
     *     is at hand (stats-beacon override, this node's running consensus client, a non-DVT endpoint
     *     the validator client also lists), else through the DVT client itself via
     *     `validator_identities`, a route Charon passes to its beacon untouched (beaconValidators.js).
     *     Without either, stats still show and the rows just lack the DV pubkey.
     * @returns {Promise<{ ok, states: { [share]: object }, dvByShare: { [share]: string }, source, base, lookupError?, dvt, error? }>}
     */
    async getDvtValidatorStates(serviceId, shares = [], { beaconUrl } = {}) {
        const b = (await this.detectDvtBackends())[serviceId]
        if (!b?.client) return { ok: false, error: 'This validator client is not behind a DVT client', states: {}, dvByShare: {} }
        const dvt = { client: b.client, endpoint: b.endpoint, version: b.version, detectedBy: b.detectedBy }

        const viaDvt = buildBeaconValidatorsScript(b.endpoint, shares)
        if (!viaDvt) return { ok: true, states: {}, dvByShare: {}, source: null, base: null, dvt }
        const res = await this.sshService.exec(wrapSidecar(viaDvt), true, { timeoutMs: 30_000 })
        const { states, codes } = parseBeaconStates(res.stdout)
        if (codes.length && !codes.some((c) => c >= 200 && c < 300)) {
            const c = codes[0]
            const name = b.client === 'pluto' ? 'Pluto' : 'Charon'
            return { ok: false, error: c > 0 ? `${name} returned HTTP ${c}` : `${name} at ${b.endpoint} is unreachable or timed out`, states: {}, dvByShare: {}, dvt }
        }

        const indices = Object.values(states).map((s) => s.index).filter((i) => i != null).map(String)
        const ok2xx = (codes) => !codes.length || codes.some((c) => c >= 200 && c < 300)
        // Real beacons first (they answer the classic validators route), then the DVT client's own
        // passthrough, which only needs the beacon behind it to know validator_identities.
        const targets = []
        const override = beaconUrl ? normalizeBeaconUrl(beaconUrl) : null
        if (override) targets.push({ base: override, source: 'custom' })
        const own = override ? null : await this._resolveBeaconBase()
        if (own?.source === 'node') targets.push(own)
        if (!override && b.beacons.length) targets.push({ base: b.beacons[0], source: 'validator-config' })
        targets.push({ base: b.endpoint, source: 'dvt-passthrough', identities: true })

        let dvByShare = {}
        let used = null
        if (indices.length) {
            for (const t of targets) {
                const script = t.identities
                    ? buildValidatorIdentitiesScript(t.base, indices)
                    : buildBeaconValidatorsScript(t.base, indices)
                const r = await this.sshService.exec(wrapSidecar(script), true, { timeoutMs: 30_000 })
                const parsed = t.identities ? parseValidatorIdentities(r.stdout) : parseBeaconStates(r.stdout)
                if (!ok2xx(parsed.codes)) continue
                dvByShare = mapSharesToDv(states, t.identities ? parsed.byPubkey : parsed.states)
                if (Object.keys(dvByShare).length) { used = t; break }
            }
        }
        const lookupError = indices.length && !used
            ? `Could not look up the distributed validators' public keys (the beacon behind ${b.client === 'pluto' ? 'Pluto' : 'Charon'} may not support validator_identities)`
            : null
        return { ok: true, states, dvByShare, source: used?.source ?? null, base: used?.base ?? null, lookupError, dvt }
    }

    /**
     * Read the fee recipient and graffiti currently in effect for each pubkey. Read-only.
     *
     * Graffiti support is version-gated per client, so a 404 on the graffiti route is reported
     * once as `graffitiSupported: false` rather than as a per-key error - that is what lets the
     * UI hide the action on an older client instead of offering something that cannot work.
     * @returns {Promise<{ ok, settings?: { [pubkey]: { feeRecipient, graffiti } }, graffitiSupported?, error? }>}
     */
    async getValidatorSettings(serviceId, pubkeys = []) {
        const c = await this._validatorConfig(serviceId)
        if (c.error) return { ok: false, error: c.error, settings: {} }
        if (!pubkeys.length) return { ok: true, settings: {}, graffitiSupported: true }

        const fee = await this._keymanagerBatch(serviceId, c.config, pubkeys, (pubkey) => ({ method: 'GET', path: feeRecipientPath(pubkey) }))
        if (fee.error) return { ok: false, error: fee.error, settings: {} }

        // Lighthouse with a graffiti file: the file is what it proposes with, and the keymanager
        // graffiti route is refused while the flag is set, so the file is the only source.
        const filePath = graffitiFilePath(c.config)
        let fromFile = null
        let graffiti = null
        if (filePath) {
            const read = await this.sshService.exec(buildGraffitiReadCommand(filePath))
            fromFile = parseGraffitiFile(read.stdout)
        } else {
            graffiti = await this._keymanagerBatch(serviceId, c.config, pubkeys, (pubkey) => ({ method: 'GET', path: graffitiPath(pubkey) }))
            if (graffiti.error) return { ok: false, error: graffiti.error, settings: {} }
        }

        let graffitiSupported = true
        const settings = {}
        for (const pubkey of pubkeys) {
            const f = fee.responses[pubkey]
            const parsedFee = f ? parseFeeRecipient(f.httpCode, f.body) : { error: 'No response' }
            let graffitiValue = null
            if (fromFile) {
                graffitiValue = graffitiFromFile(fromFile, pubkey)
            } else {
                const g = graffiti.responses[pubkey]
                const parsedGraffiti = g ? parseGraffiti(g.httpCode, g.body) : { error: 'No response' }
                if (parsedGraffiti.unsupported) graffitiSupported = false
                graffitiValue = parsedGraffiti.value ?? null
            }
            settings[pubkey] = {
                feeRecipient: parsedFee.value ?? null,
                graffiti: graffitiValue,
            }
        }
        return { ok: true, settings, graffitiSupported }
    }

    /**
     * Set or clear the fee recipient for a set of keys. Passing `address = null` clears the
     * override, which restores the client's own default - it does NOT set the zero address.
     * @returns {Promise<{ ok, results?: { [pubkey]: { ok, error? } }, error? }>}
     */
    async setFeeRecipient(serviceId, pubkeys = [], address = null) {
        const clearing = address === null || address === ''
        if (!clearing && !isValidFeeRecipient(address)) {
            return { ok: false, error: 'Not a valid execution address' }
        }
        return this._applyValidatorWrite(serviceId, pubkeys, (pubkey) => (clearing
            ? { method: 'DELETE', path: feeRecipientPath(pubkey) }
            : { method: 'POST', path: feeRecipientPath(pubkey), body: { ethaddress: address } }
        ), clearing)
    }

    /** Set or clear graffiti. `text = null` clears the override. Capped at 32 BYTES, not chars. */
    async setGraffiti(serviceId, pubkeys = [], text = null) {
        const clearing = text === null
        if (!clearing && graffitiByteLength(text) > GRAFFITI_MAX_BYTES) {
            return { ok: false, error: `Graffiti must be at most ${GRAFFITI_MAX_BYTES} bytes (this is ${graffitiByteLength(text)})` }
        }
        if (!clearing && !isValidGraffiti(text)) return { ok: false, error: 'Graffiti cannot contain control characters' }

        const c = await this._validatorConfig(serviceId, { write: true })
        if (c.error) return { ok: false, error: c.error }
        const filePath = graffitiFilePath(c.config)
        if (filePath) return this._setGraffitiInFile(filePath, pubkeys, clearing ? null : text)

        return this._applyValidatorWrite(serviceId, pubkeys, (pubkey) => (clearing
            ? { method: 'DELETE', path: graffitiPath(pubkey) }
            : { method: 'POST', path: graffitiPath(pubkey), body: { graffiti: text } }
        ), clearing, c)
    }

    /**
     * Remove keystores from a validator client and return the slashing-protection record the
     * client hands back with them.
     *
     * This is the SAFE half of moving a key between hosts, and the ordering matters: the spec
     * defines DELETE as "guarantee no further signing, THEN serialise the protection data". The
     * opposite order - importing on the new host while the old one still signs - is the one
     * mistake slashing protection provably cannot save you from, because each host's database is
     * individually consistent and neither can see the other.
     *
     * The returned `slashingProtection` is the caller's only record of what these keys signed.
     * It must be persisted before the operation is presented as complete. Repeating the delete is
     * explicitly safe and re-returns the same data, which is the recovery path if the save fails.
     *
     * @returns {Promise<{ ok, results?, slashingProtection?, complete?, error?, httpCode? }>}
     */
    async deleteValidatorKeys(serviceId, pubkeys = []) {
        const c = await this._validatorConfig(serviceId, { write: true })
        if (c.error) return { ok: false, error: c.error }
        if (!pubkeys.length) return { ok: false, error: 'No keys selected' }

        await this._prepareKeystoreWrite(c.config)
        const token = await this._keymanagerToken(serviceId, c.config)
        if (token.error) return { ok: false, error: token.error }

        // DELETE_CHUNK keys per request: large deletes ran clients out of memory (upstream stereum),
        // and every answer carries the full signing history of its keys. Stopping keys and
        // serialising their history is slower than a settings write. A failure after the first
        // chunk marks only that chunk's keys as errors - `error` already means "may still be signing".
        const results = []
        const blobs = []
        for (const [n, chunk] of chunked(pubkeys, DELETE_CHUNK).entries()) {
            const r = await this._keymanagerRequest(serviceId, c.config, {
                method: 'DELETE', path: KEYSTORES_PATH, body: { pubkeys: chunk }, token: token.token, timeoutMs: 120_000,
            })
            let error = r.error || (r.httpCode !== 200 ? keymanagerHttpError(r) : null)
            const parsed = error ? null : parseDeleteKeystoresResponse(r.body, chunk)
            if (parsed?.error) error = parsed.error
            if (error) {
                if (n === 0) return { ok: false, error, ...(r.httpCode ? { httpCode: r.httpCode } : {}) }
                results.push(...chunk.map((pubkey) => ({ pubkey, status: 'error', message: error })))
                continue
            }
            results.push(...parsed.results)
            if (parsed.slashingProtection) blobs.push(parsed.slashingProtection)
        }

        // One chunk's record is returned exactly as the client produced it; several are joined.
        const merged = mergeInterchanges(blobs)
        if (merged.error) return { ok: false, error: merged.error, results }
        const slashingProtection = merged.interchange

        return {
            ok: true,
            results,
            slashingProtection,
            // Surfaced so the UI can warn rather than imply the file is a full backup: keys the
            // client never had contribute no history, and a key it could not stop is a hard stop.
            failed: deleteErrors(results).map((x) => x.pubkey),
            notFound: deleteNotFound(results).map((x) => x.pubkey),
            complete: protectionCoversAll(
                slashingProtection,
                results.filter((x) => DELETE_OK_STATUSES.includes(x.status)).map((x) => x.pubkey),
            ),
        }
    }

    /**
     * Chain context needed to judge an import or an exit: which chain this node is on, how far
     * along it is, and whether its view can be trusted. Read in one sidecar from the stats-beacon
     * override, else whatever `_resolveBeaconBase` picks.
     *
     * `genesisValidatorsRoot` is what makes a slashing-protection file verifiable: a file from
     * another chain describes signatures that never happened here. Which beacon supplied it is
     * part of the answer, hence `source`/`base`.
     * @returns {Promise<{ ok, genesisValidatorsRoot?, currentEpoch?, syncing?, optimistic?, source?, base?, error? }>}
     */
    async getBeaconContext({ beaconUrl } = {}) {
        const override = beaconUrl ? normalizeBeaconUrl(beaconUrl) : null
        if (beaconUrl && !override) return { ok: false, error: 'Invalid beacon URL' }
        const resolved = override ? { base: override, source: 'custom' } : await this._resolveBeaconBase()
        const { base, source } = resolved
        if (!base) return { ok: false, error: NO_BEACON_ERROR }

        const script = [
            `curl -sS -m 10 '${base}/eth/v1/beacon/genesis' -w '\\n===BCTX===\\n'`,
            `curl -sS -m 10 '${base}/eth/v1/node/syncing' -w '\\n===BCTX===\\n'`,
            `curl -sS -m 10 '${base}/eth/v1/config/spec'`,
        ].join(' ; ')
        const res = await this.sshService.exec(wrapSidecar(script), true, { timeoutMs: 30_000 })
        const [genesisRaw = '', syncingRaw = '', specRaw = ''] = String(res.stdout ?? '').split('===BCTX===')

        let genesisValidatorsRoot = null
        try { genesisValidatorsRoot = JSON.parse(genesisRaw.trim())?.data?.genesis_validators_root ?? null } catch { /* left null */ }

        let currentEpoch = null
        let syncing = false
        let optimistic = false
        let elOffline = false
        let syncDistance = null
        try {
            const d = JSON.parse(syncingRaw.trim())?.data
            currentEpoch = epochFromSlot(d?.head_slot)
            // Absent flags are treated as "not syncing" only because every client sets them; a
            // missing head_slot is what actually blocks an exit, and that is checked separately.
            syncing = d?.is_syncing === true || d?.is_syncing === 'true'
            optimistic = d?.is_optimistic === true || d?.is_optimistic === 'true'
            elOffline = d?.el_offline === true || d?.el_offline === 'true'
            const distance = Number(d?.sync_distance)
            syncDistance = d?.sync_distance != null && Number.isFinite(distance) ? distance : null
        } catch { /* left as unknown */ }

        // Fork epochs for the Prysm exit workaround; null when the beacon did not report them.
        let capellaForkEpoch = null
        let denebForkEpoch = null
        try {
            const spec = JSON.parse(specRaw.trim())?.data || {}
            const epoch = (v) => (v != null && /^\d+$/.test(String(v)) ? Number(v) : null)
            capellaForkEpoch = epoch(spec.CAPELLA_FORK_EPOCH)
            denebForkEpoch = epoch(spec.DENEB_FORK_EPOCH)
        } catch { /* left null */ }

        if (genesisValidatorsRoot === null && currentEpoch === null) {
            return { ok: false, error: 'Beacon node did not answer (is it reachable and synced?)', source, base }
        }
        return {
            ok: true, genesisValidatorsRoot, currentEpoch, syncing, optimistic, elOffline, syncDistance,
            capellaForkEpoch, denebForkEpoch, source, base,
        }
    }

    /**
     * Has any of these keys signed on chain in the current epoch or the three before it? Run
     * before an import: a key that is signing elsewhere right now must not start signing here too,
     * and no slashing-protection file can catch that (see onchainCheck.js for the two routes).
     * Read-only. `ok:false` means the check could not run at all - never "nothing is active".
     * @returns {Promise<{ ok, results?: { [pubkey]: { verdict, index?, signedIn, uncheckedEpochs } }, counts?, currentEpoch?, epochs?, base?, source?, error? }>}
     */
    async checkKeysOnChain(pubkeys = [], { beaconUrl } = {}) {
        const keys = [...new Set((Array.isArray(pubkeys) ? pubkeys : []).map((p) => String(p).toLowerCase()))]
        if (!keys.length) return { ok: true, results: {}, counts: summarizeVerdicts({}) }
        const ctx = await this.getBeaconContext({ beaconUrl })
        if (!ctx.ok) return { ok: false, error: ctx.error }
        const origin = { base: ctx.base, source: ctx.source }
        // A syncing beacon's head epoch is not the chain's: its "last 3 epochs" are long past.
        if (ctx.syncing || ctx.currentEpoch == null) {
            return { ok: false, error: 'The beacon node is still syncing, so recent activity cannot be checked', ...origin }
        }
        const st = await this.getValidatorStates(keys, { beaconUrl: ctx.source === 'custom' ? beaconUrl : undefined })
        if (!st.ok) return { ok: false, error: st.error, ...origin }

        const epochs = checkEpochs(ctx.currentEpoch)
        const indices = Object.values(st.states).filter((s) => s.index != null && s.status !== 'Pending').map((s) => s.index)
        let parsed = { liveness: {}, rewards: {} }
        const script = buildOnchainCheckScript(ctx.base, { currentEpoch: ctx.currentEpoch, indices })
        if (script) {
            const res = await this.sshService.exec(wrapSidecar(script), true, { timeoutMs: 60_000 })
            parsed = parseOnchainCheck(res.stdout)
        }
        const results = onchainVerdicts(keys, st.states, parsed, epochs)
        return { ok: true, results, counts: summarizeVerdicts(results), currentEpoch: ctx.currentEpoch, epochs, ...origin }
    }

    /**
     * Check a slashing-protection file against this node's chain and the keys being imported.
     *
     * `ok` means the check RAN, not that the file passed - failures are in `errors`. Only an
     * inability to check at all returns ok:false, because the caller distinguishes "this file is
     * bad" from "I could not tell", and must not treat the second as the first.
     */
    async validateSlashingProtection(content, pubkeys = [], serviceId = null) {
        const { root, known } = await this._genesisRoot(serviceId)
        const check = validateInterchange(content, { pubkeys, genesisValidatorsRoot: root })
        const warnings = [...check.warnings, ...rootWarnings(root, known)]
        return { ok: true, errors: check.errors, warnings, missing: check.missing, covered: check.covered, chainVerified: Boolean(root) }
    }

    /**
     * The chain's genesis validators root: the beacon's live answer, else the known root of the
     * validator client's network (KNOWN_GENESIS_ROOTS), so a file is still checked against the
     * chain when no beacon answers. `known` names the network when the fallback was used.
     * @returns {Promise<{ root: string|null, known: string|null }>}
     */
    async _genesisRoot(serviceId = null) {
        const ctx = await this.getBeaconContext()
        if (ctx.ok && ctx.genesisValidatorsRoot) return { root: ctx.genesisValidatorsRoot, known: null }
        if (!serviceId) return { root: null, known: null }
        let network = null
        try { network = YAML.parse(await this.fetchRawServiceConfig(serviceId))?.network ?? null } catch { /* unknown */ }
        const root = network ? KNOWN_GENESIS_ROOTS[network] ?? null : null
        return { root, known: root ? network : null }
    }

    /**
     * Create Prysm's wallet if it has none: Prysm cannot import (503 "wallet not initialized")
     * until one exists. Generates a wallet password (over stdin), runs `validator wallet create` in
     * the container, restarts the client, and waits for its keymanager to answer. A wallet whose
     * password file is gone is refused: a new password would lock it.
     * @returns {Promise<{ ok: true, created: boolean }|{ ok: false, error: string }>}
     */
    async _ensurePrysmWallet(serviceId, config) {
        // Best effort, like _prepareKeystoreWrite: when the folders or the wallet state cannot be
        // told, step aside and let the import run, so Prysm's own error reaches the user.
        const cmds = prysmWalletCommands(serviceId, config)
        if (!cmds) return { ok: true, created: false }
        const state = String((await this.sshService.exec(cmds.check)).stdout ?? '')
        if (state.includes('WALLET_ORPHAN')) {
            return { ok: false, error: 'Prysm has a wallet but its password file is missing. Restore wallet-password before importing; a new password would lock the wallet.' }
        }
        if (!state.includes('WALLET_MISSING')) return { ok: true, created: false }

        const failed = (res) => res.rc !== 0 && res.rc !== null
        if (failed(await this.sshService.exec(cmds.writePassword, true, { input: randomBytes(24).toString('hex') + '\n' }))) {
            return { ok: false, error: 'Could not write Prysm\'s wallet password' }
        }
        await this.sshService.exec(cmds.securePassword)
        const created = await this.sshService.exec(cmds.create, true, { timeoutMs: 60_000 })
        if (failed(created)) return { ok: false, error: `Creating Prysm's wallet failed${created.stderr ? `: ${String(created.stderr).trim()}` : ''}` }
        await this.sshService.exec(cmds.ownWallet)
        await this.restartService(serviceId)

        // The restart regenerates the token; poll until the keymanager answers with the new one.
        for (let waited = 0; waited <= PRYSM_READY_TIMEOUT_MS; waited += PRYSM_READY_POLL_MS) {
            const r = await this._keymanagerRequest(serviceId, config, { method: 'GET', path: KEYSTORES_PATH })
            if (r.httpCode === 200) return { ok: true, created: true }
            await this._sleep(PRYSM_READY_POLL_MS)
        }
        return { ok: false, error: 'Prysm\'s wallet was created, but its keymanager did not come back within 90 seconds. Try the import again.' }
    }

    _sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)) }

    /**
     * Import keystores into a validator client.
     *
     * The slashing-protection payload is validated in the renderer before it gets here, but it is
     * re-checked against the node's OWN genesis validators root, because that is the one fact the
     * renderer cannot establish on its own and the one that makes a protection file meaningful.
     *
     * @param {string[]} keystores - keystore JSON, each already serialised to a string
     * @param {string[]} passwords - positional, one per keystore
     * @param {string|null} slashingProtection - EIP-3076 interchange JSON as a string
     * @returns {Promise<{ ok, results?, error?, httpCode? }>}
     */
    async importValidatorKeys(serviceId, keystores = [], passwords = [], slashingProtection = null, { beaconUrl } = {}) {
        const c = await this._validatorConfig(serviceId, { write: true })
        if (c.error) return { ok: false, error: c.error }
        if (!keystores.length) return { ok: false, error: 'No keystores selected' }
        if (keystores.length !== passwords.length) {
            return { ok: false, error: 'Each keystore needs exactly one password' }
        }

        const pubkeys = keystores.map((k) => {
            try { return String(JSON.parse(k)?.pubkey ?? '') } catch { return '' }
        }).map((p) => (p && !p.startsWith('0x') ? `0x${p}` : p))

        // What the import could not vouch for travels back with the result: warned about, not
        // confirmed away. Only certain danger refuses (a key signing on chain, a protection file
        // that does not fit these keys); missing information is the operator's call.
        const warnings = []
        if (slashingProtection) {
            const { root, known } = await this._genesisRoot(serviceId)
            const check = validateInterchange(slashingProtection, { pubkeys, genesisValidatorsRoot: root })
            if (!check.ok) return { ok: false, error: check.errors.join(' '), validation: check }
            warnings.push(...rootWarnings(root, known))
        }
        if (!slashingProtection) {
            warnings.push('Imported without a slashing protection file: the client has no signing history for these keys, which is only safe if they have never signed.')
        }

        // On-chain activity gate, enforced here and not just in the modal: a key that signed in the
        // last epochs is running somewhere else, and two signers for one key is a slashing.
        const onchain = await this.checkKeysOnChain(pubkeys, { beaconUrl })
        const active = onchain.ok ? Object.entries(onchain.results).filter(([, r]) => r.verdict === 'active') : []
        if (active.length) {
            const list = active.map(([pk, r]) => `${pk.slice(0, 12)}… (validator ${r.index}, epoch ${r.signedIn[0]})`).join(', ')
            return { ok: false, error: `Refused: ${active.length === 1 ? 'this key is' : `${active.length} keys are`} signing on chain right now: ${list}. Stop the other client and wait a few epochs before importing.`, onchain }
        }
        if (!onchain.ok) warnings.push(`Recent on-chain activity could not be checked (${onchain.error}).`)
        else if (onchain.counts.unknown > 0) warnings.push(`Recent on-chain activity could not be fully checked for ${onchain.counts.unknown} ${onchain.counts.unknown === 1 ? 'key' : 'keys'}.`)

        if (c.config.service === 'PrysmValidatorService') {
            const wallet = await this._ensurePrysmWallet(serviceId, c.config)
            if (!wallet.ok) return { ok: false, error: wallet.error }
        }

        await this._prepareKeystoreWrite(c.config)
        const token = await this._keymanagerToken(serviceId, c.config)
        if (token.error) return { ok: false, error: token.error }

        // Chunked by count and bytes (importChunks): the client decrypts every keystore before it
        // answers, and one request must stay well under curl's config limit. Each chunk carries only
        // its own keys' protection in EIP-3076 minimal form, since a full multi-year history would
        // not fit. Reduced up front, so an unreadable value fails before any key is sent.
        const chunks = importChunks(keystores.map((k, i) => String(k).length + String(passwords[i] ?? '').length + (slashingProtection ? 300 : 0)))
        let protections
        try {
            protections = chunks.map(([start, end]) => (slashingProtection ? minimalInterchange(slashingProtection, pubkeys.slice(start, end)) : null))
        } catch (err) {
            return { ok: false, error: `The slashing protection file has an unreadable value: ${err?.message ?? err}` }
        }

        const results = []
        for (const [n, [start, end]] of chunks.entries()) {
            const keys = pubkeys.slice(start, end)
            // The limit grows with the chunk instead of a flat 20s (Prysm decrypts one by one).
            const r = await this._keymanagerRequest(serviceId, c.config, {
                method: 'POST',
                path: KEYSTORES_PATH,
                body: buildImportBody(keystores.slice(start, end), passwords.slice(start, end), protections[n]),
                token: token.token,
                timeoutMs: importTimeoutMs(keys.length),
            })
            if (r.curlError?.timedOut) {
                // A timeout is not a failure the client saw: the import may still finish over there.
                // Re-importing is safe either way - keys already present come back as `duplicate`.
                const error = `The client did not answer within ${r.timeoutS}s. It decrypts every keystore before replying, so the import may still be running: refresh the key list in a minute before trying again (keys that did get imported are reported as duplicate, never imported twice).`
                if (n === 0) return { ok: false, timedOut: true, error }
                // Later chunks are not sent while the client is still busy with this one.
                results.push(...pubkeys.slice(start).map((pubkey) => ({ pubkey, status: 'error', message: 'Not imported: the client was still busy with an earlier batch' })))
                warnings.push(error)
                break
            }
            let error = r.error || (r.httpCode !== 200 ? keymanagerHttpError(r) : null)
            const parsed = error ? null : parseImportKeystoresResponse(r.body, keys)
            if (parsed?.error) error = parsed.error
            if (error) {
                if (n === 0) return { ok: false, error, ...(r.httpCode ? { httpCode: r.httpCode } : {}) }
                results.push(...keys.map((pubkey) => ({ pubkey, status: 'error', message: error })))
                continue
            }
            results.push(...parsed.results)
        }
        return { ok: true, results, warnings }
    }

    /**
     * Per-key exit eligibility, judged against live beacon state. Read-only: nothing is signed or
     * sent. The UI must run this before offering the action, because the most common rejection
     * (activated less than 256 epochs ago) is invisible without it.
     */
    async getExitPreflight(serviceId, pubkeys = [], { beaconUrl, config } = {}) {
        if (!pubkeys.length) return { ok: false, error: 'No keys selected', checks: {} }
        let vcConfig = config
        if (!vcConfig) {
            const c = await this._validatorConfig(serviceId)
            if (c.error) return { ok: false, error: c.error, checks: {} }
            vcConfig = c.config
        }
        const ctx = await this.getBeaconContext({ beaconUrl })
        if (!ctx.ok) return { ok: false, error: ctx.error, checks: {} }

        // Prysm over REST signs exits with the wrong fork domain unless asked for Capella's epoch,
        // and cannot sign a valid one at all where Deneb starts with Capella (Hoodi).
        const prysm = usesPrysmRestExit(vcConfig)
        const signEpoch = prysm ? prysmExitEpoch(ctx) : null
        const clientBlocker = prysm && signEpoch === null
            ? `Prysm's validator client cannot sign a valid exit on this network (Capella and Deneb fork epochs ${ctx.capellaForkEpoch ?? 'unknown'} / ${ctx.denebForkEpoch ?? 'unknown'}), see ${PRYSM_EXIT_ISSUE}`
            : null

        const states = await this.getValidatorStates(pubkeys, { beaconUrl })
        if (!states.ok) return { ok: false, error: states.error, checks: {} }

        const checks = {}
        for (const pubkey of pubkeys) {
            const stat = states.states[String(pubkey).toLowerCase()] || {}
            checks[pubkey] = exitEligibility(
                { ...stat, pubkey },
                {
                    currentEpoch: ctx.currentEpoch, beaconSyncing: ctx.syncing, beaconOptimistic: ctx.optimistic,
                    beaconElOffline: ctx.elOffline, beaconSyncDistance: ctx.syncDistance, clientBlocker,
                },
            )
            // Carried to submit (main-process only, never trusted from the renderer) for the index check.
            if (stat.index != null) checks[pubkey].index = stat.index
        }
        return { ok: true, checks, currentEpoch: ctx.currentEpoch, signEpoch }
    }

    /**
     * Sign and broadcast a voluntary exit for each key: the validator client signs, the beacon node
     * gossips. Irreversible.
     *
     * The signed message never leaves the main process. It is a bearer credential with no expiry -
     * anyone holding it can exit that validator at any later time - so it is not returned over IPC,
     * not logged, and not written anywhere.
     *
     * Eligibility is re-checked here rather than trusted from the renderer's earlier preflight.
     * @returns {Promise<{ ok, results?: { [pubkey]: { ok, error? } }, error? }>}
     */
    async submitVoluntaryExit(serviceId, pubkeys = [], { beaconUrl } = {}) {
        const c = await this._validatorConfig(serviceId, { write: true })
        if (c.error) return { ok: false, error: c.error }
        if (!pubkeys.length) return { ok: false, error: 'No keys selected' }

        const preflight = await this.getExitPreflight(serviceId, pubkeys, { beaconUrl, config: c.config })
        if (!preflight.ok) return { ok: false, error: preflight.error }

        const base = (beaconUrl ? normalizeBeaconUrl(beaconUrl) : null) || (await this._resolveBeaconBase()).base
        if (!base) return { ok: false, error: 'No beacon node available to broadcast the exit' }

        const token = await this._keymanagerToken(serviceId, c.config)
        if (token.error) return { ok: false, error: token.error }

        const results = {}
        // Sequential on purpose: each exit is irreversible, and a partial failure must leave a
        // clear record of exactly which validators were submitted rather than a racing pile.
        for (const pubkey of pubkeys) {
            const eligible = preflight.checks[pubkey]
            if (!eligible?.eligible) {
                results[pubkey] = { ok: false, error: eligible?.reasons?.[0] || 'Not eligible to exit' }
                continue
            }
            const signed = await this._keymanagerRequest(serviceId, c.config, {
                method: 'POST', path: VOLUNTARY_EXIT_PATH(pubkey, preflight.signEpoch), token: token.token, timeoutMs: 30_000,
            })
            if (signed.error) { results[pubkey] = { ok: false, error: signed.error }; continue }
            if (signed.httpCode !== 200) { results[pubkey] = { ok: false, error: keymanagerHttpError(signed) }; continue }

            const parsedExit = parseSignedExit(signed.body, eligible.index)
            if (!parsedExit.ok) { results[pubkey] = { ok: false, error: parsedExit.error }; continue }

            // The beacon node is addressed by URL, not by container name, so the config is built
            // directly instead of through the service-scoped helper. It still goes over stdin: the
            // signed exit is a bearer credential and must not reach the process list.
            const input = buildCurlConfig({
                url: `${base}${EXIT_POOL_PATH}`,
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: exitBroadcastBody(parsedExit.signedExit),
            })
            const res = await this.sshService.exec(buildSidecarStdinCommand(), true, { timeoutMs: 30_000, input })
            const out = parseKeymanagerResponse(res.stdout)
            results[pubkey] = isExitAccepted(out.httpCode)
                ? { ok: true, message: exitStatusMessage(out.httpCode, out.body) }
                : { ok: false, error: exitStatusMessage(out.httpCode, out.body) }
        }
        return { ok: true, results }
    }

    /**
     * Set (text) or remove (null) the keys' lines in Lighthouse's graffiti file. Read-modify-write
     * of one small file, so every key shares the outcome. Lighthouse re-reads it per proposal.
     */
    async _setGraffitiInFile(path, pubkeys, text) {
        const keys = [...new Set(pubkeys.map((p) => String(p).toLowerCase()))].filter(isValidPubkey)
        if (!keys.length) return { ok: false, error: 'No keys selected' }

        const before = await this.sshService.exec(buildGraffitiReadCommand(path))
        if (before.rc !== 0 && before.rc !== null) return { ok: false, error: 'Could not read the Lighthouse graffiti file' }
        const next = updateGraffitiFile(before.stdout, new Map(keys.map((k) => [k, text])))

        const { mkdir, write } = buildGraffitiWriteCommands(path)
        let res = await this.sshService.exec(mkdir)
        if (res.rc === 0 || res.rc === null) res = await this.sshService.exec(write, true, { input: next })
        const written = res.rc === 0 || res.rc === null
        const outcome = written ? { ok: true } : { ok: false, error: `Writing ${path} failed${res.stderr ? `: ${String(res.stderr).trim()}` : ''}` }

        const results = {}
        for (const pubkey of pubkeys) {
            results[pubkey] = isValidPubkey(String(pubkey).toLowerCase()) ? outcome : { ok: false, error: 'No response from the client' }
        }
        return { ok: true, results }
    }

    /** Shared tail of the per-key write ops: batch, then judge each response on its own status. */
    async _applyValidatorWrite(serviceId, pubkeys, makeRequest, clearing, resolved = null) {
        const c = resolved ?? await this._validatorConfig(serviceId, { write: true })
        if (c.error) return { ok: false, error: c.error }
        if (!pubkeys.length) return { ok: false, error: 'No keys selected' }

        const batch = await this._keymanagerBatch(serviceId, c.config, pubkeys, makeRequest)
        if (batch.error) return { ok: false, error: batch.error }

        const results = {}
        for (const pubkey of pubkeys) {
            const r = batch.responses[pubkey]
            if (!r) { results[pubkey] = { ok: false, error: 'No response from the client' }; continue }
            const succeeded = clearing ? isClearSuccess(r.httpCode, r.body) : isWriteSuccess(r.httpCode, r.body)
            results[pubkey] = succeeded ? { ok: true } : { ok: false, error: keymanagerHttpError(r) }
        }
        return { ok: true, results }
    }

    /**
     * Which beacon to read when the user set no stats-beacon override, best-first: this node's
     * first RUNNING consensus client (`node`), else the endpoint its own validator client is
     * configured against (`validator-config`) - a VC-only host still knows where a beacon is,
     * and on-chain state is global. `source` comes along because the UI must say when the
     * beacon was picked for the user rather than by them.
     * @returns {Promise<{ base: string|null, source: 'node'|'validator-config'|null }>}
     */
    async _resolveBeaconBase() {
        if (!this.services?.length) await this.fetchServices()
        if (this.services.some(s => !s.config)) await this.fetchServiceConfigs()
        const containers = await this.fetchContainerStatuses()
        for (const s of this.services) {
            const reg = CLIENT_REGISTRY[s.config?.service]
            if (reg?.role === 'consensus' && containers[s.id]?.state === 'running') {
                return { base: `http://stereum-${s.id}:${reg.port}`, source: 'node' }
            }
        }
        const [configured] = configuredBeaconBases(this.services, containers)
        return configured ? { base: configured, source: 'validator-config' } : { base: null, source: null }
    }

    /**
     * On-chain state for a set of validator pubkeys via the beacon REST API
     * (`POST /eth/v1/beacon/states/head/validators`, chunked, one curl sidecar). ANY reachable
     * beacon answers for any pubkey: the stats-beacon override, else `_resolveBeaconBase`'s
     * pick. Read-only.
     * @param {string[]} pubkeys - 0x validator pubkeys (solo VC keys or Charon DV pubkeys)
     * @param {{ beaconUrl?: string }} opts - beaconUrl overrides the node's own beacon
     * @returns {Promise<{ ok, states: { [pubkey]: object }, source?: BeaconSource, base?: string, error? }>}
     */
    async getValidatorStates(pubkeys, { beaconUrl } = {}) {
        const override = beaconUrl ? normalizeBeaconUrl(beaconUrl) : null
        if (beaconUrl && !override) return { ok: false, error: 'Invalid beacon URL', states: {} }
        const resolved = override ? { base: override, source: 'custom' } : await this._resolveBeaconBase()
        const { base, source } = resolved
        if (!base) return { ok: false, error: NO_BEACON_ERROR, states: {} }
        // `base` rides along so the UI can name a beacon the user never chose.
        const origin = { source, base }
        const script = buildBeaconValidatorsScript(base, pubkeys)
        if (!script) return { ok: true, states: {}, ...origin } // no valid pubkeys
        const res = await this.sshService.exec(wrapSidecar(script), true, { timeoutMs: 30_000 })
        if (res.rc !== 0 && res.rc !== null) return { ok: false, error: 'Beacon query failed (is the beacon reachable?)', states: {}, ...origin }
        // res.rc is the trailing printf's status, never curl's - so detect failure from the per-chunk
        // HTTP codes: if every chunk returned non-2xx (incl. 000 = never connected), surface an error.
        const { states, codes } = parseBeaconStates(res.stdout)
        if (codes.length && !codes.some((c) => c >= 200 && c < 300)) {
            const c = codes[0]
            return { ok: false, error: c > 0 ? `Beacon returned HTTP ${c}` : 'Beacon unreachable or timed out', states: {}, ...origin }
        }
        // Keys the validators route does not know may be deposited but still queued (Electra's
        // pending_deposits): look those up so they read "deposit queued", not "not deposited".
        const missing = pubkeys.map((p) => String(p).toLowerCase()).filter((p) => !states[p])
        const dq = await this._depositQueueStates(base, missing)
        return { ok: true, states: { ...states, ...dq.states }, depositQueue: dq.queue, ...origin }
    }

    /**
     * Deposit-queue records for keys without a validator (see depositQueue.js). Best effort: a
     * beacon without the route (pre-Electra, older client) just yields nothing.
     * @returns {Promise<{ states: { [pubkey]: object }, queue: { length, totalEth }|null }>}
     */
    async _depositQueueStates(base, pubkeys = []) {
        const script = buildDepositQueueScript(base, pubkeys)
        if (!script) return { states: {}, queue: null }
        try {
            const res = await this.sshService.exec(wrapSidecar(script), true, { timeoutMs: 90_000 })
            const queue = parseDepositQueue(res.stdout)
            if (!queue.ok) return { states: {}, queue: null }
            const states = {}
            for (const [pk, match] of Object.entries(queue.matches)) states[pk] = depositQueuedState(pk, match, queue)
            return { states, queue: { length: queue.length, totalEth: queue.totalGwei / 1e9 } }
        } catch (e) {
            log.warn('deposit queue lookup failed:', e?.message || e)
            return { states: {}, queue: null }
        }
    }

    /**
     * Upcoming duties for a set of validator indices: sync-committee membership (this period and
     * next) and block proposals (this epoch only). Read-only, and independent of which client holds
     * the keys - duties are a property of the index on chain, so any reachable beacon answers.
     *
     * Two round trips, not one: the duties URLs need the current epoch and the period length, and
     * both come from the first response. Neither is cached - a duties refresh is per-epoch at most,
     * so a second exec costs less than a stale-spec bug would.
     *
     * @param {(number|string)[]} indices - validator indices; keys with no index are skipped
     * @param {{ beaconUrl?: string }} opts - beaconUrl overrides the node's own beacon
     * @returns {Promise<{ ok, duties: { [index]: object }, meta?: object, source?, base?, error? }>}
     */
    async getValidatorDuties(indices = [], { beaconUrl } = {}) {
        const override = beaconUrl ? normalizeBeaconUrl(beaconUrl) : null
        if (beaconUrl && !override) return { ok: false, error: 'Invalid beacon URL', duties: {} }
        const resolved = override ? { base: override, source: 'custom' } : await this._resolveBeaconBase()
        const { base, source } = resolved
        if (!base) return { ok: false, error: NO_BEACON_ERROR, duties: {} }
        const origin = { source, base }

        const wanted = new Set((Array.isArray(indices) ? indices : [])
            .filter((i) => i != null && Number.isFinite(Number(i)))
            .map((i) => String(i)))
        if (!wanted.size) return { ok: true, duties: {}, ...origin } // nothing on chain yet

        const ctxRes = await this.sshService.exec(wrapSidecar(buildChainContextScript(base)), true, { timeoutMs: 30_000 })
        const ctx = parseChainContext(ctxRes.stdout)
        if (ctx.currentEpoch == null) {
            const c = ctx.codes.find((x) => x > 0)
            return { ok: false, error: c ? `Beacon returned HTTP ${c}` : 'Beacon unreachable or timed out', duties: {}, ...origin }
        }

        const script = buildDutiesScript(base, { currentEpoch: ctx.currentEpoch, epochsPerSyncPeriod: ctx.spec.epochsPerSyncPeriod })
        const res = await this.sshService.exec(wrapSidecar(script), true, { timeoutMs: 30_000 })
        const parsed = parseDuties(res.stdout)
        if (parsed.codes.length && !parsed.codes.some((c) => c >= 200 && c < 300)) {
            const c = parsed.codes[0]
            return { ok: false, error: c > 0 ? `Beacon returned HTTP ${c}` : 'Beacon unreachable or timed out', duties: {}, ...origin }
        }

        const all = dutiesByIndex(parsed, { genesisTime: ctx.genesisTime, secondsPerSlot: ctx.spec.secondsPerSlot })
        const duties = {}
        for (const [index, d] of Object.entries(all)) if (wanted.has(index)) duties[index] = d
        return {
            ok: true,
            duties,
            // syncNextOk travels with the meta: a beacon that refused the next period must render as
            // "not known yet", never as "not scheduled".
            meta: { ...dutiesMeta({ currentEpoch: ctx.currentEpoch, spec: ctx.spec, genesisTime: ctx.genesisTime }), syncNextOk: parsed.syncNextOk },
            ...origin,
        }
    }

    /**
     * Ids of services whose config changed in the last `timeScopeSeconds` (mirrors the upstream `restart-services` role's selection).
     * @param {number} timeScopeSeconds
     * @returns {Promise<string[]>} ids of changed services
     */
    async findChangedServiceIds(timeScopeSeconds) {
        const scope = Math.floor(Number(timeScopeSeconds))
        if (!Number.isFinite(scope) || scope <= 0) throw new Error('timeScopeSeconds must be a positive number')
        // Requires GNU find (-newermt, -printf).
        const cmd = `find /etc/stereum/services -maxdepth 1 -type f -name '*.yaml' -newermt "${scope} seconds ago" -printf '%f\\n'`
        const response = await this.sshService.exec(cmd)
        if (response.rc !== 0 && response.rc !== null) throw new Error(response.stderr || 'findChangedServiceIds failed')
        return response.stdout
            .split('\n')
            .map(s => s.trim())
            .filter(Boolean)
            .map(f => f.replace(/\.yaml$/, ''))
    }

    /**
     * Restart services changed within the window - the upstream `restart-services` role, but parallel.
     * @param {number} timeScopeSeconds - lookback window in seconds
     * @param {{ prune?: boolean }} [opts] - docker prune afterwards (default true, mirrors the role)
     * @returns {Promise<{ serviceId: string, ok: boolean, error?: string }[]>} per-service outcome
     */
    async restartChangedServices(timeScopeSeconds, { prune = true } = {}) {
        const serviceIds = await this.findChangedServiceIds(timeScopeSeconds)
        const results = await Promise.all(
            serviceIds.map(async (serviceId) => {
                try {
                    await this.restartService(serviceId)
                    return { serviceId, ok: true }
                } catch (e) {
                    return { serviceId, ok: false, error: e?.message || String(e) }
                }
            })
        )
        if (prune && serviceIds.length) await this.pruneDocker()
        return results
    }

    /** Mirror the role's final `docker_prune` (all unused images, not just dangling). */
    async pruneDocker() {
        const response = await this.sshService.exec('docker system prune -af --volumes', true, {
            timeoutMs: SSHService.PLAYBOOK_TIMEOUT_MS,
        })
        if (response.rc !== 0 && response.rc !== null) throw new Error(response.stderr || 'docker prune failed')
        return response.stdout
    }

    /**
     * Stream `docker logs -f` for a service. Returns a handle with .abort().
     * @param {string} serviceId
     * @param {{ tail?: number, onLine: (line: string) => void, onClose?: (info: { rc?: number, error?: Error }) => void }} opts
     */
    async streamServiceLogs(serviceId, { tail = 200, onLine, onClose, onError } = {}) {
        const safeTail = Number.isFinite(tail) && tail > 0 ? Math.floor(tail) : 200
        const cmd = `docker logs -f --tail ${safeTail} stereum-${serviceId}`
        return this.sshService.execStream(cmd, { onLine, onClose, onError })
    }

    async fetchControlsCommit() {
        if (!this.settings) await this.fetchSettings()
        const controlsPath = this.settings?.stereum_settings?.settings?.controls_install_path
        if (!controlsPath) throw new Error('controls_install_path not found in stereum settings')
        const response = await this.sshService.exec(
            `git -C ${controlsPath}/ansible rev-parse HEAD 2>/dev/null || git -C ${controlsPath} rev-parse HEAD 2>/dev/null`
        )
        if (response.rc !== 0 && response.rc !== null) throw new Error(response.stderr || 'fetchControlsCommit failed')
        const commit = response.stdout.trim()
        if (!commit) throw new Error('controls commit not found (not a git checkout?)')
        return commit
    }

    /**
     * OS distro + version string (e.g. "Ubuntu 22.04.3 LTS") from `/etc/os-release` PRETTY_NAME, NAME+VERSION fallback.
     */
    async fetchOsInfo() {
        // No sudo: os-release is world-readable and `.` is a shell builtin sudo can't invoke.
        const response = await this.sshService.exec(
            '. /etc/os-release 2>/dev/null && echo "${PRETTY_NAME:-$NAME $VERSION}"',
            false
        )
        if (response.rc !== 0 && response.rc !== null) throw new Error(response.stderr || 'fetchOsInfo failed')
        const os = response.stdout.trim()
        if (!os) throw new Error('OS info not found (/etc/os-release missing?)')
        return os
    }

    /**
     * Host system metrics in a single cheap SSH exec - safe to poll. See `metrics.js`.
     */
    async fetchSystemMetrics() {
        // Do NOT wrap in `sh -c '...'` - the command contains single quotes.
        const response = await this.sshService.exec(SYSTEM_METRICS_CMD, false)
        if (response.rc !== 0 && response.rc !== null) throw new Error(response.stderr || 'fetchSystemMetrics failed')
        return parseSystemMetrics(response.stdout)
    }

    /**
     * Sync/peer health for all running EL/CL clients via one curl sidecar on the stereum
     * network (internal API ports, no host publishing). Failed probes carry `error`, never dropped.
     * @returns {Promise<{ [serviceId:string]: object }>}
     */
    async fetchClientMetrics() {
        // Configs are static - only (re)read when missing; container state stays fresh per poll.
        if (!this.services?.length) await this.fetchServices()
        if (this.services.some(s => !s.config)) await this.fetchServiceConfigs()
        const containerStatuses = await this.fetchContainerStatuses()
        const services = this.services.map(s => ({ ...s, container: containerStatuses[s.id] ?? null }))
        // Prefer Prometheus for beacon sync (wall-clock target slot); beacon API is the fallback.
        const prometheus = services.find(s => s.config?.service === PROMETHEUS_SERVICE && s.container?.state === 'running')
        const promHost = prometheus ? `stereum-${prometheus.id}:${PROMETHEUS_PORT}` : null
        const script = buildClientProbeScript(services, { promHost })
        if (!script) return {}
        const escaped = script.replace(/'/g, `'"'"'`)
        const cmd = `docker run --rm --network ${STEREUM_DOCKER_NETWORK} --entrypoint sh ${CURL_IMAGE} -c '${escaped}'`
        const response = await this.sshService.exec(cmd, true)
        if (response.rc !== 0 && response.rc !== null) throw new Error(response.stderr || 'fetchClientMetrics failed')
        return parseClientMetrics(response.stdout, services)
    }

    /**
     * Per-service disk usage (`du` over host volume paths). Heavy - slow cadence only,
     * generous timeout since a cold `du` on chain data is slow.
     */
    async fetchDiskBreakdown() {
        if (!this.settings) await this.fetchSettings()
        if (!this.services?.length) await this.fetchServices()
        if (this.services.some(s => !s.config)) await this.fetchServiceConfigs()
        const dfTarget = this.settings?.stereum_settings?.settings?.controls_install_path || '/'
        const cmd = buildDiskBreakdownCommand(this.services, dfTarget)
        const response = await this.sshService.exec(cmd, true, { timeoutMs: 120_000 })
        if (response.rc !== 0 && response.rc !== null) throw new Error(response.stderr || 'fetchDiskBreakdown failed')
        return parseDiskBreakdown(response.stdout, this.services)
    }

    async fetchUpgradablePackages() {
        const response = await this.sshService.exec("apt list --upgradable 2>/dev/null | tail -n +2")
        if (response.rc !== 0 && response.rc !== null) {
            throw new Error(response.stderr || 'fetchUpgradablePackages failed')
        }
        const pkgs = []
        for (const line of response.stdout.split('\n')) {
            const m = line.match(/^([^/\s]+)\/\S+\s+(\S+)\s+\S+\s+\[upgradable from:\s*([^\]]+)\]/)
            if (m) pkgs.push({ name: m[1], newVersion: m[2], currentVersion: m[3].trim() })
        }
        return pkgs
    }

    async updateOS() {
        return this.runPlaybook('update-os', { only_os_updates: true })
    }

    async updatePackage(name) {
        return this.runPlaybook('update-package', { update_package: { name } })
    }

    /**
     * `update-services` role, no restart. Top-level `services_to_update`: single id as a
     * bare string, multiple as an array, none = all services.
     */
    async _runServicesUpdate(serviceIds = null) {
        const topLevel = serviceIds?.length
            ? { services_to_update: serviceIds.length === 1 ? serviceIds[0] : serviceIds }
            : {}
        return this.runPlaybook('update-services', {}, topLevel)
    }

    /**
     * Update service images + restart changed services (without the restart the running container keeps the old image).
     * @param {string[]|null} serviceIds - ids to update; all services when null/empty
     * @param {{ prune?: boolean }} [opts]
     * @returns {Promise<{ serviceId: string, ok: boolean, error?: string }[]>} restarted services
     */
    async updateServices(serviceIds = null, { prune = true } = {}) {
        const before = this._timestamp()
        await this._runServicesUpdate(serviceIds)
        const elapsed = this._timestamp() - before
        return this.restartChangedServices(elapsed + 10, { prune })
    }

    /**
     * `update-stereum` then `update-changes` (config migrations), no restart - the caller restarts.
     * @param {string|null} commit - optional target commit (override_gitcommit); latest when null
     */
    async _runStereumUpdate(commit = null) {
        await this.runPlaybook('update-stereum', commit ? { override_gitcommit: commit } : {})
        await this.runPlaybook('update-changes')
    }

    /**
     * Update controls + restart changed services (without the restart, `update-changes` migrations wouldn't take effect).
     * @param {string|null} commit - optional target stereum commit
     * @param {{ prune?: boolean }} [opts]
     * @returns {Promise<{ serviceId: string, ok: boolean, error?: string }[]>} restarted services
     */
    async updateStereum(commit = null, { prune = true } = {}) {
        const before = this._timestamp()
        await this._runStereumUpdate(commit)
        const elapsed = this._timestamp() - before
        return this.restartChangedServices(elapsed + 10, { prune })
    }

    /** Current unix timestamp in seconds (rounded up), matching the launcher's getTimeStamp. */
    _timestamp() {
        return Math.ceil(Date.now() / 1000)
    }

    /**
     * Controls + image updates, no restart (runFullUpdate restarts once over the whole window). Mirrors the launcher's NodeUpdates.runAllUpdates.
     * @param {string|null} commit - optional target stereum commit
     * @returns {Promise<number>} elapsed seconds
     */
    async runAllUpdates(commit = null) {
        const before = this._timestamp()
        await this._runStereumUpdate(commit)
        await this._runServicesUpdate()
        return this._timestamp() - before
    }

    /**
     * Full update cycle, then restart services changed in the window + 10s (launcher's `restart_time_scope = seconds + 10`).
     * @param {string|null} commit - optional target stereum commit
     * @param {{ prune?: boolean }} [opts]
     * @returns {Promise<{ elapsed: number, restarted: { serviceId: string, ok: boolean, error?: string }[] }>}
     */
    async runFullUpdate(commit = null, { prune = true } = {}) {
        const elapsed = await this.runAllUpdates(commit)
        const restarted = await this.restartChangedServices(elapsed + 10, { prune })
        return { elapsed, restarted }
    }

    /** Sub-task group heading for a playbook run; state + short id keeps parallel restarts distinguishable. */
    _playbookLabel(role, stereumArgs = {}) {
        if (role === 'manage-service') {
            const svc = stereumArgs.manage_service || {}
            const verb = { started: 'Start', stopped: 'Stop', restarted: 'Restart' }[svc.state] || 'Manage'
            const id = svc.configuration?.id
            return id ? `${verb} service, ${id.slice(0, 8)}` : `${verb} service`
        }
        if (role === 'update-package') return `Update package, ${stereumArgs.update_package?.name || ''}`.trim()
        return {
            'update-services': 'Update services',
            'update-stereum': 'Update controls',
            'update-changes': 'Apply config migrations',
            'update-os': 'Update OS',
            'configure-updates': 'Apply update schedule',
        }[role] || role
    }

    async runPlaybook(role, stereumArgs = {}, topLevelVars = {}) {
        if (!this.settings) await this.fetchSettings()

        const controlsPath = this.settings?.stereum_settings?.settings?.controls_install_path
        if (!controlsPath) throw new Error('controls_install_path not found in stereum settings')

        const payload = { stereum_role: role, ...topLevelVars }
        if (Object.keys(stereumArgs).length) payload.stereum_args = stereumArgs
        const vars = JSON.stringify(payload)
        const escaped = vars.replace(/'/g, `'"'"'`)
        // stereumjson writes its per-task records to a file under ANSIBLE_LOG_FOLDER, NOT stdout - give each run its own folder.
        const logFolder = `/tmp/stereum-lite-${randomUUID()}`
        const command = `ANSIBLE_LOAD_CALLBACK_PLUGINS=1 ANSIBLE_STDOUT_CALLBACK=stereumjson ANSIBLE_DEPRECATION_WARNINGS=false ANSIBLE_LOG_FOLDER=${logFolder} ansible-playbook --connection=local --inventory 127.0.0.1, --extra-vars '${escaped}' ${controlsPath}/ansible/controls/genericPlaybook.yaml`

        // Inside a task: stream sub-tasks live; each runPlaybook claims its own segment so composite ops accumulate in order.
        const reporter = taskContext.getStore()
        const segment = reporter ? reporter.begin(this._playbookLabel(role, stereumArgs, topLevelVars)) : null
        const stop = reporter ? this._pollPlaybookLog(logFolder, segment, reporter) : null

        let response
        try {
            response = await this.sshService.exec(command, true, { timeoutMs: SSHService.PLAYBOOK_TIMEOUT_MS })
        } finally {
            stop?.()
        }

        // Final log read + cleanup, even on failure so failed steps are captured. Folder is root-owned, so cat + rm share one sudo.
        response.log = await this._readPlaybookLog(logFolder, { cleanup: true })
        if (reporter) reporter.report(segment, parseSubTasks(response.log))

        if (response.rc !== null && response.rc !== 0) {
            const err = new Error(response.stderr || response.stdout || `Playbook '${role}' failed`)
            err.log = response.log
            err.stdout = response.stdout
            err.stderr = response.stderr
            throw err
        }
        return response
    }

    /** Poll a running playbook's log and stream parsed sub-tasks to the segment; returns stop(). */
    _pollPlaybookLog(logFolder, segment, reporter) {
        let active = true
        let timer = null
        const tick = async () => {
            if (!active) return
            const logText = await this._readPlaybookLog(logFolder, { cleanup: false })
            if (active && logText) reporter.report(segment, parseSubTasks(logText))
            if (active) timer = setTimeout(tick, PLAYBOOK_POLL_MS)
        }
        timer = setTimeout(tick, PLAYBOOK_POLL_MS)
        return () => { active = false; if (timer) clearTimeout(timer) }
    }

    /** Read the stereumjson per-host log file(s) from a run's ANSIBLE_LOG_FOLDER; optionally remove the folder. */
    async _readPlaybookLog(logFolder, { cleanup = true } = {}) {
        try {
            const rm = cleanup ? `; rm -rf ${logFolder}` : ''
            const res = await this.sshService.exec(`sh -c 'cat ${logFolder}/* 2>/dev/null${rm}'`, true)
            return res.stdout || ''
        } catch (e) {
            log.warn('runPlaybook: could not read playbook log:', e?.message || e)
            return ''
        }
    }

    disconnect() {
        this.sshService.disconnect()
    }

    async reconnect() {
        return this.sshService.reconnect()
    }

    async fetchServiceConfigs() {
        if (!this.services || this.services.length === 0) {
            await this.fetchServices();
        }
        await Promise.all(this.services.map(async (service) => {
            const response = await this.sshService.exec(`cat /etc/stereum/services/${service.id}.yaml`);
            if (response.rc !== 0) throw new Error(response.stderr || `fetchServiceConfig failed for ${service.id}`);
            service.config = YAML.parse(response.stdout);
        }));
        return this.services;
    }
}