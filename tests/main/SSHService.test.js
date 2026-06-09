import { describe, it, expect, beforeEach, vi } from 'vitest'
import { EventEmitter } from 'events'

vi.mock('fs', () => {
    const readFileSync = vi.fn(() => 'KEY')
    return { readFileSync, default: { readFileSync } }
})
vi.mock('electron-log', () => ({ default: { debug: vi.fn(), info: vi.fn(), error: vi.fn(), warn: vi.fn() } }))

const { FakeClient, FakeStream } = vi.hoisted(() => {
    const { EventEmitter } = require('events')
    class FakeStream extends EventEmitter {
        constructor() { super(); this.stderr = new EventEmitter() }
    }
    class FakeClient extends EventEmitter {
        constructor() {
            super()
            FakeClient.instances.push(this)
            this.connect = (..._a) => {}
            this.end = (..._a) => {}
            this.exec = (..._a) => {} // overridden per-test via mockImplementationOnce-like pattern
        }
    }
    FakeClient.instances = []
    return { FakeClient, FakeStream }
})

vi.mock('ssh2', () => ({ Client: FakeClient }))

import { SSHService, SSHParams, SSHConnection } from '@main/ssh/SSHService'

function makeParams() {
    return new SSHParams('h', 22, 'u', 'p', '/k', '')
}

// Drive a client through a successful ready handshake, including the hostname exec.
function driveReady(client, hostname = 'box') {
    client.exec = vi.fn((_cmd, cb) => {
        const stream = new FakeStream()
        cb(null, stream)
        setImmediate(() => {
            stream.emit('data', Buffer.from(hostname))
            stream.emit('close', 0)
        })
    })
    setImmediate(() => client.emit('ready'))
}

describe('SSHConnection', () => {
    it('assigns a unique id and starts at sessionCount 0', () => {
        const a = new SSHConnection({})
        const b = new SSHConnection({})
        expect(a.id).not.toBe(b.id)
        expect(a.sessionCount).toBe(0)
    })
})

describe('SSHService', () => {
    beforeEach(() => { FakeClient.instances.length = 0 })

    describe('connect', () => {
        it('resolves on ready and pushes a connection to the pool', async () => {
            const svc = new SSHService(makeParams())
            const p = svc.connect()
            const client = FakeClient.instances[0]
            driveReady(client, 'my-host')
            const result = await p
            expect(result.code).toBe(0)
            expect(svc.connections).toHaveLength(1)
            expect(svc.SSHParams.name).toBe('my-host')
        })

        it('rejects when the client emits error', async () => {
            const svc = new SSHService(makeParams())
            const p = svc.connect()
            const client = FakeClient.instances[0]
            setImmediate(() => client.emit('error', new Error('refused')))
            await expect(p).rejects.toMatchObject({ code: 1 })
        })

        it('does not overwrite an existing name on reconnect', async () => {
            const svc = new SSHService(makeParams())
            svc.SSHParams.setHostName('preset')
            const p = svc.connect()
            const client = FakeClient.instances[0]
            client.exec = vi.fn()
            setImmediate(() => client.emit('ready'))
            await p
            // No hostname exec should have happened
            expect(client.exec).not.toHaveBeenCalled()
            expect(svc.SSHParams.name).toBe('preset')
        })

        it('removes connection from pool on "close" event', async () => {
            const svc = new SSHService(makeParams())
            const p = svc.connect()
            const client = FakeClient.instances[0]
            driveReady(client)
            await p
            expect(svc.connections).toHaveLength(1)
            client.emit('close')
            expect(svc.connections).toHaveLength(0)
        })
    })

    describe('getConnection', () => {
        it('returns an existing under-cap connection and bumps sessionCount', async () => {
            const svc = new SSHService(makeParams())
            const fakeConn = { conn: {}, sessionCount: 1 }
            svc.connections = [fakeConn]
            const got = await svc.getConnection()
            expect(got).toBe(fakeConn)
            expect(fakeConn.sessionCount).toBe(2)
        })

        it('opens a new connection when none exist', async () => {
            const svc = new SSHService(makeParams())
            const spy = vi.spyOn(svc, 'connect').mockImplementation(async () => {
                svc.connections.push({ conn: {}, sessionCount: 0 })
            })
            const got = await svc.getConnection()
            expect(spy).toHaveBeenCalled()
            expect(got.sessionCount).toBe(1)
        })

        it('throws when connect() succeeds but no connection becomes available', async () => {
            const svc = new SSHService(makeParams())
            vi.spyOn(svc, 'connect').mockResolvedValue()
            await expect(svc.getConnection()).rejects.toThrow(/No available SSH connection/)
        })
    })

    describe('exec', () => {
        it('prefixes "sudo " when useSudo=true (default)', async () => {
            const svc = new SSHService(makeParams())
            const fakeConn = {
                conn: { exec: vi.fn((cmd, cb) => {
                    const stream = new FakeStream()
                    cb(null, stream)
                    setImmediate(() => {
                        stream.emit('data', Buffer.from('out'))
                        stream.stderr.emit('data', Buffer.from('err'))
                        stream.emit('close', 0)
                    })
                }) },
                sessionCount: 0,
            }
            svc.connections = [fakeConn]
            const result = await svc.exec('ls')
            expect(fakeConn.conn.exec.mock.calls[0][0]).toBe('sudo ls')
            expect(result).toEqual({ rc: 0, stdout: 'out', stderr: 'err' })
        })

        it('does not prefix sudo when useSudo=false', async () => {
            const svc = new SSHService(makeParams())
            const fakeConn = {
                conn: { exec: vi.fn((cmd, cb) => {
                    const stream = new FakeStream()
                    cb(null, stream)
                    setImmediate(() => stream.emit('close', 0))
                }) },
                sessionCount: 0,
            }
            svc.connections = [fakeConn]
            await svc.exec('whoami', false)
            expect(fakeConn.conn.exec.mock.calls[0][0]).toBe('whoami')
        })

        it('rejects when conn.exec yields an error', async () => {
            const svc = new SSHService(makeParams())
            svc.connections = [{
                conn: { exec: (cmd, cb) => cb(new Error('chan-fail')) },
                sessionCount: 0,
            }]
            await expect(svc.exec('ls')).rejects.toThrow('chan-fail')
        })

        it('accumulates multi-chunk stdout/stderr', async () => {
            const svc = new SSHService(makeParams())
            svc.connections = [{
                conn: { exec: (cmd, cb) => {
                    const stream = new FakeStream()
                    cb(null, stream)
                    setImmediate(() => {
                        stream.emit('data', Buffer.from('hel'))
                        stream.emit('data', Buffer.from('lo'))
                        stream.stderr.emit('data', Buffer.from('w'))
                        stream.stderr.emit('data', Buffer.from('arn'))
                        stream.emit('close', 2)
                    })
                } },
                sessionCount: 0,
            }]
            const r = await svc.exec('x', false)
            expect(r).toEqual({ rc: 2, stdout: 'hello', stderr: 'warn' })
        })
    })

    describe('disconnect', () => {
        it('calls .end() on each conn and clears the pool', () => {
            const svc = new SSHService(makeParams())
            const end1 = vi.fn(), end2 = vi.fn()
            svc.connections = [{ conn: { end: end1 } }, { conn: { end: end2 } }]
            svc.disconnect()
            expect(end1).toHaveBeenCalled()
            expect(end2).toHaveBeenCalled()
            expect(svc.connections).toEqual([])
        })
    })
})
