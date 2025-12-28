<template>
    <div class="ssh-server-list-container">
        <div class="ssh-server-list">
            <div class="ssh-server" v-for="server in server" :key="server.name" @click="setCredentials(server)">
                <span class="ssh-server-name">{{ server.name }}</span>
                <span class="ssh-server-host">{{ server.host }}</span>
            </div> 
        </div>
    </div>
</template>
<script setup>
import { onMounted, ref} from 'vue'
import { storeToRefs } from 'pinia'
import { useServerStore } from '@stores/useServer';

const store = useServerStore()

const { server } = storeToRefs(store)
const { getServer, setCredentials } = store

async function loadserver() {
    await getServer()
}

onMounted(() => {
    console.log('SSHServerList.vue mounted')
    loadserver()
})
</script>
<style scoped>
.ssh-server-list-container {
    display: flex;
    flex-direction: column;
    height: 100%;
    width: 100%;
    background-color: #a1a6b4;
    padding: 20px;
    border-radius: 20px;
}
.ssh-server-list {
    background-color: #fefefe;
    border-radius: 10px;
    scrollbar-gutter: stable both-edges;
    overflow: auto;
}
.ssh-server {
    display: flex;
    flex-direction: column;
    margin: 10px;
    padding: 5px;
    border-radius: 5px;
    background-color: #b4d2e7;
    cursor: pointer;
}
</style>