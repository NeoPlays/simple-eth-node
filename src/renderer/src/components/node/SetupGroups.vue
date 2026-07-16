<template>
    <div class="setup-groups">
        <section class="setup-group" v-for="group in groups" :key="group.key">
            <div class="setup-head" v-if="group.setup">
                <span class="setup-name">{{ group.setup.name }}</span>
                <span v-if="group.setup.type === 'common'" class="setup-tag common">common</span>
                <span v-else-if="group.setup.network" class="setup-tag network">{{ group.setup.network }}</span>
            </div>
            <div
                class="category"
                :class="{ railed: group.categories.length > 1 }"
                :style="group.categories.length > 1 ? { '--cat-color': CATEGORY_COLOR[cat.key] } : null"
                v-for="cat in group.categories"
                :key="cat.key"
            >
                <div class="category-head" v-if="group.categories.length > 1">
                    <span class="cat-dot"></span>{{ cat.label }}
                </div>
                <div class="group-items">
                    <!-- Each tab supplies its own per-service rendering (card / metric row / update row). -->
                    <slot v-for="service in cat.services" :key="service.id" :service="service" />
                </div>
            </div>
        </section>
    </div>
</template>

<script setup>
import { computed } from 'vue'
import { groupServices, CATEGORY_COLOR } from '@renderer/utils/serviceCategory'

const props = defineProps({
    // Services carrying the DTO `setup` annotation + `config.service`.
    services: { type: Array, default: () => [] },
})
const groups = computed(() => groupServices(props.services))
</script>

<style scoped>
.setup-groups {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
}
.setup-group {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
}
.setup-head {
    display: flex;
    align-items: baseline;
    gap: var(--space-3);
}
.setup-name {
    font-size: var(--font-size-title);
    font-weight: var(--font-weight-semibold);
    color: var(--ev-c-text-1);
}
.setup-tag {
    font-size: var(--font-size-meta);
    padding: var(--chip-padding);
    border-radius: var(--radius-sm);
    font-weight: var(--font-weight-medium);
    text-transform: lowercase;
}
.setup-tag.network {
    background-color: var(--color-accent-soft);
    color: var(--color-accent);
}
.setup-tag.common {
    background-color: var(--ev-c-gray-3);
    color: var(--ev-c-text-3);
}

.setup-group > .category + .category {
    margin-top: var(--space-5);
}
.category.railed {
    border-left: 2px solid var(--cat-color);
    padding-left: var(--space-4);
}
.category-head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--font-size-secondary);
    font-weight: var(--font-weight-semibold);
    color: var(--ev-c-text-2);
    margin-bottom: var(--space-3);
}
.cat-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--cat-color);
    flex-shrink: 0;
}
.group-items {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
}
</style>
