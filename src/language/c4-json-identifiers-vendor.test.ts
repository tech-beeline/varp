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

const FIXTURE = resolve(__dirname, '../../test/fixtures/identifiers-vendor/workspace.dsl');

describe('c4-json-identifiers-vendor', () => {
	it('matches the expected JSON for hierarchical identifiers', async () => {
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

		// The identifier properties are ignored by the JSON comparator, so they are
		// asserted directly: hierarchical identifiers are the dotted path of the
		// declared identifiers from the root down to the element.
		const identifiers = [
			json.model.softwareSystems[0].properties?.['structurizr.dsl.identifier'],
			json.model.softwareSystems[0].containers[0].properties?.['structurizr.dsl.identifier'],
			json.model.softwareSystems[0].containers[0].components[0].properties?.['structurizr.dsl.identifier']
		];
		expect(identifiers).toEqual(['b', 'b.c', 'b.c.d']);

		const expected = JSON.parse(readFileSync(resolve(dirname(FIXTURE), 'expected.json'), 'utf-8'));
		const diffs = compareJson(json, expected);
		if (diffs.length > 0) {
			console.log('Differences:', JSON.stringify(diffs.slice(0, 30), null, 2));
		}
		expect(diffs).toHaveLength(0);
	});

	it('assigns a generated identifier to elements without one', async () => {
		const dsl = [
			'workspace {',
			'',
			'    !identifiers hierarchical',
			'',
			'    model {',
			'        softwareSystem "B" {',
			'            container "C"',
			'        }',
			'    }',
			'}'
		].join('\n');

		const services = createC4Services({ connection: undefined as any, ...NodeFileSystem }).C4;
		const shared = (services as any).shared;
		const uri = URI.parse('file:///unassigned.dsl').toString();
		const document = services.shared.workspace.LangiumDocumentFactory.fromString(dsl, URI.parse(uri));
		services.shared.workspace.LangiumDocuments.addDocument(document);
		await services.shared.workspace.DocumentBuilder.build([document]);

		const root: any = document.parseResult.value;
		const workspace = isWorkspace(root) ? root : root.workspaces?.[0];
		const generator: any = new C4JsonGenerator(services);
		const json = await generator.generate(workspace, uri);
		await new C4JsonEnricher(shared).enrich(uri, json);

		const system = json.model.softwareSystems[0].properties['structurizr.dsl.identifier'];
		const container = json.model.softwareSystems[0].containers[0].properties['structurizr.dsl.identifier'];
		const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

		expect(system).toMatch(uuid);
		// The container is prefixed with the generated identifier of its parent.
		expect(container.startsWith(`${system}.`)).toBe(true);
		expect(container.slice(system.length + 1)).toMatch(uuid);
	});
});
