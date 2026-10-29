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

import { describe, it, expect } from 'vitest';
import type { FileSystemNode, FileSystemProvider } from 'langium';
import { URI } from 'vscode-uri';
import { createC4Services } from './c4-module';

const FOLDER = 'file:///ws';
const WORKSPACE_URI = 'file:///ws/workspace.dsl';
const CONTENT = 'workspace { model { a = softwareSystem "A" } }';

/** A file system provider serving a single workspace.dsl file inside one folder. */
class SingleFileSystem implements FileSystemProvider {
    private node(uri: URI, isDirectory: boolean): FileSystemNode {
        return { isFile: !isDirectory, isDirectory, uri };
    }
    async stat(uri: URI): Promise<FileSystemNode> {
        return this.statSync(uri);
    }
    statSync(uri: URI): FileSystemNode {
        const s = uri.toString();
        if (s === WORKSPACE_URI) return this.node(uri, false);
        if (s === FOLDER || s === FOLDER + '/') return this.node(uri, true);
        throw new Error(`not found: ${s}`);
    }
    async exists(uri: URI): Promise<boolean> {
        return this.existsSync(uri);
    }
    existsSync(uri: URI): boolean {
        const s = uri.toString();
        return s === WORKSPACE_URI || s === FOLDER || s === FOLDER + '/';
    }
    async readBinary(): Promise<Uint8Array> {
        return new TextEncoder().encode(CONTENT);
    }
    readBinarySync(): Uint8Array {
        return new TextEncoder().encode(CONTENT);
    }
    async readFile(uri: URI): Promise<string> {
        if (uri.toString() !== WORKSPACE_URI) throw new Error(`not a file: ${uri.toString()}`);
        return CONTENT;
    }
    readFileSync(uri: URI): string {
        if (uri.toString() !== WORKSPACE_URI) throw new Error(`not a file: ${uri.toString()}`);
        return CONTENT;
    }
    async readDirectory(uri: URI): Promise<FileSystemNode[]> {
        if (uri.toString() !== FOLDER && uri.toString() !== FOLDER + '/') return [];
        return [this.node(URI.parse(WORKSPACE_URI), false)];
    }
    readDirectorySync(uri: URI): FileSystemNode[] {
        return this.readDirectorySyncImpl(uri);
    }
    private readDirectorySyncImpl(uri: URI): FileSystemNode[] {
        if (uri.toString() !== FOLDER && uri.toString() !== FOLDER + '/') return [];
        return [this.node(URI.parse(WORKSPACE_URI), false)];
    }
}

describe('createC4Services initial workspace build', () => {
    it('generates JSON for loaded workspaces without opening a file', async () => {
        const services = createC4Services({ connection: undefined as any, fileSystemProvider: () => new SingleFileSystem() });
        const generated = new Promise<void>((resolve) => {
            services.C4.generation.C4GeneratorHandler.onJsonGenerated = (uri) => {
                if (uri === WORKSPACE_URI) resolve();
            };
        });

        services.shared.workspace.WorkspaceManager.initialize({ workspaceFolders: [{ uri: FOLDER, name: 'ws' }] } as any);
        await services.shared.workspace.WorkspaceManager.initialized({} as any);
        await generated;

        expect(services.C4.generation.C4GeneratorHandler.getCachedUris()).toContain(WORKSPACE_URI);
    }, 30_000);
});
