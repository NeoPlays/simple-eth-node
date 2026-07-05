<template>
    <main class="base-container">
        <header class="app-header">
            <span class="brand">Stereum Lite</span>
            <div class="header-actions">
                <button class="header-action" @click="tasksOpen = true" title="Tasks">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M9 11l3 3L22 4"/>
                        <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
                    </svg>
                    <span v-if="tasks.runningCount" class="badge">{{ tasks.runningCount }}</span>
                </button>
                <button class="header-action" @click="settingsOpen = true" title="Settings">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <circle cx="12" cy="12" r="3"/>
                        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
                    </svg>
                </button>
            </div>
        </header>

        <div class="app-main">
            <RouterView />
        </div>

        <TaskPanel v-if="tasksOpen" @close="tasksOpen = false" />
        <SettingsPanel v-if="settingsOpen" @close="settingsOpen = false" />
    </main>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import { useThemeStore } from '@stores/useTheme'
import { useTasksStore } from '@stores/useTasks'
import SettingsPanel from '@components/SettingsPanel.vue'
import TaskPanel from '@components/TaskPanel.vue'

const theme = useThemeStore()
const tasks = useTasksStore()
const settingsOpen = ref(false)
const tasksOpen = ref(false)
// Hydrate + subscribe up front so the running-count badge is live before the panel opens.
onMounted(() => {
    theme.init()
    tasks.refreshTasks()
})
</script>

<style scoped>
.base-container {
    display: flex;
    flex-direction: column;
    height: 100vh;
    width: 100vw;
    background-color: var(--color-background);
    color: var(--color-text);
}

.app-header {
    flex-shrink: 0;
    height: 40px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 16px;
    background-color: var(--color-background);
    border-bottom: 1px solid var(--ev-c-gray-3);
    z-index: 50;
}

.brand {
    font-size: var(--font-size-secondary);
    font-weight: var(--font-weight-semibold);
    color: var(--ev-c-text-2);
    letter-spacing: 0.03em;
}

.header-actions {
    display: flex;
    align-items: center;
    gap: var(--space-1);
}

.header-action {
    position: relative;
    width: 28px;
    height: 28px;
    border-radius: var(--radius-md);
    background-color: transparent;
    color: var(--ev-c-text-3);
    border: none;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: color var(--transition-fast), background-color var(--transition-fast);
}
.header-action:hover {
    color: var(--ev-c-text-1);
    background-color: var(--ev-c-gray-3);
}

.badge {
    position: absolute;
    top: -2px;
    right: -2px;
    min-width: 14px;
    height: 14px;
    padding: 0 3px;
    border-radius: 7px;
    background-color: var(--color-warning);
    color: var(--color-accent-text);
    font-size: var(--font-size-micro);
    font-weight: var(--font-weight-medium);
    display: flex;
    align-items: center;
    justify-content: center;
}

.app-main {
    flex: 1 1 0;
    min-height: 0;
    min-width: 0;
    display: flex;
}
.app-main > * {
    flex: 1 1 auto;
    min-height: 0;
    width: 100%;
}
</style>
