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
import { EmptyFileSystem } from 'langium';
import { URI } from 'vscode-uri';
import { createC4Services } from './c4-module';
import { C4JsonGenerator } from './c4-json-generator';
import { isWorkspace } from '../generated/ast';

async function generate(dsl: string): Promise<any> {
    const services = createC4Services({ connection: undefined as any, ...EmptyFileSystem }).C4;
    const doc = services.shared.workspace.LangiumDocumentFactory.fromString(dsl, URI.parse('file:///elements.dsl'));
    services.shared.workspace.LangiumDocuments.addDocument(doc);
    await services.shared.workspace.DocumentBuilder.build([doc]);
    const root = doc.parseResult.value;
    if (isWorkspace(root)) {
        return new C4JsonGenerator(services).generate(root);
    }
    const anyRoot = root as any;
    if (anyRoot.$type === 'C4Document' && anyRoot.workspaces?.length > 0) {
        return new C4JsonGenerator(services).generate(anyRoot.workspaces[0]);
    }
    throw new Error('No workspace found');
}

const dsl = `workspace {
    model {
        app = softwareSystem "App" {
            c1 = container "C1"
            c2 = container "C2"
        }
        db = softwareSystem "DB"

        !elements element.type==Container {
            description "Bulk description"
            technology "Bulk technology"
            this -> db "Uses"
        }
    }
}
`;

describe('!elements directive', () => {
    it('applies description and technology to the matched elements', async () => {
        const json = await generate(dsl);
        const app = json.model.softwareSystems.find((s: any) => s.name === 'App');
        for (const container of app.containers) {
            expect(container.description).toBe('Bulk description');
            expect(container.technology).toBe('Bulk technology');
        }
    });

    it('creates a relationship from every matched element', async () => {
        const json = await generate(dsl);
        const app = json.model.softwareSystems.find((s: any) => s.name === 'App');
        const db = json.model.softwareSystems.find((s: any) => s.name === 'DB');
        for (const container of app.containers) {
            const relationships = container.relationships.filter((r: any) => r.destinationId === db.id);
            expect(relationships).toHaveLength(1);
            expect(relationships[0].description).toBe('Uses');
        }
    });

    it('creates an implicit relationship from every matched element', async () => {
        const json = await generate(`workspace {
    model {
        app = softwareSystem "App" {
            c1 = container "C1"
            c2 = container "C2"
        }
        db = softwareSystem "DB"

        !elements element.type==Container {
            -> db "Uses"
        }
    }
}
`);
        const app = json.model.softwareSystems.find((s: any) => s.name === 'App');
        const db = json.model.softwareSystems.find((s: any) => s.name === 'DB');
        for (const container of app.containers) {
            expect(container.relationships.some((r: any) => r.destinationId === db.id)).toBe(true);
        }
    });

    it('rejects an !include inside !elements', async () => {
        const services = createC4Services({ connection: undefined as any, ...EmptyFileSystem }).C4;
        const doc = services.shared.workspace.LangiumDocumentFactory.fromString(`workspace {
    model {
        !elements element.type==Container {
            !include "frag.dsl"
        }
    }
}
`, URI.parse('file:///elements-include.dsl'));
        services.shared.workspace.LangiumDocuments.addDocument(doc);
        await services.shared.workspace.DocumentBuilder.build([doc]);

        expect(doc.parseResult.parserErrors.length).toBeGreaterThan(0);
    });

    it('uses every matched element as the target of a `user -> this` relationship', async () => {
        const json = await generate(`workspace {
    model {
        user = person "User"
        app = softwareSystem "App" {
            c1 = container "C1"
            c2 = container "C2"
        }

        !elements element.type==Container {
            user -> this "Uses"
        }
    }
}
`);
        const user = json.model.people[0];
        const app = json.model.softwareSystems.find((s: any) => s.name === 'App');
        for (const container of app.containers) {
            expect(user.relationships.some((r: any) => r.destinationId === container.id)).toBe(true);
        }
    });
});
