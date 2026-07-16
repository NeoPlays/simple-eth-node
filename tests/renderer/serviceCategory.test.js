import { describe, it, expect } from 'vitest'
import { serviceCategory, SERVICE_CATEGORY, CATEGORY_ORDER, CATEGORY_LABELS } from '@renderer/utils/serviceCategory'

describe('serviceCategory', () => {
    it('categorizes execution / consensus / validator clients', () => {
        expect(serviceCategory('GethService')).toBe('execution')
        expect(serviceCategory('EthrexService')).toBe('execution')
        expect(serviceCategory('LighthouseBeaconService')).toBe('consensus')
        expect(serviceCategory('GrandineBeaconService')).toBe('consensus')
        expect(serviceCategory('LighthouseValidatorService')).toBe('validator')
    })

    it('treats Charon, SSVNetwork and Web3Signer as validator middleware', () => {
        expect(serviceCategory('CharonService')).toBe('validator')
        expect(serviceCategory('SSVNetworkService')).toBe('validator')
        expect(serviceCategory('Web3SignerService')).toBe('validator')
    })

    it('puts mev-boost, the ejector, and monitoring/helpers in "other"', () => {
        expect(serviceCategory('FlashbotsMevBoostService')).toBe('other')
        expect(serviceCategory('ValidatorEjectorService')).toBe('other') // not validator, despite the name
        expect(serviceCategory('PrometheusService')).toBe('other')
        expect(serviceCategory('GrafanaService')).toBe('other')
        expect(serviceCategory('SSVDKGService')).toBe('other')
        expect(serviceCategory('KeysAPIService')).toBe('other')
    })

    it('falls back to "other" for unknown / custom types and undefined', () => {
        expect(serviceCategory('CustomService')).toBe('other')
        expect(serviceCategory('SomeFutureService')).toBe('other')
        expect(serviceCategory(undefined)).toBe('other')
    })

    it('every mapped category is a known ordered key with a label', () => {
        for (const cat of Object.values(SERVICE_CATEGORY)) {
            expect(CATEGORY_ORDER).toContain(cat)
        }
        for (const key of CATEGORY_ORDER) {
            expect(typeof CATEGORY_LABELS[key]).toBe('string')
        }
    })
})
