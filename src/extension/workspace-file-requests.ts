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

import { base64EncodeBytes } from '../language/c4-base64';

/**
 * The subset of vscode.workspace.fs the request handlers use, kept structural so the
 * handlers can be unit tested without the vscode module.
 */
export interface WorkspaceFileSystem {
	readFile(uri: any): Thenable<Uint8Array>;
	readDirectory(uri: any): Thenable<[string, number][]>;
	stat(uri: any): Thenable<{ type: number }>;
}

/** Handlers for the `c4/read*` requests the web language server sends to this host. */
export interface WorkspaceFileRequestHandlers {
	readFile(params: { uri: string }): Promise<string>;
	readBinary(params: { uri: string }): Promise<string>;
	readDirectory(params: { uri: string }): Promise<{ name: string; type: number }[]>;
	stat(params: { uri: string }): Promise<number>;
	exists(params: { uri: string }): Promise<boolean>;
}

/**
 * Maps vscode.workspace.fs to the language server's workspace file requests. Binary
 * content is base64 encoded and file types are returned as vscode.FileType numbers,
 * because LSP JSON cannot carry byte arrays or enums. The file system and URI parser
 * are injected so this can run (and be tested) outside the vscode module.
 */
export function createWorkspaceFileRequestHandlers(
	fs: WorkspaceFileSystem,
	parseUri: (value: string) => any
): WorkspaceFileRequestHandlers {
	return {
		readFile: async ({ uri }) => new TextDecoder().decode(await fs.readFile(parseUri(uri))),

		readBinary: async ({ uri }) => base64EncodeBytes(await fs.readFile(parseUri(uri))),

		readDirectory: async ({ uri }) =>
			(await fs.readDirectory(parseUri(uri))).map(([name, type]) => ({ name, type })),

		stat: async ({ uri }) => (await fs.stat(parseUri(uri))).type,

		exists: async ({ uri }) => {
			try {
				await fs.stat(parseUri(uri));
				return true;
			} catch {
				return false;
			}
		}
	};
}
