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
    const doc = services.shared.workspace.LangiumDocumentFactory.fromString(dsl, URI.parse('file:///relationships.dsl'));
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

/** Every element JSON object that can own a `relationships` array, with its id. */
function relationshipOwners(model: any): { ownerId: string; relationships: any[] }[] {
    const owners: { ownerId: string; relationships: any[] }[] = [];
    const add = (node: any) => {
        if (node?.relationships?.length) owners.push({ ownerId: node.id, relationships: node.relationships });
    };
    for (const person of model.people ?? []) add(person);
    for (const custom of model.customElements ?? []) add(custom);
    for (const system of model.softwareSystems ?? []) {
        add(system);
        for (const container of system.containers ?? []) {
            add(container);
            for (const component of container.components ?? []) add(component);
        }
    }
    return owners;
}

describe('relationship ownership and deduplication', () => {
    const dsl = `workspace {
    model {
        !impliedRelationships true
        a = softwareSystem "A" {
            a1 = container "A1"
            a2 = container "A2"
        }
        b = softwareSystem "B" {
            b1 = container "B1"
        }
        a1 -> b1 "calls"
        a2 -> b1 "calls"
    }
}
`;

    it('nests every relationship under the element that is its source', async () => {
        const json = await generate(dsl);
        const owners = relationshipOwners(json.model);
        const total = owners.reduce((sum, owner) => sum + owner.relationships.length, 0);

        // Guards against a vacuous pass if the model shape ever changes.
        expect(owners.length).toBeGreaterThan(0);
        expect(total).toBeGreaterThan(0);
        for (const owner of owners) {
            for (const relationship of owner.relationships) {
                expect(relationship.sourceId).toBe(owner.ownerId);
            }
        }
    });

    it('creates one implied relationship per source/destination pair', async () => {
        const json = await generate(dsl);
        const systemA = json.model.softwareSystems.find((s: any) => s.name === 'A');
        const systemB = json.model.softwareSystems.find((s: any) => s.name === 'B');

        expect(systemA.relationships.length).toBeGreaterThan(0);
        const aToB = systemA.relationships.filter((r: any) => r.destinationId === systemB.id);
        expect(aToB).toHaveLength(1);
        // The pair is implied, not declared, so it must carry a linked relationship id.
        expect(aToB[0].linkedRelationshipId).toBeDefined();
    });
});

describe('duplicate relationships', () => {
    it('keeps one relationship per source/destination pair and description', async () => {
        const json = await generate(`workspace {
    model {
        a = softwareSystem "A"
        b = softwareSystem "B"
        a -> b "Uses"
        a -> b "Uses"
        a -> b "Uses twice"
    }
}
`);
        const systemA = json.model.softwareSystems.find((s: any) => s.name === 'A');
        const systemB = json.model.softwareSystems.find((s: any) => s.name === 'B');
        const aToB = systemA.relationships.filter((r: any) => r.destinationId === systemB.id);
        expect(aToB).toHaveLength(2);
        expect(aToB.map((r: any) => r.description).sort()).toEqual(['Uses', 'Uses twice']);
    });
});
