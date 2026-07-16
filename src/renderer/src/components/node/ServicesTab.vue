<template>
    <section class="section">
        <div v-if="services?.length === 0" class="state-message">No services found.</div>
        <div class="service-list">
            <div class="service-card" v-for="service in services" :key="service.id">
                <div class="service-main">
                    <span class="service-name">{{ service.config?.service ?? service.id }}</span>
                    <span class="service-network" v-if="service.config?.network">{{ service.config.network }}</span>
                    <span v-if="service.container" class="container-status" :class="service.container.state">
                        <span class="status-dot"></span>{{ service.container.status }}
                    </span>
                    <span v-else class="container-status unknown">
                        <span class="status-dot"></span>unknown
                    </span>
                </div>
                <div class="service-actions">
                    <button
                        class="btn-service-action"
                        :class="isRunning(service) ? 'btn-stop' : 'btn-start'"
                        @click="emit('toggle', service)"
                        :disabled="pending.has(service.id)"
                    >
                        {{ pending.has(service.id) ? '…' : isRunning(service) ? 'Stop' : 'Start' }}
                    </button>
                    <button
                        v-if="isRunning(service)"
                        class="btn-service-action btn-restart"
                        @click="emit('restart', service)"
                        :disabled="pending.has(service.id)"
                    >
                        {{ pending.has(service.id) ? '…' : 'Restart' }}
                    </button>
                    <button class="btn-edit" @click="emit('logs', service.id)" :disabled="pending.has(service.id)">Logs</button>
                    <button class="btn-edit" @click="emit('edit', service.id)" :disabled="pending.has(service.id)">Edit</button>
                </div>
                <span class="service-image">
                    <span class="image-label">config</span>{{ service.config?.image ?? '-' }}
                </span>
                <span v-if="service.container?.image" class="service-image">
                    <span class="image-label">running</span>{{ service.container.image }}
                </span>
                <span class="service-id">{{ service.id }}</span>
            </div>
        </div>
    </section>
</template>

<script setup>
defineProps({
    services: { type: Array, default: () => [] },
    pending: { type: Object, default: () => new Set() }, // reactive Set of in-flight service ids
})
const emit = defineEmits(['toggle', 'restart', 'logs', 'edit'])

function isRunning(service) {
    return service.container?.state === 'running' || service.container?.state === 'restarting'
}
</script>

<style scoped>
.service-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
}

.service-card {
    display: grid;
    grid-template-columns: 1fr auto;
    grid-template-rows: auto auto;
    align-items: center;
    padding: var(--card-padding);
    background-color: var(--color-background-soft);
    border-radius: var(--radius-xl);
    gap: var(--space-1) var(--space-3);
}

.service-main {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    grid-column: 1;
    grid-row: 1;
}

.service-name {
    font-size: var(--font-size-title);
    font-weight: var(--font-weight-semibold);
    color: var(--ev-c-text-1);
}

.service-network {
    font-size: var(--font-size-meta);
    padding: var(--chip-padding);
    border-radius: var(--radius-sm);
    background-color: var(--color-accent-soft);
    color: var(--color-accent);
    font-weight: var(--font-weight-medium);
}

.service-actions {
    grid-column: 2;
    grid-row: 1;
    display: flex;
    gap: var(--space-2);
    align-items: center;
}

.btn-service-action {
    padding: var(--button-padding-small);
    border-radius: var(--radius-md);
    cursor: pointer;
    font-size: var(--font-size-secondary);
    font-weight: var(--font-weight-medium);
    border: 1px solid;
    transition: background-color var(--transition-fast), opacity var(--transition-fast);
    white-space: nowrap;
    min-width: 44px;
}
.btn-service-action:disabled { opacity: 0.4; cursor: default; }

.btn-start {
    background-color: transparent;
    color: var(--color-success);
    border-color: var(--color-success);
}
.btn-start:hover:not(:disabled) { background-color: var(--color-success-soft); }

.btn-stop {
    background-color: transparent;
    color: var(--color-danger);
    border-color: var(--color-danger);
}
.btn-stop:hover:not(:disabled) { background-color: var(--color-danger-soft); }

.btn-restart {
    background-color: transparent;
    color: var(--color-warning);
    border-color: var(--color-warning);
}
.btn-restart:hover:not(:disabled) { background-color: var(--color-warning-soft); }

.btn-edit {
    padding: var(--button-padding-small);
    background-color: transparent;
    color: var(--ev-c-text-2);
    border: 1px solid var(--ev-c-gray-2);
    border-radius: var(--radius-md);
    cursor: pointer;
    font-size: var(--font-size-secondary);
    transition: background-color var(--transition-fast), border-color var(--transition-fast);
    white-space: nowrap;
}
.btn-edit:hover:not(:disabled) { background-color: var(--ev-c-gray-3); border-color: var(--ev-c-gray-1); }
.btn-edit:disabled { opacity: 0.4; cursor: default; }

.container-status {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: var(--font-size-secondary);
    color: var(--ev-c-text-2);
}
.status-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    flex-shrink: 0;
    background-color: var(--ev-c-gray-1);
}
.container-status.running .status-dot { background-color: var(--color-success); }
.container-status.exited .status-dot,
.container-status.dead .status-dot  { background-color: var(--color-danger); }
.container-status.paused .status-dot,
.container-status.restarting .status-dot { background-color: var(--color-warning); }

.service-image {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--font-size-secondary);
    color: var(--ev-c-text-2);
    font-family: var(--font-mono);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    grid-column: 1;
}

.image-label {
    font-family: var(--font-sans);
    font-size: var(--font-size-micro);
    color: var(--ev-c-text-3);
    background-color: var(--ev-c-gray-3);
    padding: 1px 5px;
    border-radius: 3px;
    flex-shrink: 0;
}

.service-id {
    font-size: var(--font-size-meta);
    color: var(--ev-c-text-3);
    font-family: var(--font-mono);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    grid-column: 1 / -1;
}

.state-message {
    color: var(--ev-c-text-2);
    font-size: var(--font-size-body);
    text-align: center;
    padding: var(--space-9);
}
</style>
