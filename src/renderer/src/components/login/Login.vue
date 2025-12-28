<template>
    <div class="login-view">
        <SSHServerList />
        <SSHCredentials />
    </div>
</template>
<script setup>
import SSHCredentials from './SSHCredentials.vue';
import SSHServerList from './SSHServerList.vue';
</script>
<style scoped>
.login-view {
    display: flex;
    flex-direction: row;
    width: 100%;
    height: 100%;
    justify-content: center;
    align-items: center;
    padding: 10px;
    gap: 10px;
}
</style>