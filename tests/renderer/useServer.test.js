import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useServerStore } from '@stores/useServer'

describe('useServerStore', () => {
    let invoke
    beforeEach(() => {
        setActivePinia(createPinia())
        invoke = vi.fn()
        globalThis.window = { api: { invoke } }
    })

    it('initial state has empty server list and blank credentials', () => {
        const s = useServerStore()
        expect(s.server).toEqual([])
        expect(s.credentials).toEqual({
            name: '', host: '', port: 22, username: '', password: '', privateKey: '', passphrase: ''
        })
    })

    it('getServer pulls from store-get and assigns to state', async () => {
        invoke.mockResolvedValueOnce([{ name: 'srv' }])
        const s = useServerStore()
        await s.getServer()
        expect(invoke).toHaveBeenCalledWith('store-get', 'server')
        expect(s.server).toEqual([{ name: 'srv' }])
    })

    it('setServer writes then re-reads from store', async () => {
        invoke.mockResolvedValueOnce(undefined).mockResolvedValueOnce([{ name: 'after' }])
        const s = useServerStore()
        await s.setServer([{ name: 'new' }])
        expect(invoke).toHaveBeenNthCalledWith(1, 'store-set', 'server', [{ name: 'new' }])
        expect(invoke).toHaveBeenNthCalledWith(2, 'store-get', 'server')
        expect(s.server).toEqual([{ name: 'after' }])
    })

    it('setCredentials deep-clones the input (mutating source does not affect state)', () => {
        const s = useServerStore()
        const input = { name: 'a', host: 'h', port: 22, username: 'u', password: '', privateKey: '', passphrase: '' }
        s.setCredentials(input)
        input.name = 'mutated'
        expect(s.credentials.name).toBe('a')
    })

    it('clearCredentials resets to blank defaults', () => {
        const s = useServerStore()
        s.credentials = { name: 'x', host: 'h', port: 99, username: 'u', password: 'p', privateKey: 'k', passphrase: 'pp' }
        s.clearCredentials()
        expect(s.credentials).toEqual({
            name: '', host: '', port: 22, username: '', password: '', privateKey: '', passphrase: ''
        })
    })
})
