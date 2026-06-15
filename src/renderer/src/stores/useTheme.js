import { defineStore } from 'pinia'

const STORAGE_KEY = 'stereum-lite:theme'
const VALID = new Set(['dark', 'light'])

function readInitial() {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (VALID.has(stored)) return stored
    if (window.matchMedia?.('(prefers-color-scheme: light)').matches) return 'light'
    return 'dark'
}

function apply(theme) {
    document.documentElement.dataset.theme = theme
}

export const useThemeStore = defineStore('theme', {
    state: () => ({ theme: 'dark' }),
    actions: {
        init() {
            this.theme = readInitial()
            apply(this.theme)
        },
        set(theme) {
            if (!VALID.has(theme)) return
            this.theme = theme
            localStorage.setItem(STORAGE_KEY, theme)
            apply(theme)
        },
        toggle() {
            this.set(this.theme === 'dark' ? 'light' : 'dark')
        },
    },
})
