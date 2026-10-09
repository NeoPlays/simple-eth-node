import { describe, it, expect } from 'vitest'
import { readDroppedJson, filesFromEntries } from '@renderer/utils/droppedFiles'

// Minimal stand-ins for the File / FileSystemEntry API a drop exposes.
const file = (name, content = '{}') => ({ name, text: async () => content })
const fileEntry = (f) => ({ isFile: true, isDirectory: false, file: (ok) => ok(f) })
const dirEntry = (children, batch = 2) => ({
    isFile: false,
    isDirectory: true,
    // readEntries hands out batches until an empty one, like Chromium does for large folders.
    createReader: () => {
        let i = 0
        return { readEntries: (ok) => { const out = children.slice(i, i + batch); i += batch; ok(out) } }
    },
})
const drop = (entries) => ({ items: entries.map((e) => ({ kind: 'file', webkitGetAsEntry: () => e })), files: [] })

describe('readDroppedJson', () => {
    it('walks a dropped validator_keys folder, across readEntries batches', async () => {
        const folder = dirEntry([
            fileEntry(file('keystore-m_12381_3600_0_0_0.json', '{"pubkey":"aa"}')),
            fileEntry(file('keystore-m_12381_3600_1_0_0.json', '{"pubkey":"bb"}')),
            fileEntry(file('deposit_data-1700000000.json', '[]')),
            fileEntry(file('README.txt', 'hi')),
            dirEntry([fileEntry(file('nested.json'))]),
        ])
        const r = await readDroppedJson(drop([folder]))
        expect(r.files.map((f) => f.name)).toEqual([
            'keystore-m_12381_3600_0_0_0.json', 'keystore-m_12381_3600_1_0_0.json', 'deposit_data-1700000000.json', 'nested.json',
        ])
        expect(r.files[0].content).toBe('{"pubkey":"aa"}')
        expect(r.ignored).toBe(1)
    })

    it('falls back to dataTransfer.files when the entry API is unavailable', async () => {
        const r = await readDroppedJson({ items: [], files: [file('a.json', '{"pubkey":"aa"}'), file('b.txt')] })
        expect(r.files).toEqual([{ name: 'a.json', content: '{"pubkey":"aa"}' }])
        expect(r.ignored).toBe(1)
    })

    it('handles an empty drop', async () => {
        expect(await readDroppedJson(null)).toEqual({ files: [], ignored: 0 })
        expect(await filesFromEntries([null])).toEqual([])
    })
})
