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

import { describe, expect, beforeAll } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { NodeFileSystem } from 'langium/node';
import { URI } from 'vscode-uri';
import { createC4Services } from './c4-module';
import { C4JsonGenerator } from './c4-json-generator';
import { C4JsonEnricher } from './c4-json-enricher';
import { withClientFileSystem } from './c4-binary-file-system';
import { createWorkspaceFileRequestHandlers } from '../extension/workspace-file-requests';
import { isWorkspace } from '../generated/ast';

const FIXTURE = resolve(__dirname, '../../test/fixtures/enricher-docs/workspace.dsl');
const DOCS_DIR = resolve(dirname(FIXTURE), 'docs');

/** Reads a documentation file, normalizing line endings like the reference reader. */
function docFile(name: string): string {
	return readFileSync(resolve(DOCS_DIR, name), 'utf-8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

/** Builds the render JSON for the fixture and enriches it (a clone, as the handler does). */
async function loadEnriched(fileSystemProvider?: any): Promise<any> {
	const dir = dirname(FIXTURE);
	const dslFiles: string[] = [];
	const collect = (current: string) => {
		for (const entry of readdirSync(current, { withFileTypes: true })) {
			if (entry.name.startsWith('.')) continue;
			const full = resolve(current, entry.name);
			if (entry.isDirectory()) collect(full);
			else if (entry.name.endsWith('.dsl')) dslFiles.push(full);
		}
	};
	collect(dir);
	const context = fileSystemProvider
		? { connection: undefined as any, ...NodeFileSystem, fileSystemProvider: () => fileSystemProvider }
		: { connection: undefined as any, ...NodeFileSystem };
	const services = createC4Services(context).C4;
	const shared = (services as any).shared;
	const docs = dslFiles.map(f => services.shared.workspace.LangiumDocumentFactory.fromString(readFileSync(f, 'utf-8'), URI.file(f)));
	for (const d of docs) services.shared.workspace.LangiumDocuments.addDocument(d);
	await services.shared.workspace.DocumentBuilder.build(docs);
	const entry = docs.find(d => d.uri.toString() === URI.file(FIXTURE).toString())!;
	const root: any = entry.parseResult.value;
	const workspace = isWorkspace(root) ? root : root.workspaces?.[0];
	const uri = URI.file(FIXTURE).toString();
	const generator: any = new C4JsonGenerator(services);
	const json = await generator.generate(workspace, uri);
	const enricher = new C4JsonEnricher(shared);
	const clone = JSON.parse(JSON.stringify(json));
	await enricher.enrich(uri, clone);
	return clone;
}

describe('c4-json-enricher: !docs', () => {
	let enriched: any;

	beforeAll(async () => {
		enriched = await loadEnriched();
	}, 120_000);

	it('imports workspace-level sections from the docs directory', () => {
		const sections = enriched.documentation?.sections;
		expect(sections?.length).toBe(3);

		const [overview, design, notes] = sections;
		// Directory listing sorted by name; the anchored "02-design" pattern does not
		// exclude "02-design.md" (Java's String.matches anchors the regex).
		expect(overview.filename).toBe('01-overview.md');
		expect(overview.format).toBe('Markdown');
		expect(overview.title).toBe('');
		expect(overview.content).toBe(docFile('01-overview.md'));
		expect(overview.order).toBe(1);

		expect(design.filename).toBe('02-design.md');
		expect(design.format).toBe('Markdown');
		expect(design.order).toBe(2);

		expect(notes.filename).toBe('03-notes.adoc');
		expect(notes.format).toBe('AsciiDoc');
		expect(notes.order).toBe(3);

		// Only Markdown/AsciiDoc files are documentation.
		const names = sections.map((s: any) => s.filename);
		expect(names).not.toContain('04-image.png');
		expect(names).not.toContain('.hidden.md');
	});

	it('excludes files by exact name', () => {
		const names = enriched.documentation.sections.map((s: any) => s.filename);
		expect(names).not.toContain('README.md');
	});

	it('nests element-level sections under the documentable element', () => {
		const documentation = enriched.model?.softwareSystems?.[0]?.documentation;
		const sections = documentation?.sections;
		expect(sections?.length).toBe(1);
		expect(sections[0].filename).toBe('10-details.md');
		expect(sections[0].order).toBe(1);
		expect(sections[0].content).toBe(docFile('element/10-details.md'));
		// No decisions were imported: the empty collection is omitted (NON_EMPTY).
		expect(documentation.decisions).toBeUndefined();
	});

	it('imports only the referenced images, sorted by name', () => {
		const images = enriched.documentation?.images;
		expect(images?.map((image: any) => image.name)).toEqual(['diagram.png', 'logo.svg']);
		expect(images[0].type).toBe('image/png');
		expect(images[1].type).toBe('image/svg+xml');
		// The unreferenced image in the same directory is not imported (reluctant mode).
		expect(images.map((image: any) => image.name)).not.toContain('unused.png');
	});

	it('stores the raw file bytes of each imported image as base64', () => {
		const images = enriched.documentation.images;
		const svg = images.find((image: any) => image.name === 'logo.svg');
		expect(svg.content).toBe(readFileSync(resolve(DOCS_DIR, 'logo.svg')).toString('base64'));

		const png = images.find((image: any) => image.name === 'diagram.png');
		expect(png.content).toBe(readFileSync(resolve(DOCS_DIR, 'diagram.png')).toString('base64'));
	});

	it('imports a single documentation file with an empty filename', () => {
		const documentation = enriched.model?.softwareSystems?.[0]?.containers?.[0]?.documentation;
		const sections = documentation?.sections;
		expect(sections?.length).toBe(1);
		// A single-file import trims the imported path away, leaving an empty filename.
		expect(sections[0].filename).toBe('');
		expect(sections[0].order).toBe(1);
		expect(sections[0].content).toBe(docFile('element/10-details.md'));
	});

	it('keeps decisions from !adrs alongside sections', async () => {
		// A second enricher run over a workspace that also declares !adrs: reuse the
		// same fixture data by importing decisions through the same directory flow.
		// (The fixture has no !adrs directive, so this only checks the merge helper.)
		const services = createC4Services({ connection: undefined as any, ...NodeFileSystem }).C4;
		const enricher = new C4JsonEnricher((services as any).shared);
		const holder: any = {};
		(enricher as any).addDocumentation(holder, { sections: [{ title: '', filename: 'a.md', content: '', format: 'Markdown', order: 0 }], decisions: [{ id: '1', title: 'T' }], images: [] });
		expect(holder.documentation.sections.length).toBe(1);
		expect(holder.documentation.decisions.length).toBe(1);
	});
});

describe('c4-json-enricher: web bridge', () => {
	let bridged: any;

	beforeAll(async () => {
		// The server-side provider is wired to the extension-host handlers, which read
		// through a node:fs-backed fake of vscode.workspace.fs. This exercises both
		// halves of the bridge (c4/read* requests) without a real LSP transport.
		const fs = {
			readFile: async (uri: string) => new Uint8Array(readFileSync(URI.parse(uri).fsPath)),
			readDirectory: async (uri: string) => readdirSync(URI.parse(uri).fsPath, { withFileTypes: true })
				.map((entry) => [entry.name, entry.isDirectory() ? 2 : 1] as [string, number]),
			stat: async (uri: string) => ({ type: statSync(URI.parse(uri).fsPath).isDirectory() ? 2 : 1 })
		};
		const handlers = createWorkspaceFileRequestHandlers(fs, (value) => URI.parse(value));
		const provider = withClientFileSystem((NodeFileSystem as any).fileSystemProvider(), {
			readBinary: (uri) => handlers.readBinary({ uri }),
			readDirectory: (uri) => handlers.readDirectory({ uri }),
			stat: (uri) => handlers.stat({ uri }),
			exists: (uri) => handlers.exists({ uri })
		});
		provider.readFile = (uri: any) => handlers.readFile({ uri: uri.toString() });

		bridged = await loadEnriched(provider);
	}, 120_000);

	it('imports documentation and images through the extension-host bridge', () => {
		expect(bridged.documentation?.sections.map((section: any) => section.filename)).toEqual([
			'01-overview.md', '02-design.md', '03-notes.adoc'
		]);
		expect(bridged.documentation?.images.map((image: any) => image.name)).toEqual(['diagram.png', 'logo.svg']);
		expect(bridged.documentation?.images[0].content).toBe(readFileSync(resolve(DOCS_DIR, 'diagram.png')).toString('base64'));
	});
});
