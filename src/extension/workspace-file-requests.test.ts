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

import { describe, expect, it } from 'vitest';
import { createWorkspaceFileRequestHandlers, type WorkspaceFileSystem } from './workspace-file-requests';

/** A tiny in-memory vscode.workspace.fs replacement, keyed by the raw URI string. */
function fakeFileSystem(files: Record<string, Uint8Array>, directories: Record<string, [string, number][]>): WorkspaceFileSystem {
	return {
		readFile: async (uri: any) => {
			const file = files[uri];
			if (!file) throw new Error(`no file: ${uri}`);
			return file;
		},
		readDirectory: async (uri: any) => {
			const entries = directories[uri];
			if (!entries) throw new Error(`no directory: ${uri}`);
			return entries;
		},
		stat: async (uri: any) => {
			if (directories[uri]) return { type: 2 };
			if (files[uri]) return { type: 1 };
			throw new Error(`missing: ${uri}`);
		}
	};
}

describe('createWorkspaceFileRequestHandlers', () => {
	const fs = fakeFileSystem(
		{
			'vscode-vfs://host/docs/01.md': new TextEncoder().encode('# Title\n\nBody'),
			'vscode-vfs://host/docs/logo.svg': new Uint8Array([1, 2, 3, 250])
		},
		{ 'vscode-vfs://host/docs': [['01.md', 1], ['logo.svg', 1], ['nested', 2]] }
	);
	const handlers = createWorkspaceFileRequestHandlers(fs, (value) => value);

	it('reads text as UTF-8', async () => {
		expect(await handlers.readFile({ uri: 'vscode-vfs://host/docs/01.md' })).toBe('# Title\n\nBody');
	});

	it('returns binary content as base64', async () => {
		expect(await handlers.readBinary({ uri: 'vscode-vfs://host/docs/logo.svg' })).toBe('AQID+g==');
	});

	it('returns directory entries with their file type', async () => {
		expect(await handlers.readDirectory({ uri: 'vscode-vfs://host/docs' })).toEqual([
			{ name: '01.md', type: 1 },
			{ name: 'logo.svg', type: 1 },
			{ name: 'nested', type: 2 }
		]);
	});

	it('returns the file type and reports existence', async () => {
		expect(await handlers.stat({ uri: 'vscode-vfs://host/docs' })).toBe(2);
		expect(await handlers.stat({ uri: 'vscode-vfs://host/docs/01.md' })).toBe(1);
		expect(await handlers.exists({ uri: 'vscode-vfs://host/docs/01.md' })).toBe(true);
		expect(await handlers.exists({ uri: 'vscode-vfs://host/docs/missing.md' })).toBe(false);
	});
});
