import { defineStore } from 'pinia'
import _ from 'lodash'

export const useServerStore = defineStore('server', {
    state: () => ({
        server: [],
        credentials: {
            name: '',
            host: '',
            port: 22,
            username: '',
            password: '',
            privateKey: '',
            passphrase: ''
        },
    }),
    getters: {},
    actions: {
        async getServer() {
            return this.server = await window.api.invoke('store-get', 'server');
        },
        async setServer(server) {
            await window.api.invoke('store-set', 'server', server)
            await this.getServer()
        },
        setCredentials(credentials) {
            this.credentials = _.cloneDeep(credentials);
        },
        clearCredentials() {
            this.credentials = {
                name: '',
                host: '',
                port: 22,
                username: '',
                password: '',
                privateKey: '',
                passphrase: ''
            };
        }
    }
})