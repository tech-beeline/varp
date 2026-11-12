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
import { DocumentState, type FileSystemProvider, type LangiumDocument } from 'langium';
import { URI } from 'vscode-uri';
import { TextDocument } from 'vscode-languageserver-textdocument';
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

/** Builds the services and indexes the two documents, as the workspace scan does. */
function indexDocuments(files: Record<string, string>) {
    const services = createC4Services({
        connection: undefined as any,
        fileSystemProvider: () => memoryFileSystem(files)
    }).C4;
    const documents = services.shared.workspace.LangiumDocuments;
    const factory = services.shared.workspace.LangiumDocumentFactory;
    documents.addDocument(factory.fromString(INCLUDING_CONTENT, URI.parse(INCLUDING)));
    documents.addDocument(factory.fromString(OTHER_CONTENT, URI.parse(OTHER)));
    return { services, documents, including: documents.getDocument(URI.parse(INCLUDING))! };
}

/** Builds the services and indexes a single workspace document in an in-memory file system. */
function projectDocuments(files: Record<string, string>, rootUri: URI) {
    const services = createC4Services({
        connection: undefined as any,
        fileSystemProvider: () => memoryFileSystem(files)
    }).C4;
    const documents = services.shared.workspace.LangiumDocuments;
    const factory = services.shared.workspace.LangiumDocumentFactory;
    const root = factory.fromString(files[rootUri.toString()], rootUri);
    documents.addDocument(root);
    return { services, documents, root };
}

/** Opens the given documents in the editor: their text wins over the file system. */
function openDocuments(services: any, documents: Record<string, string>) {
    const textDocuments = services.shared.workspace.TextDocuments;
    for (const [uri, text] of Object.entries(documents)) {
        textDocuments.set(TextDocument.create(uri, 'c4', 1, text));
    }
}

describe('workspace-wide diagnostics', () => {
    // The group separator is a workspace-wide model property: the fragment's
    // diagnostics change when the root document declares it, although the fragment
    // itself was not edited. The fragment is closed in the editor.
    const groupRoot = (properties: string) => `workspace {
    model {
${properties}        !include "fragment.dsl"
    }
}
`;
    const GROUP_FRAGMENT = `group "Outer" {
    group "Inner" {
        person "User"
    }
}
`;
    const GROUP_SEPARATOR = `        properties {
            structurizr.groupSeparator "/"
        }
`;
    const ROOT_URI = URI.parse('file:///ws/root.dsl');
    const FRAGMENT_URI = URI.parse('file:///ws/fragment.dsl');

    it('refreshes a closed included file when its workspace changes', async () => {
        const { services, documents, root } = projectDocuments({
            [ROOT_URI.toString()]: groupRoot(''),
            [FRAGMENT_URI.toString()]: GROUP_FRAGMENT
        }, ROOT_URI);
        openDocuments(services, { [ROOT_URI.toString()]: groupRoot('') });
        const builder = services.shared.workspace.DocumentBuilder;
        await builder.build([root], { validation: true });
        const fragment = documents.getDocument(FRAGMENT_URI)!;
        expect(messages(fragment).join(' ')).toContain('groupSeparator');

        openDocuments(services, { [ROOT_URI.toString()]: groupRoot(GROUP_SEPARATOR) });
        await builder.update([ROOT_URI], []);

        expect(messages(fragment).join(' ')).not.toContain('groupSeparator');
    });

    it('refreshes a closed workspace when an included file changes', async () => {
        const rootContent = `workspace {
    model {
        !include "fragment.dsl"
        softwareSystem "Shared"
    }
}
`;
        const { services, root } = projectDocuments({
            [ROOT_URI.toString()]: rootContent,
            [FRAGMENT_URI.toString()]: 'softwareSystem "Shared"\n'
        }, ROOT_URI);
        openDocuments(services, { [FRAGMENT_URI.toString()]: 'softwareSystem "Shared"\n' });
        const builder = services.shared.workspace.DocumentBuilder;
        await builder.build([root], { validation: true });
        expect(messages(root).join(' ')).toContain("named 'Shared' already exists");

        openDocuments(services, { [FRAGMENT_URI.toString()]: 'person "Other"\n' });
        await builder.update([FRAGMENT_URI], []);

        expect(messages(root).join(' ')).not.toContain("named 'Shared' already exists");
    });
});

describe('include discovery', () => {
    it('loads the includes of documents indexed by the workspace scan', async () => {
        // The documents are indexed as after the workspace scan, and the update
        // arrives for another file: scanning a document must not depend on it
        // being part of the call that triggered the build phases.
        const { services, documents, including } = indexDocuments({
            [INCLUDING]: INCLUDING_CONTENT,
            [OTHER]: OTHER_CONTENT,
            [TARGET]: TARGET_CONTENT
        });

        const builder = services.shared.workspace.DocumentBuilder;
        const validated: string[][] = [];
        builder.onDocumentPhase(DocumentState.Validated, (document) => {
            if (document.uri.toString() === INCLUDING) {
                validated.push(messages(document));
            }
        });

        await builder.update([URI.parse(OTHER)], []);

        expect(documents.hasDocument(URI.parse(TARGET))).toBe(true);
        expect(validated.length).toBeGreaterThan(0);
        for (const reported of validated) {
            expect(reported.join(' ')).not.toContain('could not be found');
        }
    });

    it('reports a target that is missing', async () => {
        const { services, documents, including } = indexDocuments({
            [INCLUDING]: INCLUDING_CONTENT,
            [OTHER]: OTHER_CONTENT
        });

        await services.shared.workspace.DocumentBuilder.update([URI.parse(OTHER)], []);

        expect(documents.hasDocument(URI.parse(TARGET))).toBe(false);
        expect(messages(including).join(' ')).toContain('could not be found');
    });
});
