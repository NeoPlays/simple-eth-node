<template>
    <div class="credentials-panel">
        <h2 class="panel-title">SSH Connection</h2>
        <div class="form">
            <div class="field" v-for="field in fields" :key="field.id">
                <label :for="field.id">{{ field.label }}</label>
                <input
                    :id="field.id"
                    :type="field.type ?? 'text'"
                    v-model="credentials[field.key]"
                    v-bind="field.modifiers ?? {}"
                    autocomplete="off"
                />
            </div>
        </div>

        <div v-if="connecting" class="connecting-overlay">
            <span class="connecting-spinner"></span>
            <span class="connecting-label">Connecting…</span>
        </div>

        <div v-if="loginError" class="error-banner">{{ loginError }}</div>

        <div class="actions">
            <button class="btn-primary" @click="login" :disabled="connecting">Connect</button>
            <div class="actions-row">
                <button class="btn-secondary" @click="save" :disabled="connecting">Save</button>
                <button class="btn-secondary" @click="importServer" :disabled="connecting">Import from Stereum</button>
            </div>
            <div class="actions-row">
                <button class="btn-ghost" @click="router.push('/')" :disabled="connecting">Back</button>
                <button class="btn-danger" @click="deleteServer" :disabled="connecting">Delete</button>
            </div>
        </div>
    </div>
</template>

<script setup>
import { ref } from 'vue'
import _ from 'lodash'
import { storeToRefs } from 'pinia'
import { useServerStore } from '@stores/useServer'
import { useRouter } from 'vue-router'

const router = useRouter()
const store = useServerStore()
const { server, credentials } = storeToRefs(store)
const { getServer, setServer } = store

const connecting = ref(false)
const loginError = ref('')

const fields = [
    { id: 'field-name',        label: 'Name',        key: 'name' },
    { id: 'field-host',        label: 'Host',        key: 'host' },
    { id: 'field-port',        label: 'Port',        key: 'port',       type: 'number' },
    { id: 'field-username',    label: 'Username',    key: 'username' },
    { id: 'field-password',    label: 'Password',    key: 'password',   type: 'password' },
    { id: 'field-private-key', label: 'Private Key', key: 'privateKey' },
    { id: 'field-passphrase',  label: 'Passphrase',  key: 'passphrase', type: 'password' },
]

async function importServer() {
    await setServer(await window.api.invoke('import-server-from-stereum'))
}

async function login() {
    connecting.value = true
    loginError.value = ''
    try {
        const result = await window.api.invoke('ssh-login', _.cloneDeep(credentials.value))
        if (result.code !== 0) {
            loginError.value = result.message || 'Connection failed'
            return
        }
        router.push('/')
    } catch {
        loginError.value = 'Unexpected error — check the logs'
    } finally {
        connecting.value = false
    }
}

async function save() {
    if (!credentials.value.name) {
        alert('Please enter a name for the server')
        return
    }
    const idx = server.value.findIndex(s => s.name === credentials.value.name)
    const copy = copyCredentials(credentials.value)
    if (idx === -1) {
        server.value.push(copy)
    } else {
        server.value[idx] = copy
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
    if (idx === -1) {
        alert('Server with this name does not exist')
        return
    }
    server.value.splice(idx, 1)
    await setServer(_.cloneDeep(server.value))
    await getServer()
}

function copyCredentials(creds) {
    const copy = _.cloneDeep(creds)
    delete copy.password
    delete copy.passphrase
    return copy
}
</script>

<style scoped>
.credentials-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    width: 100%;
    background-color: var(--color-background-soft);
    border-radius: 14px;
    padding: 20px;
    gap: 16px;
    overflow-y: auto;
}

.panel-title {
    font-size: 14px;
    font-weight: 600;
    color: var(--ev-c-text-2);
    text-transform: uppercase;
    letter-spacing: 0.05em;
}

.form {
    display: flex;
    flex-direction: column;
    gap: 10px;
}

.field {
    display: flex;
    flex-direction: column;
    gap: 4px;
}

.field label {
    font-size: 12px;
    font-weight: 500;
    color: var(--ev-c-text-2);
}

.field input {
    padding: 8px 10px;
    background-color: var(--color-background-mute);
    border: 1px solid var(--ev-c-gray-2);
    border-radius: 6px;
    color: var(--ev-c-text-1);
    font-size: 13px;
    outline: none;
    transition: border-color 150ms;
}

.field input:focus {
    border-color: #94C5CC;
}

.actions {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-top: auto;
}

.actions-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
}

button {
    padding: 9px 14px;
    border: none;
    border-radius: 8px;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: background-color 150ms;
}

.btn-primary {
    background-color: #94C5CC;
    color: #000;
    width: 100%;
}
.btn-primary:hover { background-color: #7AAEB5; }

.btn-secondary {
    background-color: var(--ev-c-gray-3);
    color: var(--ev-c-text-1);
}
.btn-secondary:hover { background-color: var(--ev-c-gray-2); }

.btn-ghost {
    background-color: transparent;
    color: var(--ev-c-text-2);
    border: 1px solid var(--ev-c-gray-2);
}
.btn-ghost:hover { background-color: var(--ev-c-gray-3); }

.btn-danger {
    background-color: transparent;
    color: #e06c75;
    border: 1px solid #e06c75;
}
.btn-danger:hover { background-color: rgba(224, 108, 117, 0.1); }

button:disabled {
    opacity: 0.4;
    cursor: default;
    pointer-events: none;
}

.error-banner {
    padding: 10px 12px;
    background-color: rgba(224, 108, 117, 0.1);
    border: 1px solid #e06c75;
    border-radius: 8px;
    color: #e06c75;
    font-size: 13px;
}

.connecting-overlay {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    padding: 12px;
    background-color: var(--color-background-mute);
    border-radius: 8px;
    border: 1px solid var(--ev-c-gray-2);
}

.connecting-label {
    font-size: 13px;
    color: var(--ev-c-text-2);
}

.connecting-spinner {
    width: 14px;
    height: 14px;
    border: 2px solid var(--ev-c-gray-2);
    border-top-color: #94C5CC;
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
}

@keyframes spin {
    to { transform: rotate(360deg); }
}
</style>
