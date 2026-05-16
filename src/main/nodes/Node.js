import { SSHService, SSHParams } from "@main/ssh/SSHService";
import YAML from 'yaml';
import { randomUUID } from "crypto";

/**
 * Represents a remote node managed via SSH
 */

export class Node {

    constructor(sshCredentials) {
        this.id = randomUUID();
        this.sshService = new SSHService(new SSHParams(sshCredentials.host, sshCredentials.port, sshCredentials.username, sshCredentials.password, sshCredentials.privateKey, sshCredentials.passphrase));;
        this.settings = null;
        this.services = [];
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
        }
    }

    async toDTO(refresh = false){
        await this.fetchSettings(refresh);
        await this.fetchServices(refresh);
        await this.fetchServiceConfigs();
        return {
            id: this.id,
            name: this.sshService.SSHParams.name,
            host: this.sshService.SSHParams.host,
            port: this.sshService.SSHParams.port,
            username: this.sshService.SSHParams.username,
            settings: this.settings,
            services: this.services,
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

    disconnect() {
        this.sshService.disconnect()
    }

    async fetchServiceConfigs() {
        if (!this.services || this.services.length === 0) {
            await this.fetchServices();
        }
        for (const service of this.services) {
            const response = await this.sshService.exec(`cat /etc/stereum/services/${service.id}.yaml`);
            if (response.rc !== 0) throw new Error(response.stderr || `fetchServiceConfig failed for ${service.id}`);
            service.config = YAML.parse(response.stdout);
        }
        return this.services;
    }
}