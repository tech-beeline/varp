import * as esbuild from 'esbuild';

const common = {
    bundle: true,
    minify: true,
    sourcemap: true,
    logLevel: 'info',
};

const nodeGlue = './native/graphviz/build-wasm/graphviz-layout.node.js';
const webGlue = './native/graphviz/build-wasm/graphviz-layout.web.js';

const browserAliases = {
    'events': 'events',
    'stream': 'stream-browserify',
    'crypto': 'crypto-browserify'
};

const contexts = [
    esbuild.build({
        ...common,
        entryPoints: ['src/extension/main.ts'],
        outfile: 'dist/extension.js',
        platform: 'node',
        external: ['vscode'],
        alias: { 'graphviz-layout-glue': nodeGlue }
    }),
    esbuild.build({
        ...common,
        entryPoints: ['src/language/main.ts'],
        outfile: 'dist/server.js',
        platform: 'node',
        alias: { 'graphviz-layout-glue': nodeGlue }
    }),
    esbuild.build({
        ...common,
        entryPoints: ['src/extension/main.browser.ts'],
        outfile: 'dist/extension.browser.js',
        platform: 'browser',
        external: ['vscode'],
        format: 'cjs',
        alias: { ...browserAliases, 'graphviz-layout-glue': webGlue }
    }),
    esbuild.build({
        ...common,
        entryPoints: ['src/language/main.browser.ts'],
        outfile: 'dist/server.browser.js',
        platform: 'browser',
        format: 'iife',
        alias: { ...browserAliases, 'graphviz-layout-glue': webGlue }
    })
];

Promise.all(contexts).catch(() => process.exit(1));
