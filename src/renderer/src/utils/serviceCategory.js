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

/**
 * Category of a stereum service type.
 * @param {string} serviceType - e.g. "GethService" (a service config's `service` field)
 * @returns {'execution'|'consensus'|'validator'|'other'}
 */
export function serviceCategory(serviceType) {
    return SERVICE_CATEGORY[serviceType] || 'other'
}
