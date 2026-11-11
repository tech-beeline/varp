/*
	Copyright 2026 VimpelCom PJSC

	Licensed under the Apache License, Version 2.0 (the "License");
	you may not use this file except in compliance with the License.
	You may obtain a copy of the License at

		http://www.apache.org/licenses/LICENSE-2.0

	Unless required by applicable law or agreed to in writing, software
	distributed under the License is distributed on an "AS IS" BASIS,
	WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
	See the License for the specific language governing permissions and
	limitations under the License.
*/

/**
 * Minimal `process` for the browser bundles, injected by esbuild.
 *
 * Node-oriented dependencies reach for it even when they are bundled for the web
 * (stream/ixtick scheduling, version and platform checks), but the web extension
 * host does not define it. Only the members those dependencies actually use are
 * provided.
 */
export const process = {
    browser: true,
    env: { NODE_ENV: 'production' } as Record<string, string | undefined>,
    platform: 'browser',
    version: '',
    versions: {} as Record<string, string>,
    cwd: () => '/',
    nextTick: (callback: (...args: unknown[]) => void, ...args: unknown[]): void => {
        setTimeout(callback, 0, ...args);
    },
    stdout: { write: () => true },
    stderr: { write: () => true },
};
