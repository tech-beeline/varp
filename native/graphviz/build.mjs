import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const wasm = !process.argv.includes('--native');
const buildDir = join(root, wasm ? 'build-wasm' : 'build');

function run(command, args, env = process.env) {
    const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', shell: false, env });
    if (result.error) {
        console.error(`${command}: ${result.error.message}`);
        process.exit(1);
    }
    if (result.status !== 0) process.exit(result.status ?? 1);
}

/**
 * emcc.bat starts the compiler driver with %EMSDK_PYTHON% and falls back to a bare
 * "python" from PATH. The configure step exports the interpreter installed by
 * emsdk into the cache, and the build step needs the same value in its environment.
 */
function emsdkPython() {
    const cache = readFileSync(join(buildDir, 'CMakeCache.txt'), 'utf8');
    const match = /^EMSDK_PYTHON:FILEPATH=(.+)$/m.exec(cache);
    return match === null ? undefined : match[1].trim();
}

mkdirSync(buildDir, { recursive: true });

const generator = process.platform === 'win32' ? ['-G', 'MinGW Makefiles'] : [];
const configure = ['-S', root, '-B', buildDir, '-DCMAKE_BUILD_TYPE=Release', ...generator];
if (wasm) configure.push('-DVARP_GRAPHVIZ_WASM=ON');

run('cmake', configure);

const env = { ...process.env };
if (wasm) {
    const python = emsdkPython();
    if (python !== undefined) env.EMSDK_PYTHON = python;
}
run('cmake', ['--build', buildDir, '--parallel'], env);

if (wasm) {
    const declaration = 'const createGraphvizLayout: (options?: Record<string, unknown>) => Promise<any>;\nexport default createGraphvizLayout;\n';
    writeFileSync(join(buildDir, 'graphviz-layout.node.d.ts'), declaration);
    writeFileSync(join(buildDir, 'graphviz-layout.web.d.ts'), declaration);
}
