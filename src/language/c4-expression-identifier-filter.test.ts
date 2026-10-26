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
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { EmptyFileSystem, type LangiumDocument } from 'langium';
import { NodeFileSystem } from 'langium/node';
import { URI } from 'vscode-uri';
import { createC4Services } from './c4-module';
import { C4JsonGenerator } from './c4-json-generator';
import { C4JsonEnricher } from './c4-json-enricher';
import { compareJson } from './c4-json-compare';
import { isWorkspace } from '../generated/ast';

const FIXTURE = resolve(__dirname, '../../test/fixtures/filter-identifier-references');

interface GeneratedView {
    key: string;
    elements: string[];
    relationships: number;
}

async function generateFixture(): Promise<{ views: Map<string, GeneratedView>; json: any }> {
    const services = createC4Services({ connection: undefined as any, ...NodeFileSystem }).C4;
    const shared = (services as any).shared;
    const documents = readdirSync(FIXTURE)
        .filter(name => name.endsWith('.dsl'))
        .map(name => {
            const path = resolve(FIXTURE, name);
            const document = services.shared.workspace.LangiumDocumentFactory.fromString(readFileSync(path, 'utf-8'), URI.file(path));
            services.shared.workspace.LangiumDocuments.addDocument(document);
            return document;
        });
    await services.shared.workspace.DocumentBuilder.build(documents);

    const document = documents.find(doc => doc.uri.toString().endsWith('/workspace.dsl'))!;
    const root: any = document.parseResult.value;
    const workspace = isWorkspace(root) ? root : root.workspaces?.[0];
    const uri = URI.file(resolve(FIXTURE, 'workspace.dsl')).toString();

    const json: any = await new C4JsonGenerator(services).generate(workspace, uri);
    await new C4JsonEnricher(shared).enrich(uri, json);

    const names = new Map<string, string>();
    for (const group of Object.values(json.model)) {
        if (!Array.isArray(group)) continue;
        for (const element of group as any[]) {
            names.set(element.id, element.name);
            for (const container of element.containers ?? []) names.set(container.id, container.name);
        }
    }

    const views = new Map<string, GeneratedView>();
    const collect = (list: any[]) => {
        for (const view of list ?? []) {
            views.set(view.key, {
                key: view.key,
                elements: (view.elements ?? []).map((element: any) => names.get(element.id) ?? element.id).sort(),
                relationships: (view.relationships ?? []).length
            });
        }
    };
    collect(json.views?.systemContextViews);
    collect(json.views?.containerViews);
    return { views, json };
}

describe('filter references by identifier', () => {
    it('resolves elements and groups by their identifier', async () => {
        const { views } = await generateFixture();

        expect(views.get('by_id')?.elements).toEqual(['Payment Service', 'S']);
        expect(views.get('group_by_id')?.elements).toEqual(['A', 'B', 'S']);
        expect(views.get('group_by_id')?.relationships).toBe(1);
        expect(views.get('group_eq')?.elements).toEqual(['A', 'B', 'S']);
        expect(views.get('group_ne')?.elements).toEqual(['Payment Service', 'S']);
        expect(views.get('path')?.elements).toEqual(['C1']);
    });

    it('matches the JSON the reference library exports', async () => {
        const { json } = await generateFixture();
        const expected = JSON.parse(readFileSync(resolve(FIXTURE, 'expected.json'), 'utf-8'));
        expect(compareJson(json, expected)).toEqual([]);
    });
});

describe('filter reference validation', () => {
    const MODEL = `        s = softwareSystem "S"
        x = softwareSystem "Payment Service"
        g = group "Group Name" {
            a = softwareSystem "A"
        }
        group "Anon Group" {
            c = softwareSystem "C"
        }`;

    async function diagnosticsFor(filter: string): Promise<string[]> {
        const services = createC4Services({ connection: undefined as any, ...EmptyFileSystem }).C4;
        const dsl = `workspace {
    model {
${MODEL}
    }
    views {
        systemContext s "ctx" {
            include *
            ${filter}
        }
    }
}
`;
        const doc: LangiumDocument = services.shared.workspace.LangiumDocumentFactory.fromString(dsl, URI.parse('file:///filter-identifier-validation.dsl'));
        services.shared.workspace.LangiumDocuments.addDocument(doc);
        await services.shared.workspace.DocumentBuilder.build([doc], { validation: true });
        return (doc.diagnostics ?? []).map(d => (typeof d.message === 'string' ? d.message : d.message.value));
    }

    it('accepts identifiers, including group identifiers', async () => {
        expect(await diagnosticsFor('exclude "x"')).toEqual([]);
        expect(await diagnosticsFor('exclude "g"')).toEqual([]);
        expect(await diagnosticsFor('exclude "a"')).toEqual([]);
    });

    it('reports element and group names, which are not identifiers', async () => {
        expect(await diagnosticsFor('exclude "Payment Service"'))
            .toContain('The element/relationship "Payment Service" does not exist');
        expect(await diagnosticsFor('exclude "Group Name"'))
            .toContain('The element/relationship "Group Name" does not exist');
        expect(await diagnosticsFor('exclude "Anon Group"'))
            .toContain('The element/relationship "Anon Group" does not exist');
    });
});
