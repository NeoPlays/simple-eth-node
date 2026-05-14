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
            const response = await this.sshService.exec("cat /etc/stereum/stereum.yaml");   //TODO: handle errors (non 0 exit code)
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
            const response = await this.sshService.exec("ls /etc/stereum/services");   //TODO: handle errors (non 0 exit code)
            const serviceIDs = response.stdout.split('\n').filter(s => s.trim() !== '').map(s => s.replace('.yaml', '').trim());
            this.services = serviceIDs.map(id => ({ id }));
        }
        return this.services;
    }

    async fetchServiceConfigs() {
        if (!this.services || this.services.length === 0) {
            await this.fetchServices();
        }
        for (const service of this.services) {
            const response = await this.sshService.exec(`cat /etc/stereum/services/${service.id}.yaml`);   //TODO: handle errors (non 0 exit code)
            service.config = YAML.parse(response.stdout);
        }
        return this.services;
    }
}