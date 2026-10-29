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
import { Buffer } from 'node:buffer';
import { resolve } from 'node:path';
import { NodeFileSystem } from 'langium/node';
import { URI } from 'vscode-uri';
import { createC4Services } from './c4-module';
import { C4JsonGenerator } from './c4-json-generator';
import { C4JsonEnricher } from './c4-json-enricher';
import { isWorkspace } from '../generated/ast';
import { lineSeparator } from './c4-dsl-source';

const FIXTURES = resolve(__dirname, '../../test/fixtures');

function decodeBase64(value: string): string {
	return Buffer.from(value, 'base64').toString('utf8');
}

function collectDslFiles(dir: string): string[] {
	const files: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (entry.name.startsWith('.')) continue;
		const full = resolve(dir, entry.name);
		if (entry.isDirectory()) files.push(...collectDslFiles(full));
		else if (entry.name.endsWith('.dsl')) files.push(full);
	}
	return files;
}

async function generateFixture(name: string, entry: string): Promise<any> {
	const dir = resolve(FIXTURES, name);
	const services = createC4Services({ connection: undefined as any, ...NodeFileSystem }).C4;
	const docs = collectDslFiles(dir).map(file =>
		services.shared.workspace.LangiumDocumentFactory.fromString(readFileSync(file, 'utf-8'), URI.file(file)));
	for (const doc of docs) services.shared.workspace.LangiumDocuments.addDocument(doc);
	await services.shared.workspace.DocumentBuilder.build(docs);

	const uri = URI.file(resolve(dir, entry)).toString();
	const doc = docs.find(d => d.uri.toString() === uri);
	if (!doc) throw new Error(`entry document not found: ${uri}`);
	const root: any = doc.parseResult.value;
	const workspace = isWorkspace(root) ? root : root.workspaces?.[0];
	const json = await new C4JsonGenerator(services).generate(workspace, uri);
	await new C4JsonEnricher((services as any).shared).enrich(uri, json);
	return json;
}

async function generateInline(dsl: string, extras: Record<string, string> = {}): Promise<any> {
	const services = createC4Services({ connection: undefined as any, ...NodeFileSystem }).C4;
	const uri = URI.parse('file:///inline.dsl');
	const docs = [services.shared.workspace.LangiumDocumentFactory.fromString(dsl, uri)];
	for (const [name, content] of Object.entries(extras)) {
		const extraUri = name.includes('://') ? URI.parse(name) : URI.parse(`file:///${name}`);
		docs.push(services.shared.workspace.LangiumDocumentFactory.fromString(content, extraUri));
	}
	for (const doc of docs) services.shared.workspace.LangiumDocuments.addDocument(doc);
	await services.shared.workspace.DocumentBuilder.build(docs);

	const root: any = docs[0].parseResult.value;
	const workspace = isWorkspace(root) ? root : root.workspaces?.[0];
	const json = await new C4JsonGenerator(services).generate(workspace, uri.toString());
	await new C4JsonEnricher((services as any).shared).enrich(uri.toString(), json);
	return json;
}

async function retainsDsl(dsl: string, extras: Record<string, string> = {}): Promise<boolean> {
	const json = await generateInline(dsl, extras);
	return typeof json.properties?.['structurizr.dsl'] === 'string';
}

const retainedDslOf = (json: any): string => decodeBase64(json.properties['structurizr.dsl']);

describe('c4-json-dsl-source-vendor', () => {
	it('retains the DSL source as the structurizr.dsl workspace property', async () => {
		const json = await generateFixture('identifiers-vendor', 'workspace.dsl');
		const expected = JSON.parse(readFileSync(resolve(FIXTURES, 'identifiers-vendor/expected.json'), 'utf-8'));

		expect(json.dsl).toBeUndefined();
		expect(json.properties['structurizr.dsl']).toBeTypeOf('string');
		// Content parity with the vendor export (line endings are host-dependent).
		expect(retainedDslOf(json).replace(/\r\n/g, '\n')).toBe(decodeBase64(expected.properties['structurizr.dsl']).replace(/\r\n/g, '\n'));
	});

	it('retains the root document lines with the host separator and no trailing break', async () => {
		const dsl = 'workspace {\n\n    model {\n        a = softwareSystem "A"\n    }\n\n}';
		const json = await generateInline(dsl);
		expect(retainedDslOf(json)).toBe(dsl.split(/\r?\n/).join(lineSeparator()));
	});

	it.each([
		['include-file', 'input.dsl'],
		['docs-vendor', 'workspace.dsl'],
		['decisions-vendor', 'workspace.dsl'],
		['extends-chain', 'input.dsl'],
		['source-not-retained', 'input.dsl'],
		['workspace-with-bom', 'input.dsl'],
	])('does not retain the source for %s', async (name, entry) => {
		const json = await generateFixture(name, entry);
		expect(json.dsl).toBeUndefined();
		expect(json.properties?.['structurizr.dsl']).toBeUndefined();
	});

	describe('portability gates', () => {
		it('honours the structurizr.dsl.source property', async () => {
			const base = (value: string) => `workspace {\n    properties {\n        structurizr.dsl.source ${value}\n    }\n    model {\n        a = softwareSystem "A"\n    }\n}`;
			expect(await retainsDsl(base('false'))).toBe(false);
			expect(await retainsDsl(base('"false"'))).toBe(false);
			expect(await retainsDsl(base('true'))).toBe(true);
			expect(await retainsDsl(base('"true"'))).toBe(true);
		});

		it('does not retain with !docs or !adrs', async () => {
			expect(await retainsDsl('workspace {\n    !docs docs\n    model {\n        a = softwareSystem "A"\n    }\n}')).toBe(false);
			expect(await retainsDsl('workspace {\n    !adrs adrs\n    model {\n        a = softwareSystem "A"\n    }\n}')).toBe(false);
		});

		it('does not retain with !script or !plugin', async () => {
			expect(await retainsDsl('workspace {\n    !script test.groovy\n    model {\n        a = softwareSystem "A"\n    }\n}')).toBe(false);
			expect(await retainsDsl('workspace {\n    !plugin com.example.Plugin\n    model {\n        a = softwareSystem "A"\n    }\n}')).toBe(false);
		});

		it('does not retain with !components', async () => {
			const dsl = 'workspace {\n    model {\n        s = softwareSystem "S" {\n            c = container "C" {\n                !components {\n                    strategy com.example.Strategy\n                }\n            }\n        }\n    }\n}';
			expect(await retainsDsl(dsl)).toBe(false);
		});

		it('retains built-in implied-relationships strategies only', async () => {
			const withOption = (option: string) => `workspace {\n    !impliedRelationships ${option}\n    model {\n        a = softwareSystem "A"\n    }\n}`;
			expect(await retainsDsl(withOption('true'))).toBe(true);
			expect(await retainsDsl(withOption('false'))).toBe(true);
			expect(await retainsDsl(withOption('"com.structurizr.model.DefaultImpliedRelationshipsStrategy"'))).toBe(true);
			expect(await retainsDsl(withOption('"com.example.CustomStrategy"'))).toBe(false);
		});

		it('retains only non-file icons', async () => {
			const withIcon = (icon: string) => `workspace {\n    model {\n        a = softwareSystem "A"\n    }\n    views {\n        styles {\n            element "Software System" {\n                icon ${icon}\n            }\n        }\n    }\n}`;
			expect(await retainsDsl(withIcon('logo.png'))).toBe(false);
			expect(await retainsDsl(withIcon('https://example.com/logo.png'))).toBe(true);
			expect(await retainsDsl(withIcon('"data:image/png;base64,AAAA"'))).toBe(true);
		});

		it('retains only non-file themes', async () => {
			const withTheme = (theme: string) => `workspace {\n    model {\n        a = softwareSystem "A"\n    }\n    views {\n        theme ${theme}\n    }\n}`;
			expect(await retainsDsl(withTheme('default'))).toBe(true);
			expect(await retainsDsl(withTheme('https://example.com/theme.json'))).toBe(true);
			expect(await retainsDsl(withTheme('theme.json'))).toBe(false);
		});

		it('retains only non-file image-view sources', async () => {
			const withImage = (source: string) => `workspace {\n    views {\n        image * "Image" {\n            ${source}\n        }\n    }\n}`;
			expect(await retainsDsl(withImage('image image.png'))).toBe(false);
			expect(await retainsDsl(withImage('plantuml diagram.puml'))).toBe(false);
			expect(await retainsDsl(withImage('image https://example.com/image.png'))).toBe(true);
			expect(await retainsDsl(withImage('plantuml https://example.com/diagram.puml'))).toBe(true);
		});

		it('does not retain a local !include but does retain an http(s) one', async () => {
			const withInclude = (target: string) => `workspace {\n    !include ${target}\n    model {\n        a = softwareSystem "A"\n    }\n}`;
			expect(await retainsDsl(withInclude('fragment.dsl'), { 'fragment.dsl': 'model {\n    b = softwareSystem "B"\n}\n' })).toBe(false);
			expect(await retainsDsl(withInclude('https://example.com/fragment.dsl'), {
				'https://example.com/fragment.dsl': 'model {\n    b = softwareSystem "B"\n}\n',
			})).toBe(true);
		});

		it('does not retain a local extends but does retain an http(s) one', async () => {
			const local = 'workspace extends parent.dsl {\n    model {\n        a = softwareSystem "A"\n    }\n}';
			expect(await retainsDsl(local, { 'parent.dsl': 'workspace {\n    model {\n        p = softwareSystem "P"\n    }\n}\n' })).toBe(false);
			const remote = 'workspace extends https://example.com/parent.dsl {\n    model {\n        a = softwareSystem "A"\n    }\n}';
			expect(await retainsDsl(remote, {
				'https://example.com/parent.dsl': 'workspace {\n    model {\n        p = softwareSystem "P"\n    }\n}\n',
			})).toBe(true);
		});
	});
});
