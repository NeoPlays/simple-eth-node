<template>
    <div class="node-manager">
        <div class="node-manager-list">
            <div class="node-manager-node" v-for="node in nodes">
                <span class="node-name">{{ node.name }}</span>
                <span class="node-host">{{ node.host }}</span>
            </div>
        </div>
        <button @click="router.push('/login')">Add Node Connection</button>
    </div>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import { useNodesStore } from '@stores/useNodes'
import { storeToRefs } from 'pinia'
import { useRouter } from 'vue-router'

const router = useRouter()

const store = useNodesStore()

const { nodes } = storeToRefs(store)
const { refreshNodes } = store

onMounted(async () => {
    console.log('NodeManager.vue mounted')
    refreshNodes()
    console.log(nodes.value)
})


</script>

<style scoped>
.node-manager {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
}
.node-manager button {
    position: absolute;
    top: 20px;
    right: 20px;
    padding: 10px 20px;
    background-color: #94C5CC;
    color: black;
    border: none;
    border-radius: 5px;
}
.node-manager button:hover {
    background-color: #7AA8AD;
    cursor: pointer;
}
.node-manager-list {
    display: flex;
    flex-direction: column;
    width: 80%;
    background-color: white;
}
.node-manager-node {
    display: flex;
    flex-direction: row;
    justify-content: space-between;
    padding: 10px;
    border-bottom: 1px solid #ccc;
}

</style>