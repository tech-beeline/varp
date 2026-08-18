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
import { readFileSync, existsSync, readdirSync, statSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { EmptyFileSystem } from 'langium';
import { URI } from 'vscode-uri';
import { createC4Services } from './c4-module';
import { C4JsonGenerator } from './c4-json-generator';
import { compareJson } from './c4-json-compare';
import { isWorkspace } from '../generated/ast';

async function loadDSL(filePath: string): Promise<any> {
    const dir = dirname(filePath);
    // Discover all .dsl files in the fixture directory so multi-file workspaces
    // (extends/includes chains) can resolve their parent/included documents. A
    // fresh service container per fixture avoids cross-fixture doc accumulation.
    const dslNames = readdirSync(dir).filter(f => f.endsWith('.dsl'));
    const services = createC4Services({ connection: undefined as any, ...EmptyFileSystem }).C4;
    const docs = dslNames.map(name => {
        const file = resolve(dir, name);
        const content = readFileSync(file, 'utf-8');
        return services.shared.workspace.LangiumDocumentFactory.fromString(content, URI.file(file));
    });
    // Register every document so multi-file workspaces (extends/includes chains)
    // can resolve their parent documents via LangiumDocuments (the WorkspaceManager
    // does this automatically in the real LSP).
    for (const d of docs) {
        services.shared.workspace.LangiumDocuments.addDocument(d);
    }
    await services.shared.workspace.DocumentBuilder.build(docs);
    const entryUri = URI.file(resolve(filePath)).toString();
    const entry = docs.find(d => d.uri.toString() === entryUri);
    if (!entry) {
        throw new Error(`Entry document not found for ${filePath}`);
    }
    const root = entry.parseResult.value;
    if (isWorkspace(root)) {
        const generator = new C4JsonGenerator(services);
        return generator.generate(root);
    }
    // If root is C4Document, find workspace inside
    const anyRoot = root as any;
    if (anyRoot.$type === 'C4Document' && anyRoot.workspaces?.length > 0) {
        const generator = new C4JsonGenerator(services);
        return generator.generate(anyRoot.workspaces[0]);
    }
    throw new Error('No workspace found in DSL file');
}

function loadExpectedJSON(filePath: string): any {
    const content = readFileSync(filePath, 'utf-8');
    return JSON.parse(content);
}

// Auto-discover test fixtures
const fixturesDir = resolve(__dirname, '../../test/fixtures');
let testCases: Array<{ name: string; dslPath: string; jsonPath: string }> = [];

try {
    if (existsSync(fixturesDir)) {
        const entries = readdirSync(fixturesDir);
        testCases = entries
            .filter(entry => {
                const fullPath = resolve(fixturesDir, entry);
                return statSync(fullPath).isDirectory();
            })
            .map(dir => ({
                name: dir,
                dslPath: resolve(fixturesDir, dir, 'input.dsl'),
                jsonPath: resolve(fixturesDir, dir, 'expected.json')
            }))
            .filter(tc => existsSync(tc.dslPath) && existsSync(tc.jsonPath));
    }
} catch {
    // No fixtures directory yet
}

describe('C4JsonGenerator', () => {
    if (testCases.length === 0) {
        it('No test fixtures found — create test/fixtures/<name>/input.dsl + expected.json', () => {
            console.log('No fixtures found at:', fixturesDir);
            expect(true).toBe(true);
        });
        return;
    }

    for (const testCase of testCases) {
        it(`generates correct JSON for "${testCase.name}"`, async () => {
            const actual = await loadDSL(testCase.dslPath);

            // Regenerate fixtures: run with UPDATE_FIXTURES=1 to write the actual
            // output into expected.json instead of comparing.
            if (process.env.UPDATE_FIXTURES === '1') {
                writeFileSync(testCase.jsonPath, JSON.stringify(actual, null, 4) + '\n');
                return;
            }

            const expected = loadExpectedJSON(testCase.jsonPath);
            
            const diffs = compareJson(actual, expected);
            
            if (diffs.length > 0) {
                console.log(`Differences for "${testCase.name}":`);
                for (const d of diffs) {
                    console.log(`  ${d.path}: ${d.message}`);
                    if (d.expected !== undefined) console.log(`    expected: ${JSON.stringify(d.expected).substring(0, 200)}`);
                    if (d.actual !== undefined) console.log(`    actual:   ${JSON.stringify(d.actual).substring(0, 200)}`);
                }
            }
            
            expect(diffs).toHaveLength(0);
        });
    }
});