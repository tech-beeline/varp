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
import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { resolve, dirname } from 'path';
import { EmptyFileSystem } from 'langium';
import { URI } from 'vscode-uri';
import { createC4Services } from './c4-module';
import { C4JsonGenerator } from './c4-json-generator';
import { C4JsonEnricher } from './c4-json-enricher';
import { compareJson } from './c4-json-compare';
import { isWorkspace } from '../generated/ast';

/**
 * Full-profile verification of every fixture: runs the generator and the enricher
 * and compares the whole workspace JSON. Non-render content (documentation, the
 * retained DSL and user properties) is verified here, while the generator fixture
 * test verifies the render-affecting fields.
 */
async function generateAndEnrich(filePath: string): Promise<any> {
    const dir = dirname(filePath);
    const dslFiles: string[] = [];
    const collectDslFiles = (current: string) => {
        for (const entry of readdirSync(current, { withFileTypes: true })) {
            if (entry.name.startsWith('.')) continue;
            const full = resolve(current, entry.name);
            if (entry.isDirectory()) collectDslFiles(full);
            else if (entry.name.endsWith('.dsl')) dslFiles.push(full);
        }
    };
    collectDslFiles(dir);

    const services = createC4Services({ connection: undefined as any, ...EmptyFileSystem }).C4;
    const docs = dslFiles.map(file =>
        services.shared.workspace.LangiumDocumentFactory.fromString(readFileSync(file, 'utf-8'), URI.file(file)));
    for (const doc of docs) services.shared.workspace.LangiumDocuments.addDocument(doc);
    await services.shared.workspace.DocumentBuilder.build(docs);

    const entryUri = URI.file(resolve(filePath)).toString();
    const entry = docs.find(d => d.uri.toString() === entryUri);
    if (!entry) throw new Error(`Entry document not found for ${filePath}`);

    const root: any = entry.parseResult.value;
    const workspace = isWorkspace(root) ? root : root.workspaces?.[0];
    const json = await new C4JsonGenerator(services).generate(workspace, entryUri);
    await new C4JsonEnricher((services as any).shared).enrich(entryUri, json);
    return json;
}

const fixturesDir = resolve(__dirname, '../../test/fixtures');
const testCases: Array<{ name: string; dslPath: string; jsonPath: string }> = [];

if (existsSync(fixturesDir)) {
    for (const entry of readdirSync(fixturesDir)) {
        const fullPath = resolve(fixturesDir, entry);
        if (!statSync(fullPath).isDirectory()) continue;
        const dslPath = resolve(fullPath, 'input.dsl');
        const jsonPath = resolve(fullPath, 'expected.json');
        if (existsSync(dslPath) && existsSync(jsonPath)) {
            testCases.push({ name: entry, dslPath, jsonPath });
        }
    }
}

describe('C4JsonFull', () => {
    for (const testCase of testCases) {
        it(`matches the full JSON for "${testCase.name}"`, async () => {
            const actual = await generateAndEnrich(testCase.dslPath);
            const expected = JSON.parse(readFileSync(testCase.jsonPath, 'utf-8'));
            const diffs = compareJson(actual, expected, '', { mode: 'full' });
            if (diffs.length > 0) {
                console.log(`Differences for "${testCase.name}":`);
                for (const d of diffs.slice(0, 20)) {
                    console.log(`  ${d.path}: ${d.message} expected=${JSON.stringify(d.expected)?.slice(0, 60)} actual=${JSON.stringify(d.actual)?.slice(0, 60)}`);
                }
            }
            expect(diffs).toHaveLength(0);
        });
    }
});
