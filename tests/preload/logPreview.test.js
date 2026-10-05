import { describe, it, expect } from 'vitest'
import { preview, previewArgs, LOG_MAX } from '../../src/preload/logPreview'

const PUBKEY = '0x' + 'a'.repeat(96)

describe('preview', () => {
    it('renders scalars as-is', () => {
        expect(preview('hello')).toBe('"hello"')
        expect(preview(42)).toBe('42')
        expect(preview(true)).toBe('true')
        expect(preview(null)).toBe('null')
        expect(preview(undefined)).toBe('undefined')
    })

    it('summarises a big array by length instead of dumping it', () => {
        const keys = Array.from({ length: 1000 }, () => PUBKEY)
        const out = preview(keys)
        expect(out).toBe('Array(1000)')
        // The bug this fixes: the old line was ~51 KB for exactly this argument.
        expect(out.length).toBeLessThan(20)
        expect(out).not.toContain('aaaa')
    })

    it('keeps a small object readable', () => {
        expect(preview({ host: '10.0.0.5', port: 22 })).toBe('{ host: "10.0.0.5", port: 22 }')
    })

    it('never walks into a nested payload', () => {
        const states = Object.fromEntries(Array.from({ length: 500 }, (_, i) => [`k${i}`, { balance: 32 }]))
        const out = preview({ ok: true, states })
        expect(out).toBe('{ ok: true, states: {500 fields} }')
        expect(out).not.toContain('balance')
    })

    it('caps a long string and says how much it dropped', () => {
        const out = preview('x'.repeat(LOG_MAX + 50))
        expect(out).toContain('+') // the elision is named
        expect(out.length).toBeLessThan(LOG_MAX + 40)
    })

    it('names only the first 8 fields of a wide object', () => {
        const wide = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`f${i}`, i]))
        expect(preview(wide)).toContain('+4 more')
    })

    it('renders an Error by message', () => {
        expect(preview(new Error('boom'))).toBe('Error(boom)')
    })

    it('survives a circular structure', () => {
        const a = { name: 'a' }
        a.self = a
        expect(() => preview(a)).not.toThrow()
    })
})

describe('previewArgs', () => {
    it('indexes each argument', () => {
        expect(previewArgs(['node-1', [PUBKEY, PUBKEY]])).toBe('[0]: "node-1" [1]: Array(2)')
    })
    it('is empty for no arguments', () => {
        expect(previewArgs()).toBe('')
    })
})
