import { SSHService, SSHParams } from "@main/ssh/SSHService";
import YAML from 'yaml';
import { randomUUID } from "crypto";
import log from 'electron-log';

/**
 * Represents a remote node managed via SSH
 */

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
     * Convert the node to a Data Transfer Object (DTO) for listing purposes
     * @returns A lightweight representation of the node for listing purposes
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
        const containerStatuses = await this.fetchContainerStatuses();
        return {
            id: this.id,
            name: this.sshService.SSHParams.name,
            host: this.sshService.SSHParams.host,
            port: this.sshService.SSHParams.port,
            username: this.sshService.SSHParams.username,
            status: this.status,
            settings: this.settings,
            services: this.services.map(s => ({
                ...s,
                container: containerStatuses[s.id] ?? null,
            })),
        }
    }

    /**
     * Fetch the settings for the node
     * @param {Boolean} refresh - whether to force refresh the settings from the node (default: false)
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
     * Fetch the services for the node
     * @param {Boolean} refresh - whether to force refresh the services from the node (default: false)
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

    async writeServiceConfig(serviceId, content) {
        const b64 = Buffer.from(content).toString('base64')
        const path = `/etc/stereum/services/${serviceId}.yaml`
        const response = await this.sshService.exec(`echo '${b64}' | base64 -d | sudo tee ${path} > /dev/null`, false)
        if (response.rc !== 0) throw new Error(response.stderr || `writeServiceConfig failed for ${serviceId}`)
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
     * Find the service config files under /etc/stereum/services that were modified
     * within the last `timeScopeSeconds` seconds and return their service ids
     * (the filename stem is the UUID — same convention as fetchServices).
     * Mirrors the selection logic of the upstream `restart-services` Ansible role.
     * @param {number} timeScopeSeconds
     * @returns {Promise<string[]>} ids of changed services
     */
    async findChangedServiceIds(timeScopeSeconds) {
        const scope = Math.floor(Number(timeScopeSeconds))
        if (!Number.isFinite(scope) || scope <= 0) throw new Error('timeScopeSeconds must be a positive number')
        // GNU find on the remote: files newer than (now - scope). "-printf '%f'" yields the bare filename.
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
     * Restart every service whose config changed within the last `timeScopeSeconds`
     * seconds. Same behaviour as the upstream `restart-services` role, but the
     * restarts run in parallel instead of one after another.
     * @param {number} timeScopeSeconds - lookback window in seconds
     * @param {{ prune?: boolean }} [opts] - run a `docker system prune` afterwards (default true, mirrors the role)
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

    /**
     * Mirror the role's final `docker_prune`: remove all unused containers, images
     * (not just dangling), networks, volumes, and build cache.
     */
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
        return this.runPlaybook('update-os')
    }

    async updatePackage(name) {
        return this.runPlaybook('update-package', { update_package: { name } })
    }

    /**
     * Run the `update-services` role without restarting. A single id is forwarded as a
     * bare string, multiple ids as an array (top-level `services_to_update`); no ids
     * updates all services. Pure — the caller decides when to restart.
     */
    async _runServicesUpdate(serviceIds = null) {
        const topLevel = serviceIds?.length
            ? { services_to_update: serviceIds.length === 1 ? serviceIds[0] : serviceIds }
            : {}
        return this.runPlaybook('update-services', {}, topLevel)
    }

    /**
     * Update service images and restart every service whose config changed as a result,
     * in parallel. Standalone entry point for the per-service / "update all" actions —
     * without the restart the new image is pulled but the running container keeps the old one.
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
     * Run the stereum control-update playbooks without restarting anything:
     * `update-stereum` (optionally pinned to a commit) followed by `update-changes`,
     * which applies the config migrations the new controls ship. Pure — the caller
     * decides when to restart the affected services.
     * @param {string|null} commit - optional target commit (override_gitcommit); latest when null
     */
    async _runStereumUpdate(commit = null) {
        await this.runPlaybook('update-stereum', commit ? { override_gitcommit: commit } : {})
        await this.runPlaybook('update-changes')
    }

    /**
     * Update the stereum controls and restart every service whose config changed as a
     * result (e.g. by `update-changes`), in parallel. This is the standalone entry point
     * the "Update Node Controls" action uses — without the restart, the config migrations
     * `update-changes` applies would not take effect until the next manual restart.
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
     * Run the full update sequence (stereum controls + service images) and return how
     * many seconds it took. Mirrors the launcher's NodeUpdates.runAllUpdates. No restart
     * happens here — that's done once over the whole window by runFullUpdate, so the
     * pure `_runStereumUpdate` is used to avoid restarting mid-sequence.
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
     * Full update cycle: run all updates, then restart every service whose config
     * changed during the update window (plus a 10s buffer, matching the launcher's
     * `restart_time_scope = seconds + 10`). Restarts run in parallel.
     * @param {string|null} commit - optional target stereum commit
     * @param {{ prune?: boolean }} [opts]
     * @returns {Promise<{ elapsed: number, restarted: { serviceId: string, ok: boolean, error?: string }[] }>}
     */
    async runFullUpdate(commit = null, { prune = true } = {}) {
        const elapsed = await this.runAllUpdates(commit)
        const restarted = await this.restartChangedServices(elapsed + 10, { prune })
        return { elapsed, restarted }
    }

    async runPlaybook(role, stereumArgs = {}, topLevelVars = {}) {
        if (!this.settings) await this.fetchSettings()

        const controlsPath = this.settings?.stereum_settings?.settings?.controls_install_path
        if (!controlsPath) throw new Error('controls_install_path not found in stereum settings')

        const payload = { stereum_role: role, ...topLevelVars }
        if (Object.keys(stereumArgs).length) payload.stereum_args = stereumArgs
        const vars = JSON.stringify(payload)
        const escaped = vars.replace(/'/g, `'"'"'`)
        const command = `ANSIBLE_LOAD_CALLBACK_PLUGINS=1 ANSIBLE_STDOUT_CALLBACK=stereumjson ANSIBLE_DEPRECATION_WARNINGS=false ansible-playbook --connection=local --inventory 127.0.0.1, --extra-vars '${escaped}' ${controlsPath}/ansible/controls/genericPlaybook.yaml`

        const response = await this.sshService.exec(command, true, { timeoutMs: SSHService.PLAYBOOK_TIMEOUT_MS })
        if (response.rc !== null && response.rc !== 0) throw new Error(response.stderr || response.stdout || `Playbook '${role}' failed`)
        return response
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