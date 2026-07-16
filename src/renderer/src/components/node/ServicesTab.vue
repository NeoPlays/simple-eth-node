<template>
    <div class="services-tab">
        <div v-if="services?.length === 0" class="state-message">No services found.</div>

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
                <div class="service-list">
                    <div class="service-card" :class="{ highlighted: highlightedId === service.id }" v-for="service in cat.services" :key="service.id">
                        <div class="service-main">
                            <span class="service-name">{{ service.config?.service ?? service.id }}</span>
                            <span class="service-network" v-if="!service.setup && service.config?.network">{{ service.config.network }}</span>
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
                        <div class="service-deps" v-if="depsByService[service.id]?.length">
                            <span class="deps-label">connects to</span>
                            <span
                                class="dep-chip"
                                :class="{ missing: dep.missing }"
                                v-for="dep in depsByService[service.id]"
                                :key="dep.id"
                                @mouseenter="highlightedId = dep.id"
                                @mouseleave="highlightedId = null"
                                :title="dep.missing ? 'Not a service on this node' : ''"
                            >
                                <span class="dep-dot" :style="{ background: CATEGORY_COLOR[dep.category] }"></span>{{ dep.name }}
                            </span>
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
            </div>
        </section>
    </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { serviceCategory, CATEGORY_ORDER, CATEGORY_LABELS } from '@renderer/utils/serviceCategory'

const props = defineProps({
    services: { type: Array, default: () => [] },
    pending: { type: Object, default: () => new Set() }, // reactive Set of in-flight service ids
})
const emit = defineEmits(['toggle', 'restart', 'logs', 'edit'])

// Category hue (validated --chart palette), single source for the rail, header dot and
// dependency chips. Kept in the component (CSS token strings) rather than the util.
const CATEGORY_COLOR = {
    execution: 'var(--chart-1)', // blue
    consensus: 'var(--chart-4)', // violet
    validator: 'var(--chart-2)', // aqua
    other: 'var(--ev-c-gray-2)',
}

// The service each id resolves to (for turning a dependency ref into a name + category).
const serviceById = computed(() => Object.fromEntries(props.services.map((s) => [s.id, s])))

// A service's outgoing dependencies (what it connects to), flattened across the role
// buckets in config.dependencies. Each ref resolves to the target's short name + category;
// `missing` = the dependency isn't a service on this node (e.g. an external client).
const DEP_ROLES = ['executionClients', 'consensusClients', 'validatorClients', 'mevboost', 'otherServices']
function shortName(type) {
    return (type || '').replace(/Service$/, '').replace(/Beacon|Validator/g, '') || type
}
function resolveDeps(service) {
    const deps = service.config?.dependencies
    if (!deps) return []
    const refs = []
    const seen = new Set()
    for (const role of DEP_ROLES) {
        for (const d of deps[role] || []) {
            if (!d?.id || seen.has(d.id)) continue
            seen.add(d.id)
            const target = serviceById.value[d.id]
            const type = target?.config?.service || d.service
            refs.push({ id: d.id, name: shortName(type) || d.id.slice(0, 6), category: serviceCategory(type), missing: !target })
        }
    }
    return refs
}
const depsByService = computed(() => Object.fromEntries(props.services.map((s) => [s.id, resolveDeps(s)])))

// The service card currently highlighted by hovering a dependency chip that points to it.
const highlightedId = ref(null)

// Split a setup's services into ordered client-type buckets (EC -> CC -> VC -> Other),
// dropping empty ones. Categorization is the shared, stereum-authoritative map.
function categorize(services) {
    const byCat = {}
    for (const svc of services) (byCat[serviceCategory(svc.config?.service)] ||= []).push(svc)
    return CATEGORY_ORDER
        .filter((c) => byCat[c]?.length)
        .map((c) => ({ key: c, label: CATEGORY_LABELS[c], services: byCat[c] }))
}

// Group services by their setup (from multisetup.yaml). Real setups first (by name),
// the node-wide `common` group last, and anything without a setup (older single-setup
// nodes) in a trailing headerless group so it renders as a flat list like before.
// Each group is then split into client-type categories.
const groups = computed(() => {
    const bySetup = new Map()
    const ungrouped = []
    for (const svc of props.services) {
        const su = svc.setup
        if (!su) { ungrouped.push(svc); continue }
        if (!bySetup.has(su.id)) bySetup.set(su.id, { key: su.id, setup: su, services: [] })
        bySetup.get(su.id).services.push(svc)
    }
    const arr = [...bySetup.values()].sort((a, b) => {
        const ac = a.setup.type === 'common' ? 1 : 0
        const bc = b.setup.type === 'common' ? 1 : 0
        if (ac !== bc) return ac - bc // common last
        return (a.setup.name || '').localeCompare(b.setup.name || '')
    })
    if (ungrouped.length) arr.push({ key: '__ungrouped', setup: null, services: ungrouped })
    return arr.map((g) => ({ ...g, categories: categorize(g.services) }))
})

function isRunning(service) {
    return service.container?.state === 'running' || service.container?.state === 'restarting'
}
</script>

<style scoped>
.services-tab {
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
/* Colored left rail binds a category's cards together; the header dot + rail share the
   category's hue (from the validated --chart palette). Only present when a setup has
   more than one category (single-category groups render flat, no rail). */
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
    box-shadow: 0 0 0 0 transparent;
    transition: box-shadow var(--transition-fast);
}
/* Ring shown when another card's "connects to" chip points here. */
.service-card.highlighted {
    box-shadow: 0 0 0 2px var(--color-accent);
}

/* Dependency chips: what this service connects to (EC / CC / mev-boost / ...). */
.service-deps {
    grid-column: 1 / -1;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    margin-top: var(--space-1);
}
.deps-label {
    font-size: var(--font-size-micro);
    color: var(--ev-c-text-3);
    text-transform: uppercase;
    letter-spacing: 0.05em;
}
.dep-chip {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--chip-padding);
    border-radius: var(--radius-sm);
    background-color: var(--ev-c-gray-3);
    font-size: var(--font-size-meta);
    color: var(--ev-c-text-2);
    cursor: default;
    transition: background-color var(--transition-fast);
}
.dep-chip:hover { background-color: var(--ev-c-gray-2); }
.dep-chip.missing {
    opacity: 0.6;
    text-decoration: line-through;
}
.dep-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    flex-shrink: 0;
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
