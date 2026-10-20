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
import { resolve, dirname } from 'node:path';
import { NodeFileSystem } from 'langium/node';
import { URI } from 'vscode-uri';
import { createC4Services } from './c4-module';
import { C4JsonGenerator } from './c4-json-generator';
import { C4JsonEnricher } from './c4-json-enricher';
import { compareJson } from './c4-json-compare';
import { isWorkspace } from '../generated/ast';

/**
 * Generates the model of a fixture directory and compares it with the JSON the
 * reference library exports for the same DSL (`expected.json`).
 */
async function expectVendorMatch(fixture: string): Promise<void> {
    const dir = resolve(__dirname, '../../test/fixtures', fixture);
    const entry = resolve(dir, 'workspace.dsl');
    const services = createC4Services({ connection: undefined as any, ...NodeFileSystem }).C4;
    const shared = (services as any).shared;
    const documents = readdirSync(dir)
        .filter(name => name.endsWith('.dsl'))
        .map(name => {
            const path = resolve(dir, name);
            const document = services.shared.workspace.LangiumDocumentFactory.fromString(readFileSync(path, 'utf-8'), URI.file(path));
            services.shared.workspace.LangiumDocuments.addDocument(document);
            return document;
        });
    await services.shared.workspace.DocumentBuilder.build(documents);

    const document = documents.find(doc => doc.uri.toString().endsWith('/workspace.dsl'))!;
    const root: any = document.parseResult.value;
    const workspace = isWorkspace(root) ? root : root.workspaces?.[0];
    const uri = URI.file(entry).toString();

    const generator: any = new C4JsonGenerator(services);
    const json = await generator.generate(workspace, uri);
    await new C4JsonEnricher(shared).enrich(uri, json);

    const expected = JSON.parse(readFileSync(resolve(dirname(entry), 'expected.json'), 'utf-8'));
    const diffs = compareJson(json, expected);
    if (diffs.length > 0) {
        console.log('Differences:', JSON.stringify(diffs.slice(0, 30), null, 2));
    }
    expect(diffs).toHaveLength(0);
}

describe('c4-json-hierarchical-scope-vendor', () => {
    it('matches the reference library for a relative reference inside an !element fragment', async () => {
        await expectVendorMatch('hierarchical-scope-include-element');
    }, 60000);

    it('matches the reference library for a reference relative to an enclosing element', async () => {
        await expectVendorMatch('hierarchical-scope-ancestor-sibling');
    }, 60000);

    it('matches the reference library for a relative reference three includes deep', async () => {
        await expectVendorMatch('hierarchical-scope-include-depth');
    }, 60000);
});
