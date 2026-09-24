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
import { resolve, dirname } from 'node:path';
import { NodeFileSystem } from 'langium/node';
import { URI } from 'vscode-uri';
import { createC4Services } from './c4-module';
import { C4JsonGenerator } from './c4-json-generator';
import { C4JsonEnricher } from './c4-json-enricher';
import { compareJson } from './c4-json-compare';
import { isWorkspace } from '../generated/ast';

const FIXTURE = resolve(__dirname, '../../test/fixtures/decisions-vendor/workspace.dsl');

/**
 * Drops the madr decision dates. madr uses the file modification time when the
 * front matter has no date, so those values are not reproducible across checkouts;
 * adrtools and log4brains dates are compared against the fixture.
 */
function dropMadrDates(json: any): void {
	const decisions = json?.model?.softwareSystems?.[0]?.containers?.[0]?.documentation?.decisions;
	if (Array.isArray(decisions)) {
		for (const decision of decisions) delete decision.date;
	}
}

describe('c4-json-decisions-vendor', () => {
	it('matches the expected JSON for adrtools, madr and log4brains decisions', async () => {
		const services = createC4Services({ connection: undefined as any, ...NodeFileSystem }).C4;
		const shared = (services as any).shared;
		const document = services.shared.workspace.LangiumDocumentFactory.fromString(readFileSync(FIXTURE, 'utf-8'), URI.file(FIXTURE));
		services.shared.workspace.LangiumDocuments.addDocument(document);
		await services.shared.workspace.DocumentBuilder.build([document]);

		const root: any = document.parseResult.value;
		const workspace = isWorkspace(root) ? root : root.workspaces?.[0];
		const uri = URI.file(FIXTURE).toString();

		const generator: any = new C4JsonGenerator(services);
		const json = await generator.generate(workspace, uri);
		await new C4JsonEnricher(shared).enrich(uri, json);

		// `dsl` is added by the enricher for the preview and is not part of the JSON shape.
		delete json.dsl;
		dropMadrDates(json);

		const expected = JSON.parse(readFileSync(resolve(dirname(FIXTURE), 'expected.json'), 'utf-8'));
		const diffs = compareJson(json, expected);
		if (diffs.length > 0) {
			console.log('Differences:', JSON.stringify(diffs.slice(0, 30), null, 2));
		}
		expect(diffs).toHaveLength(0);
	});
});
