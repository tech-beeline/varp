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
import { isWorkspace } from '../generated/ast';

/**
 * The `structurizr.dsl.identifier` property is compared by shape for generated
 * identifiers and skipped by the JSON comparator, so declared relationship
 * identifiers are asserted here against the reference output.
 */
async function generateAndEnrich(fixtureDir: string): Promise<any> {
	const dslFiles: string[] = [];
	const collect = (current: string) => {
		for (const entry of readdirSync(current, { withFileTypes: true })) {
			if (entry.name.startsWith('.')) continue;
			const full = resolve(current, entry.name);
			if (entry.isDirectory()) collect(full);
			else if (entry.name.endsWith('.dsl')) dslFiles.push(full);
		}
	};
	collect(fixtureDir);

	const services = createC4Services({ connection: undefined as any, ...NodeFileSystem }).C4;
	const docs = dslFiles.map(file =>
		services.shared.workspace.LangiumDocumentFactory.fromString(readFileSync(file, 'utf-8'), URI.file(file)));
	for (const doc of docs) services.shared.workspace.LangiumDocuments.addDocument(doc);
	await services.shared.workspace.DocumentBuilder.build(docs);

	const entryUri = URI.file(resolve(fixtureDir, 'input.dsl')).toString();
	const entry = docs.find(doc => doc.uri.toString() === entryUri);
	if (!entry) throw new Error(`entry document not found: ${entryUri}`);

	const root: any = entry.parseResult.value;
	const workspace = isWorkspace(root) ? root : root.workspaces?.[0];
	const json = await new C4JsonGenerator(services).generate(workspace, entryUri);
	await new C4JsonEnricher((services as any).shared).enrich(entryUri, json);
	return json;
}

/** Declared relationship identifiers (`structurizr.dsl.identifier` on model relationships). */
function relationshipIdentifiers(json: any): string[] {
	const identifiers: string[] = [];
	const walk = (node: any): void => {
		if (!node || typeof node !== 'object') return;
		if (Array.isArray(node)) {
			node.forEach(walk);
			return;
		}
		if (node.sourceId !== undefined && node.destinationId !== undefined) {
			const identifier = node.properties?.['structurizr.dsl.identifier'];
			if (typeof identifier === 'string') identifiers.push(identifier);
		}
		for (const [key, value] of Object.entries(node)) {
			if (key !== 'properties') walk(value);
		}
	};
	walk(json);
	return identifiers.sort();
}

describe('c4-json-relationship-identifiers-vendor', () => {
	it.each<[string, string[]]>([
		['dynamic-view-with-explicit-relationships', ['r1', 'r2']],
		['exclude-implied-relationship', ['r']],
		['include-implied-relationship', ['r']],
		['identifiers', ['rel']],
	])('emits the declared relationship identifiers for %s', async (name, expected) => {
		const json = await generateAndEnrich(resolve(__dirname, '../../test/fixtures', name));
		expect(relationshipIdentifiers(json)).toEqual(expected);
	});
});
