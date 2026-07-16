// Client-type categorization for stereum services, mirrored from the launcher's
// authoritative map (`launcher/src/store/services.js`). stereum's four categories are
// execution / consensus / validator / service; we surface them as EC / CC / VC / Other.
//
// Non-obvious cases worth knowing: Obol Charon (DVT), SSVNetwork and Web3Signer are
// validator-category middleware; the SSV DKG/NOM helpers, the validator ejector, keys-api,
// mev-boost and the monitoring stack are all "other". Unknown/custom types fall back to other.

// Category keys in stack order (how an operator reads a setup top to bottom).
export const CATEGORY_ORDER = ['execution', 'consensus', 'validator', 'other']

// Display labels for each category (full word for headers; EC/CC/VC/… also common).
export const CATEGORY_LABELS = { execution: 'Execution', consensus: 'Consensus', validator: 'Validator', other: 'Other' }

// Service type -> category. Keep in sync with stereum's store/services.js.
export const SERVICE_CATEGORY = {
    // execution
    GethService: 'execution', BesuService: 'execution', NethermindService: 'execution',
    ErigonService: 'execution', RethService: 'execution', EthrexService: 'execution',
    OpGethService: 'execution', OpErigonService: 'execution', OpRethService: 'execution',
    L2GethService: 'execution', ExternalExecutionService: 'execution',
    // consensus
    LighthouseBeaconService: 'consensus', PrysmBeaconService: 'consensus', NimbusBeaconService: 'consensus',
    TekuBeaconService: 'consensus', LodestarBeaconService: 'consensus', GrandineBeaconService: 'consensus',
    OpNodeBeaconService: 'consensus', ExternalConsensusService: 'consensus',
    // validator (incl. middleware: Obol Charon / DVT, SSV network, remote signer)
    LighthouseValidatorService: 'validator', PrysmValidatorService: 'validator', NimbusValidatorService: 'validator',
    TekuValidatorService: 'validator', LodestarValidatorService: 'validator',
    CharonService: 'validator', SSVNetworkService: 'validator', Web3SignerService: 'validator',
    // everything else (mev-boost, monitoring, ejector, keys-api, ssv dkg/nom, ipfs, ...) -> other
}

// Category hue (validated --chart palette). Single source shared by every tab's rails,
// header dots and dependency chips.
export const CATEGORY_COLOR = {
    execution: 'var(--chart-1)', // blue
    consensus: 'var(--chart-4)', // violet
    validator: 'var(--chart-2)', // aqua
    other: 'var(--ev-c-gray-2)',
}

/**
 * Category of a stereum service type.
 * @param {string} serviceType - e.g. "GethService" (a service config's `service` field)
 * @returns {'execution'|'consensus'|'validator'|'other'}
 */
export function serviceCategory(serviceType) {
    return SERVICE_CATEGORY[serviceType] || 'other'
}

/** Split services into ordered client-type buckets (EC -> CC -> VC -> Other), empties dropped. */
function categorize(services) {
    const byCat = {}
    for (const svc of services) (byCat[serviceCategory(svc.config?.service)] ||= []).push(svc)
    return CATEGORY_ORDER
        .filter((c) => byCat[c]?.length)
        .map((c) => ({ key: c, label: CATEGORY_LABELS[c], services: byCat[c] }))
}

/**
 * Group services by their setup (from multisetup.yaml), then by client-type category.
 * Real setups first (by name), the node-wide `common` group last, and anything without a
 * setup (older single-setup nodes) in a trailing headerless group. Each service must carry
 * the DTO's `setup` annotation and `config.service`. Shared by the Services/Metrics/Updates
 * tabs via <SetupGroups>.
 * @returns {{ key:string, setup:object|null, categories:{ key, label, services }[] }[]}
 */
export function groupServices(services = []) {
    const bySetup = new Map()
    const ungrouped = []
    for (const svc of services) {
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
}
