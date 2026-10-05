import { describe, it, expect } from 'vitest'
import { manifestVersions, latestVersion } from '@renderer/utils/updateManifest'

const manifest = {
    mainnet: { NethermindService: ['1.39.3', '2.0.0', '2.1.0'], GethService: ['v1.16.3'] },
    hoodi: { NethermindService: ['2.0.0', '2.0.1'] },
    stereum: [{ name: '2.5.1', commit: 'abc' }],
}

describe('manifestVersions / latestVersion', () => {
    it('uses the network\'s own list when it has one', () => {
        expect(latestVersion(manifest, 'hoodi', 'NethermindService')).toBe('2.0.1')
    })
    it('falls back to mainnet for a network the manifest lacks (gnosis)', () => {
        expect(latestVersion(manifest, 'gnosis', 'NethermindService')).toBe('2.1.0')
    })
    it('falls back to mainnet when the network lacks this service', () => {
        expect(latestVersion(manifest, 'hoodi', 'GethService')).toBe('v1.16.3')
    })
    it('is null for a service nowhere in the manifest, or no manifest yet', () => {
        expect(latestVersion(manifest, 'mainnet', 'CustomService')).toBeNull()
        expect(latestVersion(null, 'mainnet', 'GethService')).toBeNull()
        expect(manifestVersions(manifest, 'gnosis', undefined)).toBeNull()
    })
})
