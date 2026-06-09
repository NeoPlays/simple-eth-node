import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('fs', () => {
    const readFileSync = vi.fn(() => 'PRIVATE-KEY-CONTENT')
    return { readFileSync, default: { readFileSync } }
})
vi.mock('electron-log', () => ({ default: { debug: vi.fn(), info: vi.fn(), error: vi.fn(), warn: vi.fn() } }))
vi.mock('ssh2', () => ({ Client: class { connect() {} on() {} } }))

import { SSHParams } from '@main/ssh/SSHService'
import { readFileSync } from 'fs'

describe('SSHParams', () => {
    beforeEach(() => { readFileSync.mockClear() })

    it('reads private key from disk on construction', () => {
        new SSHParams('h', 22, 'u', 'p', '/path/to/key', 'pp')
        expect(readFileSync).toHaveBeenCalledWith('/path/to/key', 'utf8')
    })

    it('initializes name to empty string', () => {
        const p = new SSHParams('h', 22, 'u', 'p', '/k', '')
        expect(p.name).toBe('')
    })

    it('stores all credential fields', () => {
        const p = new SSHParams('host', 2222, 'user', 'pass', '/k', 'pp')
        expect(p.host).toBe('host')
        expect(p.port).toBe(2222)
        expect(p.username).toBe('user')
        expect(p.password).toBe('pass')
        expect(p.privateKey).toBe('PRIVATE-KEY-CONTENT')
        expect(p.passphrase).toBe('pp')
    })

    it('getConnectionParams returns ssh2-ready shape', () => {
        const p = new SSHParams('host', 22, 'u', 'pw', '/k', 'pp')
        p.setHostName('my-server')
        expect(p.getConnectionParams()).toEqual({
            name: 'my-server',
            host: 'host',
            port: 22,
            username: 'u',
            password: 'pw',
            privateKey: 'PRIVATE-KEY-CONTENT',
            passphrase: 'pp',
        })
    })

    it('setHostName updates name field', () => {
        const p = new SSHParams('h', 22, 'u', 'p', '/k', '')
        p.setHostName('changed')
        expect(p.name).toBe('changed')
    })
})
