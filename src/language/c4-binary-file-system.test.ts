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
import { URI } from 'vscode-uri';
import { base64DecodeToBytes, base64EncodeBytes } from './c4-base64';
import { withClientFileSystem, withUnsupportedSyncMethods } from './c4-binary-file-system';

describe('c4-base64', () => {
	it('round-trips byte arrays of every padding length', () => {
		for (const length of [0, 1, 2, 3, 4, 5, 17, 256]) {
			const bytes = new Uint8Array(Array.from({ length }, (_, i) => (i * 37 + 11) & 0xff));
			expect(base64DecodeToBytes(base64EncodeBytes(bytes))).toEqual(bytes);
		}
	});

	it('encodes known values like Node does', () => {
		expect(base64EncodeBytes(new Uint8Array([0x66, 0x6f, 0x6f]))).toBe('Zm9v');
		expect(base64EncodeBytes(new Uint8Array([0x66, 0x6f]))).toBe('Zm8=');
		expect(base64EncodeBytes(new Uint8Array([0x66]))).toBe('Zg==');
	});
});

describe('c4-binary-file-system: client bridge', () => {
	it('decodes base64 binary content from the extension host', async () => {
		const provider = withClientFileSystem({}, {
			readBinary: async () => base64EncodeBytes(new Uint8Array([1, 2, 3, 250])),
			readDirectory: async () => [],
			stat: async () => 1,
			exists: async () => true
		});

		expect(await provider.readBinary(URI.parse('vscode-vfs://host/docs/a.png'))).toEqual(new Uint8Array([1, 2, 3, 250]));
	});

	it('maps directory entries to file system nodes', async () => {
		const provider = withClientFileSystem({}, {
			readBinary: async () => '',
			readDirectory: async () => [
				{ name: 'diagram.png', type: 1 },
				{ name: 'nested', type: 2 },
				{ name: 'link', type: 64 },
				{ name: 'link-to-file', type: 65 },
				{ name: 'link-to-dir', type: 66 }
			],
			stat: async () => 1,
			exists: async () => true
		});

		const nodes = await provider.readDirectory(URI.parse('vscode-vfs://host/docs'));
		expect(nodes.map((node: any) => [node.uri.toString(), node.isFile, node.isDirectory])).toEqual([
			['vscode-vfs://host/docs/diagram.png', true, false],
			['vscode-vfs://host/docs/nested', false, true],
			['vscode-vfs://host/docs/link', false, false],
			// vscode.FileType is a bit mask: a symbolic link keeps its target's bit.
			['vscode-vfs://host/docs/link-to-file', true, false],
			['vscode-vfs://host/docs/link-to-dir', false, true]
		]);
	});

	it('maps a file type to a file system node', async () => {
		const provider = withClientFileSystem({}, {
			readBinary: async () => '',
			readDirectory: async () => [],
			stat: async () => 2,
			exists: async () => true
		});

		const node = await provider.stat(URI.parse('vscode-vfs://host/docs'));
		expect(node.uri.toString()).toBe('vscode-vfs://host/docs');
		expect(node.isDirectory).toBe(true);
		expect(node.isFile).toBe(false);
	});

	it('rejects synchronous access with a clear error', () => {
		const provider = withUnsupportedSyncMethods({});
		for (const method of ['statSync', 'readFileSync', 'readDirectorySync', 'existsSync', 'readBinarySync']) {
			expect(() => provider[method](URI.parse('vscode-vfs://host/docs'))).toThrow(/not supported in the web language server/);
		}
	});

	it('reports existence and treats a failed stat as missing', async () => {
		const found = withClientFileSystem({}, {
			readBinary: async () => '',
			readDirectory: async () => [],
			stat: async () => 1,
			exists: async () => true
		});
		expect(await found.exists(URI.parse('vscode-vfs://host/docs'))).toBe(true);

		const missing = withClientFileSystem({}, {
			readBinary: async () => '',
			readDirectory: async () => [],
			stat: async () => 1,
			exists: async () => { throw new Error('not found'); }
		});
		expect(await missing.exists(URI.parse('vscode-vfs://host/docs'))).toBe(false);
	});
});
