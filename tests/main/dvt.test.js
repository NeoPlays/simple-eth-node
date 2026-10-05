import { describe, it, expect } from 'vitest'
import {
    CHARON_CONTAINER_DIR,
    DVT_SERVICE_TYPES,
    isDvtService,
    resolveCharonDataDir,
    buildClusterLockReadCommand,
    parseClusterLock,
    dvtClientFromVersion,
    buildDvtProbeScript,
    parseDvtProbe,
    classifyVcBackend,
    mapSharesToDv,
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

describe('remote DVT detection', () => {
    const CHARON = 'http://10.0.0.5:3600'
    const BEACON = 'http://10.0.0.6:5052'
    const out = (base, body, code) => `===DVT_PROBE===${base}\n${body}\n===DVT_HTTP===${code}\n`

    it('names the client from its node version string', () => {
        expect(dvtClientFromVersion('obolnetwork/charon/v1.5.0-abc123/amd64-linux')).toBe('charon')
        expect(dvtClientFromVersion('nethermind/pluto/v0.1.0')).toBe('pluto')
        expect(dvtClientFromVersion('Lighthouse/v7.1.0-0b0a1b4/x86_64-linux')).toBeNull()
        expect(dvtClientFromVersion(null)).toBeNull()
    })

    it('probes each endpoint once, with a per-endpoint HTTP code', () => {
        const script = buildDvtProbeScript([CHARON, BEACON, CHARON])
        expect(script.match(/node\/version/g)).toHaveLength(2)
        expect(script).toContain(`'${CHARON}/eth/v1/node/version'`)
        expect(buildDvtProbeScript([])).toBeNull()
    })

    it('parses answers and dead endpoints apart', () => {
        const parsed = parseDvtProbe(
            out(CHARON, '{"data":{"version":"obolnetwork/charon/v1.5.0"}}', 200) +
            out(BEACON, '', '000'),
        )
        expect(parsed[CHARON]).toEqual({ httpCode: 200, version: 'obolnetwork/charon/v1.5.0' })
        expect(parsed[BEACON]).toEqual({ httpCode: 0, version: null })
    })

    it('classifies a client whose endpoint answers as Charon', () => {
        const probe = { [CHARON]: { httpCode: 200, version: 'obolnetwork/charon/v1.5.0' }, [BEACON]: { httpCode: 200, version: 'Teku/v25' } }
        expect(classifyVcBackend([CHARON, BEACON], probe)).toEqual({
            client: 'charon', endpoint: CHARON, version: 'obolnetwork/charon/v1.5.0', detectedBy: 'version', beacons: [BEACON],
        })
    })

    it('treats an unreachable endpoint on Charon\'s port as Charon, so writes stay gated', () => {
        const r = classifyVcBackend([CHARON], { [CHARON]: { httpCode: 0, version: null } })
        expect(r).toMatchObject({ client: 'charon', endpoint: CHARON, detectedBy: 'port' })
    })

    it('does not suspect a real beacon that happens to answer on port 3600', () => {
        const r = classifyVcBackend([CHARON], { [CHARON]: { httpCode: 200, version: 'Nimbus/v25' } })
        expect(r.client).toBeNull()
        expect(r.beacons).toEqual([CHARON])
    })

    it('maps shares to distributed validators by index, skipping anything unresolved', () => {
        const S1 = '0x' + '1'.repeat(96), S2 = '0x' + '2'.repeat(96), DV1 = '0x' + 'd'.repeat(96)
        const shares = { [S1]: { index: 7 }, [S2]: { index: 8 } }
        expect(mapSharesToDv(shares, { [DV1]: { index: 7 } })).toEqual({ [S1]: DV1 })
        // a "beacon" that is itself Charon answers with the share again - that is not a mapping
        expect(mapSharesToDv(shares, { [S1]: { index: 7 } })).toEqual({})
    })
})
