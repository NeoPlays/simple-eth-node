<template>
    <div class="ssh-form">
        <div class="ssh-credentials">
            <div class="ssh-credentials-row">
                <label for="ssh-credentials-name">Name</label>
                <input type="text" id="ssh-credentials-name" v-model.trim="credentials.name" />
            </div>
            <div class="ssh-credentials-row">
                <label for="ssh-credentials-host">Host</label>
                <input type="text" id="ssh-credentials-host" v-model.trim="credentials.host" />
            </div>
            <div class="ssh-credentials-row">
                <label for="ssh-credentials-port">Port</label>
                <input type="number" id="ssh-credentials-port" v-model.number="credentials.port" />
            </div>
            <div class="ssh-credentials-row">
                <label for="ssh-credentials-username">Username</label>
                <input type="text" id="ssh-credentials-username" v-model.trim="credentials.username" />
            </div>
            <div class="ssh-credentials-row">
                <label for="ssh-credentials-password">Password</label>
                <input type="password" id="ssh-credentials-password" v-model="credentials.password" />
            </div>
            <div class="ssh-credentials-row">
                <label for="ssh-credentials-private-key">Private Key</label>
                <input type="text" id="ssh-credentials-private-key" v-model.trim="credentials.privateKey" />
            </div>
            <div class="ssh-credentials-row">
                <label for="ssh-credentials-passphrase">Passphrase</label>
                <input type="password" id="ssh-credentials-passphrase" v-model="credentials.passphrase" />
            </div>
            <div class="ssh-credentials-row">
                <button class="ssh-login-button" @click="login">Login</button>
            </div>
            <div class="ssh-credentials-row">
                <button class="ssh-save-button" @click="save">Save</button>
            </div>
            <div class="ssh-credentials-row">
                <button class="ssh-save-button" @click="importServer">Import From Stereum</button>
            </div>
            <div class="ssh-credentials-row">
                <button class="ssh-save-button" @click="deleteServer">Delete</button>
            </div>
            <div class="ssh-credentials-row">
                <button class="ssh-save-button" @click="router.push('/')">Back</button>
            </div>
        </div>
    </div>
</template>
<script setup>
import { onMounted, ref } from 'vue'
import _ from 'lodash'
import { storeToRefs } from 'pinia'
import { useServerStore } from '@stores/useServer';
import { useRouter } from 'vue-router'

const router = useRouter()

const store = useServerStore()

const { server, credentials } = storeToRefs(store)
const { getServer, setServer } = store

const emit = defineEmits(['login'])

async function importServer() {
    await setServer(await window.api.invoke('import-server-from-stereum'))
}

async function login() {
    await window.api.invoke('ssh-login', _.cloneDeep(credentials.value))
    router.push('/')
}

async function save() {
    if (!credentials.value.name) {
        alert('Please enter a name for the server')
        return
    }
    const idx = server.value.findIndex(s => s.name === credentials.value.name)

    if (idx === -1) {   // If server with the same name does not exist, add it
        server.value.push(copyCredentials(credentials.value))
    } else {    // Otherwise update existing server
        server.value[server.value.findIndex(s => s.name === credentials.value.name)] = copyCredentials(credentials.value)
    }

    await setServer(_.cloneDeep(server.value))
    await getServer()
}

async function deleteServer() {
    if (!credentials.value.name) {
        alert('Please enter a name for the server')
        return
    }
    const idx = server.value.findIndex(s => s.name === credentials.value.name)

    if (idx === -1) {   // If server with the same name does not exist, alert user
        alert('Server with this name does not exist')
        return
    } else {    // Otherwise delete existing server
        server.value.splice(idx, 1)
    }

    await setServer(_.cloneDeep(server.value))
    await getServer()
}

function copyCredentials(creds) {
    const copy = _.cloneDeep(creds)
    delete copy.password
    delete copy.passphrase
    return copy
}

onMounted(() => {
    console.log('SSHLogin.vue mounted')
})
</script>
<style scoped>

.ssh-form {
    display: flex;
    height: 100%;
    width: 100%;
    background-color: #a1a6b4;
    border-radius: 20px;
    padding: 20px;
    overflow: auto;
}

.ssh-credentials {
    display: flex;
    flex-direction: column;
    gap: 10px;
}

.ssh-credentials-row {
    display: flex;
    flex-direction: row;
    justify-content: space-between;
    gap: 10px;
}

.ssh-credentials-row input {
    border: none;
    border-radius: 5px;
    padding: 5px;
}

.ssh-credentials-row label {}

.ssh-login-button {}
</style>
