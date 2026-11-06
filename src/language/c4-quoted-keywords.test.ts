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
import { EmptyFileSystem, type LangiumDocument } from 'langium';
import { URI } from 'vscode-uri';
import { createC4Services } from './c4-module';
import { C4JsonGenerator } from './c4-json-generator';
import { isWorkspace } from '../generated/ast';

/**
 * The reference implementation tokenizes the DSL without the surrounding quotes
 * and compares tokens to keywords by text, so `"tags" "sample"` is the same as
 * `tags "sample"`. DSL files produced by the toolchain use the quoted form, so the
 * language has to accept it too.
 */
async function build(source: string) {
    const services = createC4Services({ connection: undefined as any, ...EmptyFileSystem }).C4;
    const doc: LangiumDocument = services.shared.workspace.LangiumDocumentFactory.fromString(
        source, URI.parse('file:///quoted-keywords.dsl'));
    services.shared.workspace.LangiumDocuments.addDocument(doc);
    await services.shared.workspace.DocumentBuilder.build([doc]);
    // `build` without options skips validation, so link errors need an explicit pass.
    await services.validation.DocumentValidator.validateDocument(doc);
    return { services, doc };
}

function generate(services: ReturnType<typeof createC4Services>['C4'], doc: LangiumDocument): Promise<any> {
    const root = doc.parseResult.value;
    const workspace = isWorkspace(root) ? root : (root as any).workspaces?.[0];
    return new C4JsonGenerator(services).generate(workspace);
}

describe('quoted keywords', () => {
    it('accepts quoted keywords in a relationship body', async () => {
        const { services, doc } = await build(`workspace {
    model {
        a = softwareSystem "A"
        b = softwareSystem "B"
        a -> b "Calls" "HTTPS:443" {
            "tags" "sample"
            "properties" {
                "status" "Active"
            }
        }
    }
}
`);
        expect(doc.parseResult.parserErrors).toHaveLength(0);
        expect(doc.diagnostics ?? []).toHaveLength(0);

        const json = await generate(services, doc);
        const relationship = json.model.softwareSystems[0].relationships[0];
        expect(relationship.description).toBe('Calls');
        expect(relationship.tags).toContain('sample');
        expect(relationship.properties).toEqual({ status: 'Active' });
    });

    it('keeps a quoted value that happens to be a keyword', async () => {
        const { services, doc } = await build(`workspace {
    model {
        p = person "tags"
        p -> p "self"
    }
}
`);
        expect(doc.parseResult.parserErrors).toHaveLength(0);
        expect(doc.diagnostics ?? []).toHaveLength(0);

        const json = await generate(services, doc);
        expect(json.model.people[0].name).toBe('tags');
    });

    it('parses bare keywords unchanged', async () => {
        const { services, doc } = await build(`workspace {
    model {
        a = softwareSystem "A"
        b = softwareSystem "B"
        a -> b "Calls" {
            tags sample
            properties {
                status "Active"
            }
        }
    }
}
`);
        expect(doc.parseResult.parserErrors).toHaveLength(0);
        expect(doc.diagnostics ?? []).toHaveLength(0);

        const json = await generate(services, doc);
        const relationship = json.model.softwareSystems[0].relationships[0];
        expect(relationship.description).toBe('Calls');
        expect(relationship.tags).toContain('sample');
        expect(relationship.properties).toEqual({ status: 'Active' });
    });
});
