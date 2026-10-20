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
import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { AstUtils, EmptyFileSystem, type LangiumDocument } from 'langium';
import { URI, Utils } from 'vscode-uri';
import { createC4Services } from './c4-module';
import { isRelationship } from '../generated/ast';

const PROJECT = URI.parse('file:///hierarchical-identifier-scope/');

/** Loads the test/fixtures/complex-include fixture, with the entry and container files replaced. */
function fixtureProject(input: string, containers?: string): Record<string, string> {
    const dir = resolvePath(__dirname, '../../test/fixtures/complex-include');
    const files: Record<string, string> = {};
    for (const name of ['input.dsl', '1.dsl', '2.dsl', '3.dsl']) {
        files[name] = readFileSync(resolvePath(dir, name), 'utf-8');
    }
    files['input.dsl'] = input;
    if (containers !== undefined) files['2.dsl'] = containers;
    return files;
}

/** Builds the project and returns the first relationship with its reference resolution state. */
async function relationshipOf(files: Record<string, string>) {
    const services = createC4Services({ connection: undefined as any, ...EmptyFileSystem }).C4;
    const docs: LangiumDocument[] = [];
    for (const [name, content] of Object.entries(files)) {
        const doc = services.shared.workspace.LangiumDocumentFactory.fromString(content, Utils.resolvePath(PROJECT, name));
        services.shared.workspace.LangiumDocuments.addDocument(doc);
        docs.push(doc);
    }
    await services.shared.workspace.DocumentBuilder.build(docs);
    const main = docs.find(doc => doc.uri.toString().endsWith('input.dsl'))!;
    const relationships = AstUtils.streamAllContents(main.parseResult.value).filter(isRelationship).toArray() as any[];
    const fragment = docs.find(doc => doc.uri.toString().endsWith('2.dsl'));
    const fragmentRelationships = fragment
        ? AstUtils.streamAllContents(fragment.parseResult.value).filter(isRelationship).toArray() as any[]
        : [];
    const relationship = fragmentRelationships[0] ?? relationships[relationships.length - 1];
    return {
        parserErrors: main.parseResult.parserErrors.length,
        source: relationship.source?.ref ? `${relationship.source.ref.$type}#${(relationship.source.ref as any).id}` : null,
        sourceError: relationship.source?.error?.message ?? null,
        destination: relationship.target?.ref ? `${relationship.target.ref.$type}#${(relationship.target.ref as any).id}` : null,
    };
}

const ENTRY = (relationship: string) => `workspace extends 1.dsl {
    !identifiers hierarchical
    model {
        !include '3.dsl'
        ${relationship}
    }
}
`;

describe('hierarchical identifier references', () => {
    it('resolves the full hierarchical identifier of an included container', async () => {
        const result = await relationshipOf(fixtureProject(ENTRY('s.c -> s.c1')));
        expect(result.parserErrors).toBe(0);
        expect(result.source).toBe('Container#c');
        expect(result.destination).toBe('Container#c1');
    }, 60000);

    it('does not resolve a bare suffix of an included container at model level', async () => {
        const result = await relationshipOf(fixtureProject(ENTRY('c -> s.c1')));
        expect(result.parserErrors).toBe(0);
        expect(result.source).toBeNull();
        expect(result.sourceError).toContain("Could not resolve reference to RelationshipMember named 'c'");
        expect(result.destination).toBe('Container#c1');
    }, 60000);

    it('resolves a sibling by its short identifier inside the extended element', async () => {
        const result = await relationshipOf(fixtureProject(ENTRY('s.c -> s.c1'), `c = container "c" {
}

c1 = container "c1" {
}

c -> c1 "Sibling"
`));
        expect(result.parserErrors).toBe(0);
        expect(result.source).toBe('Container#c');
        expect(result.destination).toBe('Container#c1');
    }, 60000);

    it('does not resolve a nested element by its short identifier from an enclosing element', async () => {
        const result = await relationshipOf({
            'input.dsl': `workspace {
    !identifiers hierarchical
    model {
        s = softwareSystem "S" {
            c = container "C" {
                comp = component "Comp"
            }
            c1 = container "C1"
            comp -> c1 "Nested"
        }
    }
}
`,
        });
        expect(result.parserErrors).toBe(0);
        expect(result.source).toBeNull();
        expect(result.sourceError).toContain("Could not resolve reference to RelationshipMember named 'comp'");
        expect(result.destination).toBe('Container#c1');
    }, 60000);
});
