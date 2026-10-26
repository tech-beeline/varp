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
import { NodeFileSystem } from 'langium/node';
import { URI } from 'vscode-uri';
import { createC4Services } from './c4-module';
import { C4JsonGenerator } from './c4-json-generator';
import { C4JsonEnricher } from './c4-json-enricher';
import { compareJson } from './c4-json-compare';
import { isWorkspace } from '../generated/ast';

const FIXTURE = resolve(__dirname, '../../test/fixtures/expression-element-all');

interface GeneratedView {
    key: string;
    elements: string[];
    relationships: number;
}

/** Generates the fixture and returns the element names of every static view. */
async function generateViews(): Promise<{ views: Map<string, GeneratedView>; json: any }> {
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

describe('element==* view filter', () => {
    it('selects the default elements of the view', async () => {
        const { views } = await generateViews();
        for (const key of ['quoted', 'native', 'quoted_star']) {
            expect(views.get(key)?.elements).toEqual(['A', 'P', 'S']);
            expect(views.get(key)?.relationships).toBe(2);
        }
        expect(views.get('container')?.elements).toEqual(['C1', 'C2']);
    });

    it('matches the JSON the reference library exports', async () => {
        const { json } = await generateViews();
        const expected = JSON.parse(readFileSync(resolve(FIXTURE, 'expected.json'), 'utf-8'));
        expect(compareJson(json, expected)).toEqual([]);
    });
});
