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
import { EmptyFileSystem } from 'langium';
import { URI } from 'vscode-uri';
import { createC4Services } from './c4-module';

/** Parses a DSL source as a single document and returns its parser errors. */
async function parseErrors(source: string): Promise<string[]> {
    const services = createC4Services({ connection: undefined as any, ...EmptyFileSystem }).C4;
    const doc = services.shared.workspace.LangiumDocumentFactory.fromString(source, URI.parse('file:///script-directives/input.dsl'));
    services.shared.workspace.LangiumDocuments.addDocument(doc);
    await services.shared.workspace.DocumentBuilder.build([doc]);
    return (doc.parseResult.parserErrors ?? []).map((error: any) => error.message);
}

describe('!script directives', () => {
    it('parses the script-inline fixture, which uses !script at every level', async () => {
        const source = readFileSync(
            resolvePath(__dirname, '../../test/fixtures/pending/script-inline/input.dsl'), 'utf-8',
        );
        expect((await parseErrors(source)).join('\n')).toBe('');
    });

    it('accepts a script directly in a views block', async () => {
        const errors = await parseErrors(`workspace {
model {
s = softwareSystem "S"
}
views {
!script groovy {
workspace.model.relationships.forEach { it.description = (it.linkedRelationshipId != null ? it.linkedRelationshipId : it.id) + " -- " + it.description }
}
}
}
`);
        expect(errors.join('\n')).toBe('');
    });

    it('accepts a plugin and a constant in a views block', async () => {
        const errors = await parseErrors(`workspace {
views {
!plugin com.example.ExampleStructurizrDslPlugin
!const "KEY" "value"
}
}
`);
        expect(errors.join('\n')).toBe('');
    });
});
