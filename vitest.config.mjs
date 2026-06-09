import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

export default defineConfig({
    plugins: [vue()],
    resolve: {
        alias: {
            '@main': resolve('src/main'),
            '@renderer': resolve('src/renderer/src'),
            '@stores': resolve('src/renderer/src/stores'),
            '@components': resolve('src/renderer/src/components'),
            '@views': resolve('src/renderer/src/views'),
        }
    },
    test: {
        environment: 'happy-dom',
        globals: true,
        include: ['tests/**/*.test.js'],
        coverage: {
            provider: 'v8',
            reporter: ['text', 'html', 'lcov', 'json-summary', 'json'],
            reportOnFailure: true,
            include: ['src/main/**/*.js', 'src/renderer/src/stores/**/*.js'],
            exclude: ['src/main/index.js'],
        },
    }
})
