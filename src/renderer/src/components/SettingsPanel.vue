<template>
    <div class="panel-overlay" @click.self="$emit('close')">
        <aside class="panel">
            <header class="panel-header">
                <h2>Settings</h2>
                <button class="btn-ghost" @click="$emit('close')">✕</button>
            </header>

            <section class="panel-section">
                <h3>Appearance</h3>
                <div class="row">
                    <span class="label">Theme</span>
                    <div class="segmented">
                        <button :class="{ active: theme.theme === 'dark' }" @click="theme.set('dark')">☾ Dark</button>
                        <button :class="{ active: theme.theme === 'light' }" @click="theme.set('light')">☀ Light</button>
                    </div>
                </div>
            </section>
        </aside>
    </div>
</template>

<script setup>
import { useThemeStore } from '@stores/useTheme'
defineEmits(['close'])
const theme = useThemeStore()
</script>

<style scoped>
.panel-overlay {
    position: fixed;
    inset: 0;
    background-color: rgba(0, 0, 0, 0.4);
    z-index: 200;
    display: flex;
    justify-content: flex-end;
}

.panel {
    width: 360px;
    max-width: 100vw;
    height: 100%;
    background-color: var(--color-background);
    border-left: 1px solid var(--ev-c-gray-3);
    display: flex;
    flex-direction: column;
    padding: 20px 24px;
    gap: 20px;
    animation: slidein 180ms ease-out;
    overflow-y: auto;
}
@keyframes slidein {
    from { transform: translateX(20px); opacity: 0.5; }
    to { transform: translateX(0); opacity: 1; }
}

.panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
}
.panel-header h2 {
    font-size: var(--font-size-title);
    font-weight: var(--font-weight-semibold);
    color: var(--ev-c-text-1);
}

.panel-section {
    display: flex;
    flex-direction: column;
    gap: 10px;
}
.panel-section h3 {
    font-size: var(--font-size-button);
    font-weight: var(--font-weight-semibold);
    color: var(--ev-c-text-2);
    text-transform: uppercase;
    letter-spacing: 0.05em;
}

.row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--card-padding);
    background-color: var(--color-background-soft);
    border-radius: var(--radius-xl);
}
.label {
    font-size: var(--font-size-title);
    font-weight: var(--font-weight-semibold);
    color: var(--ev-c-text-1);
}

.segmented {
    display: flex;
    background-color: var(--color-background-mute);
    border-radius: var(--radius-md);
    padding: 2px;
    gap: 2px;
}
.segmented button {
    padding: var(--button-padding-small);
    background-color: transparent;
    color: var(--ev-c-text-2);
    border: none;
    border-radius: var(--radius-sm);
    cursor: pointer;
    font-size: var(--font-size-secondary);
    transition: background-color var(--transition-fast), color var(--transition-fast);
}
.segmented button:hover { color: var(--ev-c-text-1); }
.segmented button.active {
    background-color: var(--color-background);
    color: var(--ev-c-text-1);
}

.btn-ghost {
    padding: 4px 10px;
    background-color: transparent;
    color: var(--ev-c-text-2);
    border: 1px solid var(--ev-c-gray-2);
    border-radius: var(--radius-md);
    cursor: pointer;
    font-size: var(--font-size-secondary);
}
.btn-ghost:hover { background-color: var(--ev-c-gray-3); }
</style>
