<template>
    <div class="login-layout">
        <SSHServerList class="panel panel--list" />
        <SSHCredentials class="panel panel--form" />
    </div>
</template>

<script setup>
import SSHCredentials from './SSHCredentials.vue'
import SSHServerList from './SSHServerList.vue'
</script>

<style scoped>
.login-layout {
    display: grid;
    grid-template-columns: 1fr 1.6fr;
    grid-template-rows: minmax(0, 1fr);
    width: 100%;
    height: 100%;
    padding: 24px;
    gap: 16px;
}

.panel {
    min-height: 0;
}
</style>
