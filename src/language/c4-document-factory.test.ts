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
import { EmptyFileSystem } from 'langium';
import { URI, Utils } from 'vscode-uri';
import { createC4Services } from './c4-module';
import { stripBom } from './c4-document-factory';

const PROJECT = URI.parse('file:///project/');

/** Builds a fresh service container with the given virtual .dsl files. */
async function createProject(files: Record<string, string>) {
    const services = createC4Services({ connection: undefined as any, ...EmptyFileSystem }).C4;
    const docs = Object.entries(files).map(([name, content]) => {
        const uri = Utils.resolvePath(PROJECT, name);
        const doc = services.shared.workspace.LangiumDocumentFactory.fromString(content, uri);
        services.shared.workspace.LangiumDocuments.addDocument(doc);
        return doc;
    });
    await services.shared.workspace.DocumentBuilder.build(docs);
    return { services, docs };
}

function rootOf(services: Awaited<ReturnType<typeof createProject>>['services'], name: string) {
    const uri = Utils.resolvePath(PROJECT, name);
    return services.shared.workspace.LangiumDocuments.getDocument(uri)?.parseResult.value;
}

describe('C4LangiumDocumentFactory (UTF-8 BOM handling)', () => {
    it('strips a single leading BOM and is idempotent', () => {
        expect(stripBom('\uFEFFworkspace {')).toBe('workspace {');
        expect(stripBom('workspace {')).toBe('workspace {');
        expect(stripBom('')).toBe('');
    });

    it('parses a BOM-prefixed workspace file as a Workspace (not an ArchetypeInstance)', async () => {
        const { services } = await createProject({
            'workspace-with-bom.dsl': '\uFEFFworkspace "Getting Started" "This is a model." {\n}\n',
        });
        const root = rootOf(services, 'workspace-with-bom.dsl') as any;
        expect(root).toBeDefined();
        // Without BOM stripping the lexer glues "\uFEFF" to "workspace", which parses
        // as an ArchetypeInstance and produces "Could not resolve reference to
        // ArchetypeDefinition named '\uFEFFworkspace'". The grammar entry rule is
        // C4Document, so the discriminator is the single Workspace inside it.
        expect(root?.$type).toBe('C4Document');
        expect(root?.workspaces?.length).toBe(1);
        expect(root?.workspaces[0].$type).toBe('Workspace');
        // Note: this grammar stores STRING values including their surrounding quotes.
        expect(root?.workspaces[0].name).toBe('"Getting Started"');
    });

    it('parses a BOM-prefixed fragment without lexer/parser errors', async () => {
        const { services } = await createProject({
            'workspace-with-bom-model.dsl': '\uFEFFmodel {\n}\n',
        });
        const doc = services.shared.workspace.LangiumDocuments.getDocument(
            Utils.resolvePath(PROJECT, 'workspace-with-bom-model.dsl'),
        );
        expect(doc).toBeDefined();
        expect(doc?.parseResult.lexerErrors).toHaveLength(0);
        expect(doc?.parseResult.parserErrors).toHaveLength(0);
    });

    it('resolves references in a BOM-prefixed workspace + included fragment', async () => {
        const { services } = await createProject({
            'workspace-with-bom.dsl': '\uFEFFworkspace "Getting Started" {\n    !include "workspace-with-bom-model.dsl"\n    views {\n        systemContext softwareSystem "SystemContext" "desc" {\n            include *\n        }\n    }\n}\n',
            'workspace-with-bom-model.dsl': '\uFEFFmodel {\n    softwareSystem = softwareSystem "Software System" "My software system, code-named \\"X\\"."\n}\n',
        });
        const doc = services.shared.workspace.LangiumDocuments.getDocument(
            Utils.resolvePath(PROJECT, 'workspace-with-bom.dsl'),
        );
        const modelDoc = services.shared.workspace.LangiumDocuments.getDocument(
            Utils.resolvePath(PROJECT, 'workspace-with-bom-model.dsl'),
        );
        // The workspace root must contain a real Workspace, not an ArchetypeInstance,
        // and neither document may report lexer/parser errors.
        const root = doc?.parseResult.value as any;
        expect(root?.$type).toBe('C4Document');
        expect(root?.workspaces?.length).toBe(1);
        expect(root?.workspaces[0].$type).toBe('Workspace');
        expect(doc?.parseResult.lexerErrors).toHaveLength(0);
        expect(doc?.parseResult.parserErrors).toHaveLength(0);
        expect(modelDoc?.parseResult.lexerErrors).toHaveLength(0);
        expect(modelDoc?.parseResult.parserErrors).toHaveLength(0);
    });
});
