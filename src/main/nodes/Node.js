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

    async updateServices(serviceIds = null) {
        const topLevel = serviceIds?.length
            ? { services_to_update: serviceIds.length === 1 ? serviceIds[0] : serviceIds }
            : {}
        return this.runPlaybook('update-services', {}, topLevel)
    }

    async updateStereum() {
        return this.runPlaybook('update-stereum')
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

        const response = await this.sshService.exec(command, true)
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