import { describe, it, expect } from 'vitest'
import {
    DELETE_CHUNK, IMPORT_CHUNK, chunked, importChunks, isPrysmWalletMissing, prysmWalletCommands,
} from '@main/nodes/importChecks'

describe('chunking', () => {
    it('splits a list into fixed-size pieces', () => {
        expect(chunked([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
        expect(chunked([], 20)).toEqual([])
        expect(DELETE_CHUNK).toBe(20)
    })

    it('chunks imports by count', () => {
        const sizes = Array(IMPORT_CHUNK + 5).fill(10)
        expect(importChunks(sizes)).toEqual([[0, IMPORT_CHUNK], [IMPORT_CHUNK, IMPORT_CHUNK + 5]])
    })

    it('chunks imports by bytes, and never drops an oversized keystore', () => {
        expect(importChunks([60, 60, 60], { maxBytes: 100 })).toEqual([[0, 1], [1, 2], [2, 3]])
        expect(importChunks([500], { maxBytes: 100 })).toEqual([[0, 1]])
        expect(importChunks([])).toEqual([])
    })
})

describe('Prysm wallet', () => {
    const config = {
        service: 'PrysmValidatorService',
        network: 'hoodi',
        volumes: ['/opt/stereum/prysm-x/data/wallets:/opt/app/data/wallets', '/opt/stereum/prysm-x/data/passwords:/opt/app/data/passwords'],
    }

    it('recognises the wallet-not-initialized answer', () => {
        expect(isPrysmWalletMissing('{"message":"Prysm Wallet not initialized. Please create a new wallet."}')).toBe(true)
        expect(isPrysmWalletMissing('{"message":"other"}')).toBe(false)
        expect(isPrysmWalletMissing('nope')).toBe(false)
    })

    it('builds the wallet commands from the host volumes', () => {
        const c = prysmWalletCommands('abc-123', config)
        expect(c.check).toContain('/opt/stereum/prysm-x/data/wallets/direct/accounts')
        expect(c.writePassword).toBe('tee /opt/stereum/prysm-x/data/passwords/wallet-password > /dev/null')
        expect(c.create).toContain('docker exec stereum-abc-123 /app/cmd/validator/validator wallet create')
        expect(c.create).toContain('--hoodi')
    })

    it('refuses unsafe ids, networks or paths', () => {
        expect(prysmWalletCommands('a;b', config)).toBeNull()
        expect(prysmWalletCommands('abc', { ...config, network: 'hoodi; rm' })).toBeNull()
        expect(prysmWalletCommands('abc', { ...config, volumes: ["/opt/st'x:/opt/app/data/wallets", config.volumes[1]] })).toBeNull()
        expect(prysmWalletCommands('abc', { ...config, volumes: [config.volumes[0]] })).toBeNull()
    })
})
