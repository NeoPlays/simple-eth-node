import { ref } from 'vue'

/**
 * The OS's language/region preferences, for Intl formatting.
 *
 * Fetched once per renderer and shared: the value is module-level, so every caller gets the same
 * ref and the IPC happens a single time. It starts undefined, meaning "use Intl's own default",
 * and components read it inside computeds - so the moment the OS answer lands, every rendered
 * date reformats itself without any component needing to await anything.
 */
const locales = ref(undefined)
let requested = false

export function useLocale() {
    if (!requested) {
        requested = true
        Promise.resolve(window.api?.invoke('get-system-locale'))
            .then((list) => { if (Array.isArray(list) && list.length) locales.value = list })
            .catch(() => { /* leave undefined: Intl's default is the correct fallback */ })
    }
    return { locales }
}
