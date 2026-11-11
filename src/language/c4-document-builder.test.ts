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
import type { FileSystemProvider, LangiumDocument } from 'langium';
import { URI } from 'vscode-uri';
import { createC4Services } from './c4-module';

const INCLUDING = 'file:///ws/including.dsl';
const OTHER = 'file:///ws/other.dsl';
const TARGET = 'https://example.com/fragment.dsl';

const INCLUDING_CONTENT = `workspace {

    model {
        !include https://example.com/fragment.dsl
    }

}
`;

const OTHER_CONTENT = `workspace {

    model {
        other = softwareSystem "Other"
    }

}
`;

const TARGET_CONTENT = `fragment = softwareSystem "Fragment"
`;

/** In-memory file system: the keys of `files` are the file contents by URI. */
function memoryFileSystem(files: Record<string, string>): FileSystemProvider {
    const notFound = (key: string) => {
        const error: any = new Error(`ENOENT: ${key}`);
        error.code = 'ENOENT';
        return error;
    };
    const provider = {
        async readFile(uri: URI) {
            const key = uri.toString();
            const content = files[key];
            if (content === undefined) throw notFound(key);
            return content;
        },
        async readDirectory(uri: URI) {
            const prefix = uri.toString().replace(/\/$/, '') + '/';
            return Object.keys(files)
                .filter((key) => key.startsWith(prefix) && !key.slice(prefix.length).includes('/'))
                .map((key) => ({ uri: URI.parse(key), isFile: true, isDirectory: false }));
        },
        async stat(uri: URI) {
            return { uri, isFile: files[uri.toString()] !== undefined, isDirectory: false };
        },
        async exists(uri: URI) {
            return files[uri.toString()] !== undefined;
        }
    };
    return provider as unknown as FileSystemProvider;
}

function messages(document: LangiumDocument): string[] {
    return (document.diagnostics ?? []).map((diagnostic) =>
        typeof diagnostic.message === 'string' ? diagnostic.message : diagnostic.message.value
    );
}

describe('include discovery', () => {
    it('loads the includes of documents indexed by the workspace scan', async () => {
        const services = createC4Services({
            connection: undefined as any,
            fileSystemProvider: () => memoryFileSystem({
                [INCLUDING]: INCLUDING_CONTENT,
                [OTHER]: OTHER_CONTENT,
                [TARGET]: TARGET_CONTENT
            })
        }).C4;

        // The documents are indexed as after the workspace scan, and the update
        // arrives for another file: scanning a document must not depend on it
        // being part of the call that triggered the build phases.
        const documents = services.shared.workspace.LangiumDocuments;
        const factory = services.shared.workspace.LangiumDocumentFactory;
        const including = factory.fromString(INCLUDING_CONTENT, URI.parse(INCLUDING));
        const other = factory.fromString(OTHER_CONTENT, URI.parse(OTHER));
        documents.addDocument(including);
        documents.addDocument(other);

        const builder = services.shared.workspace.DocumentBuilder;
        await builder.update([URI.parse(OTHER)], []);

        expect(documents.hasDocument(URI.parse(TARGET))).toBe(true);
        expect(messages(including).join(' ')).not.toContain('could not be found');
    });
});
