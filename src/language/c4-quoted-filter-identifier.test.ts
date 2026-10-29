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
import { isFilterExpression, parseQuotedFilterText } from './c4-quoted-filter';
import { isWorkspace } from '../generated/ast';

const MODEL = `    model {
        s = softwareSystem "S"
        a = softwareSystem "A"
        b = softwareSystem "B"
        s -> a "uses"
        a -> b "uses"
    }`;

const DSL = (viewBody: string) => `workspace {
${MODEL}
    views {
${viewBody}
    }
}
`;

async function build(viewBody: string) {
    const services = createC4Services({ connection: undefined as any, ...EmptyFileSystem }).C4;
    const doc = services.shared.workspace.LangiumDocumentFactory.fromString(DSL(viewBody), URI.parse('file:///quoted-identifier.dsl'));
    services.shared.workspace.LangiumDocuments.addDocument(doc);
    await services.shared.workspace.DocumentBuilder.build([doc], { validation: true });
    const diagnostics = (doc.diagnostics ?? []).map(d => (typeof d.message === 'string' ? d.message : d.message.value));
    const root: any = doc.parseResult.value;
    const workspace = isWorkspace(root) ? root : root.workspaces[0];
    const json: any = await new C4JsonGenerator(services).generate(workspace);
    return { diagnostics, json, services };
}

describe('quoted filters without an expression prefix', () => {
    it('reads the text as one identifier instead of an operator expression', async () => {
        const { services } = await build(`        systemContext s "ctx" {
            include *
        }`);
        const parsed = parseQuotedFilterText((services as any).shared, 'a && b');
        expect(parsed.identifier).toBe('a && b');
        expect(parsed.expressions).toEqual([]);

        expect(isFilterExpression('element.tag==alpha')).toBe(true);
        expect(isFilterExpression('a->b')).toBe(true);
        expect(isFilterExpression('a && b')).toBe(false);
    });

    it('reports an identifier that does not exist', async () => {
        const { diagnostics } = await build(`        systemContext s "ctx" {
            include "a && b"
        }`);
        expect(diagnostics).toContain('The element/relationship "a && b" does not exist');

        const missing = await build(`        systemContext s "ctx" {
            include "missing"
        }`);
        expect(missing.diagnostics).toContain('The element/relationship "missing" does not exist');
    });

    it('accepts an identifier that exists', async () => {
        const { diagnostics } = await build(`        systemContext s "ctx" {
            include "a"
        }`);
        expect(diagnostics).toEqual([]);
    });

    it('does not add elements for an identifier that does not exist', async () => {
        const { json } = await build(`        systemContext s "ctx" {
            include "a && b"
        }`);
        const view = json.views.systemContextViews[0];
        const names = new Map<string, string>();
        for (const group of Object.values(json.model)) {
            if (!Array.isArray(group)) continue;
            for (const element of group as any[]) names.set(element.id, element.name);
        }
        expect((view.elements ?? []).map((element: any) => names.get(element.id)).sort()).toEqual(['S']);
    });

    it('adds the referenced element for an identifier that exists', async () => {
        const { json } = await build(`        systemContext s "ctx" {
            include "a"
        }`);
        const view = json.views.systemContextViews[0];
        const names = new Map<string, string>();
        for (const group of Object.values(json.model)) {
            if (!Array.isArray(group)) continue;
            for (const element of group as any[]) names.set(element.id, element.name);
        }
        expect((view.elements ?? []).map((element: any) => names.get(element.id)).sort()).toEqual(['A', 'S']);
    });
});
