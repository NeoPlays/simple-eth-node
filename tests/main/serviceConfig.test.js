import { describe, it, expect } from 'vitest'
import { isServiceId, checkServiceConfig, parseBackupRead, buildBackupCommand } from '@main/nodes/serviceConfig'

describe('checkServiceConfig', () => {
    const ID = 'aaaaaaaa-0000-0000-0000-aaaaaaaaaaaa'

    it('accepts a normal config', () => {
        expect(checkServiceConfig(`id: ${ID}\nservice: GethService\ncommand:\n  - --http\n`, ID)).toEqual([])
    })

    it('refuses unparseable YAML with the parser message', () => {
        const [problem] = checkServiceConfig('command:\n  - a\n - b\n', ID)
        expect(problem).toMatch(/^Not valid YAML/)
    })

    it('refuses a non-mapping, a missing service, and a changed id', () => {
        expect(checkServiceConfig('- a\n- b\n', ID)[0]).toMatch(/mapping/)
        expect(checkServiceConfig('', ID)[0]).toMatch(/mapping/)
        expect(checkServiceConfig(`id: ${ID}\n`, ID)).toEqual(['The "service" field is missing'])
        expect(checkServiceConfig('id: other\nservice: X\n', ID)[0]).toMatch(/must stay/)
    })
})

describe('service ids and backups', () => {
    it('allows only plain ids', () => {
        expect(isServiceId('aaaaaaaa-0000-0000-0000-aaaaaaaaaaaa')).toBe(true)
        expect(isServiceId('../etc')).toBe(false)
        expect(isServiceId("a'b")).toBe(false)
        expect(isServiceId('')).toBe(false)
    })

    it('keeps backups outside the services folder', () => {
        expect(buildBackupCommand('abc')).toContain('/etc/stereum-lite/config-backups/abc.yaml')
        expect(buildBackupCommand('abc')).not.toMatch(/services\/abc\.yaml\.bak/)
    })

    it('parses a backup read', () => {
        expect(parseBackupRead('5\nx: 1\n')).toEqual({ exists: true, savedAt: 5, content: 'x: 1\n' })
        expect(parseBackupRead('')).toEqual({ exists: false })
        expect(parseBackupRead('garbage\nx')).toEqual({ exists: false })
    })
})
