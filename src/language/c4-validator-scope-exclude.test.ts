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
import { URI } from 'vscode-uri';
import { createC4Services } from './c4-module';
import { C4JsonGenerator } from './c4-json-generator';
import { isWorkspace } from '../generated/ast';

const MODEL = `    model {
        s = softwareSystem "S" {
            c1 = container "C1"
            c2 = container "C2"
        }
        a = softwareSystem "A"
        b = softwareSystem "B"
    }`;

async function diagnosticsFor(viewBody: string): Promise<string[]> {
    const services = createC4Services({ connection: undefined as any, ...EmptyFileSystem }).C4;
    const dsl = `workspace {
${MODEL}
    views {
${viewBody}
    }
}
`;
    const doc = services.shared.workspace.LangiumDocumentFactory.fromString(dsl, URI.parse('file:///scope-exclude.dsl'));
    services.shared.workspace.LangiumDocuments.addDocument(doc);
    await services.shared.workspace.DocumentBuilder.build([doc], { validation: true });
    return (doc.diagnostics ?? []).map(d => (typeof d.message === 'string' ? d.message : d.message.value));
}

const SCOPE_MESSAGE = "The element named 'S' cannot be removed from this view.";

describe('excluding the scope element', () => {
    it('reports an exclude that evaluates to the scoped system', async () => {
        expect(await diagnosticsFor(`        systemContext s "ctx" {
            include *
            exclude "element!=a"
        }`)).toContain(SCOPE_MESSAGE);

        expect(await diagnosticsFor(`        systemContext s "ctx" {
            include *
            exclude "s"
        }`)).toContain(SCOPE_MESSAGE);

        expect(await diagnosticsFor(`        systemContext s "ctx" {
            include *
            exclude "S"
        }`)).toContain(SCOPE_MESSAGE);

        expect(await diagnosticsFor(`        systemContext s "ctx" {
            include *
            exclude "element==s"
        }`)).toContain(SCOPE_MESSAGE);

        expect(await diagnosticsFor(`        systemContext s "ctx" {
            include *
            exclude s
        }`)).toContain(SCOPE_MESSAGE);

        expect(await diagnosticsFor(`        systemContext s "ctx" {
            include *
            exclude element!=a
        }`)).toContain(SCOPE_MESSAGE);
    });

    it('reports an exclude that combines the scoped system with other elements', async () => {
        expect(await diagnosticsFor(`        systemContext s "ctx" {
            include *
            exclude "element==a || element==s"
        }`)).toContain(SCOPE_MESSAGE);
    });

    it('accepts excludes that leave the scoped system in the view', async () => {
        expect(await diagnosticsFor(`        systemContext s "ctx" {
            include *
            exclude "a"
        }`)).toEqual([]);

        expect(await diagnosticsFor(`        systemContext s "ctx" {
            include *
            exclude "element!=s"
        }`)).toEqual([]);

        expect(await diagnosticsFor(`        systemContext s "ctx" {
            include *
            exclude "element==a && element==b"
        }`)).toEqual([]);

        // The intersection of two different elements is empty, so the scope stays.
        expect(await diagnosticsFor(`        systemContext s "ctx" {
            include *
            exclude "element==a && element==s"
        }`)).toEqual([]);
    });

    it('accepts the same excludes in views without a scope system', async () => {
        expect(await diagnosticsFor(`        systemLandscape "landscape" {
            include *
            exclude "element!=a"
        }`)).toEqual([]);

        expect(await diagnosticsFor(`        container s "containers" {
            include *
            exclude "element!=c1"
        }`)).toEqual([]);
    });
});

describe('generating a system context view with a scope exclusion', () => {
    it('keeps the scoped system in the view', async () => {
        const services = createC4Services({ connection: undefined as any, ...EmptyFileSystem }).C4;
        const dsl = `workspace {
${MODEL}
    views {
        systemContext s "ctx" {
            include *
            exclude "element!=a"
        }
    }
}
`;
        const doc = services.shared.workspace.LangiumDocumentFactory.fromString(dsl, URI.parse('file:///scope-exclude-generation.dsl'));
        services.shared.workspace.LangiumDocuments.addDocument(doc);
        await services.shared.workspace.DocumentBuilder.build([doc]);

        const root: any = doc.parseResult.value;
        const workspace = isWorkspace(root) ? root : root.workspaces[0];
        const json: any = await new C4JsonGenerator(services).generate(workspace);

        const view = json.views.systemContextViews[0];
        const names = new Map<string, string>();
        for (const group of Object.values(json.model)) {
            if (!Array.isArray(group)) continue;
            for (const element of group as any[]) names.set(element.id, element.name);
        }
        expect((view.elements ?? []).map((element: any) => names.get(element.id))).toEqual(['S']);
    });
});
