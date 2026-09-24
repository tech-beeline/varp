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

import { Utils } from 'vscode-uri';
import { base64DecodeToBytes } from './c4-base64';

// vscode.FileType values, mirrored here because the web language server has no
// access to the vscode API. FileType is a bit mask, so a symbolic link to a file is
// File | SymbolicLink (1 | 64).
const FILE_TYPE_FILE = 1;
const FILE_TYPE_DIRECTORY = 2;

const isFileType = (type: number) => (type & FILE_TYPE_FILE) !== 0;
const isDirectoryType = (type: number) => (type & FILE_TYPE_DIRECTORY) !== 0;

/** The `c4/*` requests the web language server sends to the extension host. */
export interface ClientFileSystemRequests {
	readBinary(uri: string): Promise<string>;
	readDirectory(uri: string): Promise<{ name: string; type: number }[]>;
	stat(uri: string): Promise<number>;
	exists(uri: string): Promise<boolean>;
}

/**
 * Wires a browser provider to the extension host, which is the only side that can
 * reach the workspace there (vscode.workspace.fs). Binary content travels as base64
 * and file types carry the vscode.FileType value, both because LSP JSON cannot carry
 * byte arrays or enums. Binary reads use the standard FileSystemProvider.readBinary,
 * which NodeFileSystem already implements on the desktop.
 */
export function withClientFileSystem(provider: any, requests: ClientFileSystemRequests): any {
	provider.readBinary = async (uri: any): Promise<Uint8Array> =>
		base64DecodeToBytes(await requests.readBinary(uri.toString()));

	provider.readDirectory = async (uri: any) => {
		const entries = await requests.readDirectory(uri.toString());
		return entries.map((entry) => ({
			uri: Utils.joinPath(uri, entry.name),
			isFile: isFileType(entry.type),
			isDirectory: isDirectoryType(entry.type)
		}));
	};

	provider.stat = async (uri: any) => {
		const type = await requests.stat(uri.toString());
		return { uri, isFile: isFileType(type), isDirectory: isDirectoryType(type) };
	};

	provider.exists = async (uri: any): Promise<boolean> => {
		try {
			return await requests.exists(uri.toString());
		} catch {
			return false;
		}
	};

	return provider;
}

/**
 * Langium's FileSystemProvider also declares synchronous methods, which cannot be
 * forwarded over the asynchronous LSP bridge. They are overridden with a clear error
 * instead of the base provider's generic "No file system is available.", so a future
 * caller fails loudly with the real reason. Langium's document lifecycle only uses
 * the asynchronous methods, so nothing calls these in the web language server today.
 */
export function withUnsupportedSyncMethods(provider: any): any {
	const unsupported = (method: string) => (): never => {
		throw new Error(`${method} is not supported in the web language server: the file system is reached asynchronously over LSP.`);
	};

	provider.statSync = unsupported('statSync');
	provider.readFileSync = unsupported('readFileSync');
	provider.readDirectorySync = unsupported('readDirectorySync');
	provider.existsSync = unsupported('existsSync');
	provider.readBinarySync = unsupported('readBinarySync');

	return provider;
}
