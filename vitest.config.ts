import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
    resolve: {
        alias: {
            'graphviz-layout-glue': fileURLToPath(new URL('./native/graphviz/build-wasm/graphviz-layout.node.js', import.meta.url)),
        },
    },
    test: {
        globals: true,
        environment: 'node',
        include: ['src/**/*.test.ts'],
        testTimeout: 30000
    }
});
