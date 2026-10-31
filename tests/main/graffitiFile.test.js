import { describe, it, expect } from 'vitest'
import {
    graffitiFilePath,
    parseGraffitiFile,
    updateGraffitiFile,
    graffitiFromFile,
    buildGraffitiReadCommand,
    buildGraffitiWriteCommands,
} from '@main/nodes/graffitiFile'

const PK_A = '0x' + 'a'.repeat(96)
const PK_B = '0x' + 'b'.repeat(96)

// The shape stereum's LighthouseValidatorService writes.
const lighthouse = (overrides = {}) => ({
    service: 'LighthouseValidatorService',
    command: ['lighthouse', 'vc', '--graffiti-file=/opt/app/graffitis/graffitis.yaml'],
    volumes: [
        '/opt/stereum/lighthouse-x/validator:/opt/app/validator',
        '/opt/stereum/lighthouse-x/graffitis:/opt/app/graffitis',
    ],
    ...overrides,
})

describe('graffitiFilePath', () => {
    it('maps the flag to the host side of its volume', () => {
        expect(graffitiFilePath(lighthouse())).toBe('/opt/stereum/lighthouse-x/graffitis/graffitis.yaml')
    })

    it('reads a string command too', () => {
        const cfg = lighthouse({ command: 'lighthouse vc --graffiti-file=/opt/app/graffitis/graffitis.yaml --http' })
        expect(graffitiFilePath(cfg)).toBe('/opt/stereum/lighthouse-x/graffitis/graffitis.yaml')
    })

    it('is null for other clients, without the flag, or outside every volume', () => {
        expect(graffitiFilePath(lighthouse({ service: 'TekuValidatorService' }))).toBeNull()
        expect(graffitiFilePath(lighthouse({ command: ['lighthouse', 'vc'] }))).toBeNull()
        expect(graffitiFilePath(lighthouse({ command: ['--graffiti-file=/elsewhere/g.yaml'] }))).toBeNull()
    })

    it('does not match a volume that only shares a name prefix', () => {
        const cfg = lighthouse({ volumes: ['/opt/stereum/x/g:/opt/app/graffiti'] })
        expect(graffitiFilePath(cfg)).toBeNull()
    })

    it('refuses traversal and shell metacharacters', () => {
        expect(graffitiFilePath(lighthouse({ command: ['--graffiti-file=/opt/app/graffitis/../../etc/passwd'] }))).toBeNull()
        expect(graffitiFilePath(lighthouse({ volumes: ["/opt/st'ereum:/opt/app/graffitis"] }))).toBeNull()
    })
})

describe('parseGraffitiFile', () => {
    it('reads the default and per-key lines, lowercasing keys', () => {
        const parsed = parseGraffitiFile(`default: Stereum\n${PK_A.toUpperCase().replace('0X', '0x')}: mine\n`)
        expect(parsed.default).toBe('Stereum')
        expect(parsed.keys[PK_A]).toBe('mine')
    })

    it('splits at the first colon only', () => {
        expect(parseGraffitiFile(`${PK_A}: a: b`).keys[PK_A]).toBe('a: b')
    })

    it('handles a missing or empty file', () => {
        expect(parseGraffitiFile('')).toEqual({ default: null, keys: {} })
        expect(parseGraffitiFile(undefined)).toEqual({ default: null, keys: {} })
    })
})

describe('graffitiFromFile', () => {
    it('prefers the key line, then the default, then null', () => {
        const parsed = parseGraffitiFile(`default: d\n${PK_A}: a\n`)
        expect(graffitiFromFile(parsed, PK_A)).toBe('a')
        expect(graffitiFromFile(parsed, PK_B)).toBe('d')
        expect(graffitiFromFile(parseGraffitiFile(''), PK_B)).toBeNull()
    })
})

describe('updateGraffitiFile', () => {
    it('replaces an existing key line in place and keeps everything else', () => {
        const next = updateGraffitiFile(`default: d\n${PK_A}: old\n# note\n`, new Map([[PK_A, 'new']]))
        expect(next).toBe(`default: d\n${PK_A}: new\n# note\n`)
    })

    it('appends a key that had no line', () => {
        expect(updateGraffitiFile('default: d\n', new Map([[PK_B, 'b']]))).toBe(`default: d\n${PK_B}: b\n`)
    })

    it('removes a key on null and leaves the default for it', () => {
        expect(updateGraffitiFile(`default: d\n${PK_A}: a\n`, new Map([[PK_A, null]]))).toBe('default: d\n')
    })

    it('drops blank lines, which make Lighthouse reject the whole file', () => {
        expect(updateGraffitiFile(`default: d\n\n\n${PK_A}: a\n`, new Map())).toBe(`default: d\n${PK_A}: a\n`)
    })

    it('collapses a key listed twice to one line', () => {
        const next = updateGraffitiFile(`${PK_A}: one\n${PK_A}: two\n`, new Map([[PK_A, 'x']]))
        expect(next).toBe(`${PK_A}: x\n`)
    })

    it('matches existing lines case-insensitively', () => {
        const upper = '0x' + 'A'.repeat(96)
        expect(updateGraffitiFile(`${upper}: a\n`, new Map([[PK_A, 'b']]))).toBe(`${PK_A}: b\n`)
    })

    it('yields an empty file when nothing is left', () => {
        expect(updateGraffitiFile(`${PK_A}: a\n`, new Map([[PK_A, null]]))).toBe('')
    })
})

describe('commands', () => {
    it('quotes the path and never carries the content', () => {
        const path = '/opt/stereum/x/graffitis/graffitis.yaml'
        expect(buildGraffitiReadCommand(path)).toBe(`cat '${path}' 2>/dev/null || true`)
        const { mkdir, write } = buildGraffitiWriteCommands(path)
        expect(mkdir).toBe(`mkdir -p '/opt/stereum/x/graffitis'`)
        expect(write).toBe(`tee '${path}' > /dev/null`)
    })
})
