import { describe, it, expect } from 'vitest'
import {
    CHARON_CONTAINER_DIR,
    DVT_SERVICE_TYPES,
    isDvtService,
    resolveCharonDataDir,
    buildClusterLockReadCommand,
    parseClusterLock,
} from '@main/nodes/dvt'

const charon = (volumes = []) => ({ service: 'CharonService', volumes })
const pluto = (volumes = []) => ({ service: 'PlutoService', volumes })

describe('isDvtService', () => {
    // Upstream `PlutoService extends CharonService`, and stereum's own getDVTKeys handles the two
    // in one combined `case` - so anything true of Charon here must be true of Pluto.
    it('accepts both DVT clients', () => {
        expect(isDvtService({ service: 'CharonService' })).toBe(true)
        expect(isDvtService({ service: 'PlutoService' })).toBe(true)
        expect(DVT_SERVICE_TYPES.has('PlutoService')).toBe(true)
    })
    it('rejects everything else', () => {
        for (const service of ['GethService', 'LighthouseValidatorService', 'SSVNetworkService', undefined]) {
            expect(isDvtService({ service })).toBe(false)
        }
        expect(isDvtService(null)).toBe(false)
    })
})

describe('resolveCharonDataDir', () => {
    it('returns the host side of the /opt/charon volume', () => {
        expect(resolveCharonDataDir(charon(['/opt/stereum/charon-x/data:/opt/charon'])))
            .toBe('/opt/stereum/charon-x/data')
    })
    it('is undefined for a non-DVT service or a missing volume', () => {
        expect(resolveCharonDataDir({ service: 'GethService', volumes: ['/a:/opt/charon'] })).toBeUndefined()
        expect(resolveCharonDataDir(charon(['/a:/opt/other']))).toBeUndefined()
    })
    it('resolves Pluto the same way - it keeps Charon\'s /opt/charon mount point', () => {
        expect(resolveCharonDataDir(pluto(['/opt/stereum/pluto-y/data:/opt/charon'])))
            .toBe('/opt/stereum/pluto-y/data')
    })
})

describe('buildClusterLockReadCommand', () => {
    it('reads the lockfile under .charon on the host, quoted', () => {
        expect(buildClusterLockReadCommand(charon(['/opt/stereum/charon-x/data:/opt/charon'])))
            .toBe("sudo cat '/opt/stereum/charon-x/data/.charon/cluster-lock.json'")
    })
    it('is null when the DVT data dir is unresolvable', () => {
        expect(buildClusterLockReadCommand(charon([]))).toBeNull()
        expect(buildClusterLockReadCommand(pluto([]))).toBeNull()
    })
    it('builds the identical command for Pluto', () => {
        const volumes = ['/opt/stereum/pluto-y/data:/opt/charon']
        expect(buildClusterLockReadCommand(pluto(volumes)))
            .toBe("sudo cat '/opt/stereum/pluto-y/data/.charon/cluster-lock.json'")
    })
    it('uses the shared container path constant', () => {
        expect(CHARON_CONTAINER_DIR).toBe('/opt/charon')
    })
})

describe('parseClusterLock', () => {
    it('extracts distributed_public_key from every distributed validator', () => {
        const lock = JSON.stringify({
            distributed_validators: [
                { distributed_public_key: '0xaa', public_shares: ['0xshare1'] },
                { distributed_public_key: '0xbb' },
            ],
        })
        expect(parseClusterLock(lock)).toEqual([
            { pubkey: '0xaa', readonly: false },
            { pubkey: '0xbb', readonly: false },
        ])
    })
    it('returns [] for malformed json or a missing array', () => {
        expect(parseClusterLock('not json')).toEqual([])
        expect(parseClusterLock('{}')).toEqual([])
        expect(parseClusterLock(JSON.stringify({ distributed_validators: 'x' }))).toEqual([])
    })
})
