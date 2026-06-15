import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
    main: {
        resolve: {
            alias: {
                '@main': resolve('src/main')
            }
        },
        plugins: [externalizeDepsPlugin()]
    },
    preload: {
        plugins: [externalizeDepsPlugin()]
    },
    renderer: {
        resolve: {
            alias: {
                '@renderer': resolve('src/renderer/src'),
                '@stores': resolve('src/renderer/src/stores'),
                '@components': resolve('src/renderer/src/components'),
                '@views': resolve('src/renderer/src/views'),
                '@utils': resolve('src/renderer/src/utils'),
            }
        },
        plugins: [vue()]
    }
})
