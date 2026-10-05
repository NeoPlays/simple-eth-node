import { describe, it, expect } from 'vitest'
import { classifyValidatorSetup, isSoloEligible, holdsOnChainValidators, isDvtType } from '@renderer/utils/validatorSetup'

const svc = (id, service) => ({ id, config: { service } })

describe('isDvtType', () => {
    it('covers both DVT clients and nothing else', () => {
        expect(isDvtType('CharonService')).toBe(true)
        expect(isDvtType('PlutoService')).toBe(true)
        expect(isDvtType('LighthouseValidatorService')).toBe(false)
        expect(isDvtType(undefined)).toBe(false)
    })
})

describe('classifyValidatorSetup', () => {
    it('classifies a solo validator setup and points keyHolder at the VC', () => {
        const vc = svc('v1', 'LighthouseValidatorService')
        const r = classifyValidatorSetup([svc('b1', 'LighthouseBeaconService'), vc])
        expect(r.kind).toBe('solo')
        expect(r.keyHolder).toBe(vc)
        expect(r.clients).toEqual([vc])
    })

    it('classifies a remote-signer setup (Web3Signer holds the keys, not the VC)', () => {
        const signer = svc('w1', 'Web3SignerService')
        const r = classifyValidatorSetup([svc('v1', 'TekuValidatorService'), signer])
        expect(r.kind).toBe('remote-signer')
        expect(r.keyHolder).toBe(signer)
        expect(r.web3signer).toBe(signer)
    })

    it('classifies an Obol setup as obol, with Charon as the keyHolder (lockfile DV pubkeys)', () => {
        const charon = svc('c1', 'CharonService')
        const r = classifyValidatorSetup([charon, svc('v1', 'LighthouseValidatorService')])
        expect(r.kind).toBe('obol') // obol wins over solo
        expect(r.keyHolder).toBe(charon) // the DV pubkeys come from Charon's cluster-lock.json
        expect(r.charon).toBe(charon)
    })

    it('keeps Charon as the Obol keyHolder even when a VC and Web3Signer are present', () => {
        const charon = svc('c1', 'CharonService')
        const r = classifyValidatorSetup([charon, svc('v1', 'TekuValidatorService'), svc('w1', 'Web3SignerService')])
        expect(r.kind).toBe('obol')
        expect(r.keyHolder).toBe(charon)
    })

    // Nethermind's Pluto is a Rust reimplementation of Charon; upstream it extends CharonService
    // and stereum reads its cluster-lock.json through the same code path. A Pluto setup must
    // therefore classify exactly like an Obol one, or its DV pubkeys never get listed.
    it('classifies a Pluto setup as obol, with Pluto as the keyHolder', () => {
        const pluto = svc('p1', 'PlutoService')
        const r = classifyValidatorSetup([pluto, svc('v1', 'LighthouseValidatorService')])
        expect(r.kind).toBe('obol')
        expect(r.keyHolder).toBe(pluto)
        expect(r.charon).toBe(pluto)
        expect(r.clients).toContain(pluto)
    })

    it('treats a VC behind Pluto as a share holder, never as solo', () => {
        const vc = svc('v1', 'LighthouseValidatorService')
        const r = classifyValidatorSetup([svc('p1', 'PlutoService'), vc])
        // kind 'obol' is what makes roleOf() report 'share' for the VC, gating every mutation off.
        expect(r.kind).toBe('obol')
        expect(r.keyHolder).not.toBe(vc)
        expect(holdsOnChainValidators('share', r.kind)).toBe(false)
    })

    it('classifies an SSV setup and takes precedence over everything else', () => {
        const ssv = svc('s1', 'SSVNetworkService')
        const r = classifyValidatorSetup([ssv, svc('c1', 'CharonService'), svc('v1', 'PrysmValidatorService')])
        expect(r.kind).toBe('ssv')
        expect(r.keyHolder).toBeNull()
        expect(r.ssv).toBe(ssv)
    })

    it('is "none" when the setup has no validator-category service', () => {
        const r = classifyValidatorSetup([svc('e1', 'GethService'), svc('b1', 'LighthouseBeaconService')])
        expect(r.kind).toBe('none')
        expect(r.keyHolder).toBeNull()
        expect(r.clients).toEqual([])
    })

    it('handles an empty / undefined setup', () => {
        expect(classifyValidatorSetup([]).kind).toBe('none')
        expect(classifyValidatorSetup().kind).toBe('none')
    })

    it('collects every validator-category service in clients (across paradigms)', () => {
        const r = classifyValidatorSetup([
            svc('c1', 'CharonService'),
            svc('v1', 'LighthouseValidatorService'),
            svc('v2', 'LodestarValidatorService'),
        ])
        expect(r.clients.map((s) => s.id).sort()).toEqual(['c1', 'v1', 'v2'])
    })
})

describe('isSoloEligible', () => {
    it('is true only for solo setups (slashing gate S4)', () => {
        expect(isSoloEligible('solo')).toBe(true)
        for (const k of ['remote-signer', 'obol', 'ssv', 'none']) expect(isSoloEligible(k)).toBe(false)
    })
})

describe('holdsOnChainValidators', () => {
    it('Charon DV pubkeys and solo/remote-signer keys are on-chain', () => {
        expect(holdsOnChainValidators('distributed', 'obol')).toBe(true)
        expect(holdsOnChainValidators('validator', 'solo')).toBe(true)
        expect(holdsOnChainValidators('signer', 'remote-signer')).toBe(true)
    })
    it('key shares behind Charon (VC or Web3Signer) are NOT on-chain', () => {
        expect(holdsOnChainValidators('share', 'obol')).toBe(false)
        expect(holdsOnChainValidators('signer', 'obol')).toBe(false)
    })
    it('SSV is off-node', () => {
        expect(holdsOnChainValidators('ssv', 'ssv')).toBe(false)
    })
})

// A VC whose beacon endpoint is a Charon on another machine: the setup holds no DVT service, so
// only the main process's probe (`dvtBackends`) can tell it is not a solo validator.
describe('classifyValidatorSetup with a remote Charon', () => {
    const vc = svc('v1', 'LighthouseValidatorService')
    const remote = { v1: { client: 'charon', endpoint: 'http://10.0.0.5:3600', detectedBy: 'version' } }

    it('is solo without probe data, and obol once the probe names Charon', () => {
        expect(classifyValidatorSetup([vc]).kind).toBe('solo')
        const r = classifyValidatorSetup([vc], { dvtBackends: remote })
        expect(r.kind).toBe('obol')
        expect(r.keyHolder).toBe(vc)
        expect(r.remoteDvt).toMatchObject({ service: vc, client: 'charon', endpoint: 'http://10.0.0.5:3600' })
        expect(isSoloEligible(r.kind)).toBe(false)
    })

    it('ignores a probe that found no DVT client', () => {
        const r = classifyValidatorSetup([vc], { dvtBackends: { v1: { client: null } } })
        expect(r.kind).toBe('solo')
        expect(r.remoteDvt).toBeNull()
    })

    it('keeps a local Charon as the key holder; the VC beside it stays a share holder', () => {
        const charon = svc('c1', 'CharonService')
        const r = classifyValidatorSetup([charon, vc], { dvtBackends: remote })
        expect(r.keyHolder).toBe(charon)
        expect(r.remoteDvt).toBeNull()
    })

    it('wins over a remote signer: a Web3Signer behind a VC behind Charon still holds shares', () => {
        const r = classifyValidatorSetup([vc, svc('w1', 'Web3SignerService')], { dvtBackends: remote })
        expect(r.kind).toBe('obol')
    })
})
