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
import { readFileSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { NodeFileSystem } from 'langium/node';
import { URI } from 'vscode-uri';
import { createC4Services } from './c4-module';
import { C4JsonGenerator } from './c4-json-generator';
import { C4JsonEnricher } from './c4-json-enricher';
import { compareJson } from './c4-json-compare';
import { isWorkspace } from '../generated/ast';

// Vendor-verified behaviour of the !elements / !relationships overlay directives
// and of the `instanceOf` instance form: these fields are injected by the
// enricher, so the fixtures are compared after both the generator and the
// enricher have run (as the render pipeline consumes them).
const FIXTURES = [
    resolve(__dirname, '../../test/fixtures/instance-of-fields/workspace.dsl'),
    resolve(__dirname, '../../test/fixtures/overlay-merge-semantics/workspace.dsl'),
    resolve(__dirname, '../../test/fixtures/archetype-props-precedence/workspace.dsl'),
];

describe('c4-json-overlay-vendor', () => {
    for (const fixture of FIXTURES) {
        it(`matches the expected JSON for ${basename(dirname(fixture))}`, async () => {
            const services = createC4Services({ connection: undefined as any, ...NodeFileSystem }).C4;
            const shared = (services as any).shared;
            const document = services.shared.workspace.LangiumDocumentFactory.fromString(readFileSync(fixture, 'utf-8'), URI.file(fixture));
            services.shared.workspace.LangiumDocuments.addDocument(document);
            await services.shared.workspace.DocumentBuilder.build([document]);

            const root: any = document.parseResult.value;
            const workspace = isWorkspace(root) ? root : root.workspaces?.[0];
            const uri = URI.file(fixture).toString();

            const generator: any = new C4JsonGenerator(services);
            const json = await generator.generate(workspace, uri);
            await new C4JsonEnricher(shared).enrich(uri, json);

            const expected = JSON.parse(readFileSync(resolve(dirname(fixture), 'expected.json'), 'utf-8'));
            const diffs = compareJson(json, expected);
            if (diffs.length > 0) {
                console.log(`Differences for ${basename(dirname(fixture))}:`, JSON.stringify(diffs.slice(0, 30), null, 2));
            }
            expect(diffs).toHaveLength(0);
        }, 60_000);
    }
});
