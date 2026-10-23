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
import { resolve } from 'node:path';
import { EmptyFileSystem } from 'langium';
import { URI } from 'vscode-uri';
import { createC4Services } from './c4-module';
import { C4JsonGenerator } from './c4-json-generator';

async function generate(dsl: string): Promise<any> {
    const services = createC4Services({ connection: undefined as any, ...EmptyFileSystem }).C4;
    const doc = services.shared.workspace.LangiumDocumentFactory.fromString(dsl, URI.parse('file:///view-relationship-integrity/input.dsl'));
    services.shared.workspace.LangiumDocuments.addDocument(doc);
    await services.shared.workspace.DocumentBuilder.build([doc]);
    const root: any = doc.parseResult.value;
    return new C4JsonGenerator(services).generate(root.workspaces?.[0] ?? root, doc.uri.toString());
}

/** Model relationship ids, collected the way the webview renderer indexes them. */
function modelRelationshipIds(json: any): Set<string> {
    const ids = new Set<string>();
    const addRelationships = (node: any) => (node?.relationships ?? []).forEach((rel: any) => rel?.id && ids.add(String(rel.id)));
    const walkDeployment = (node: any) => {
        addRelationships(node);
        (node.children ?? []).forEach(walkDeployment);
        (node.infrastructureNodes ?? []).forEach(walkDeployment);
        (node.softwareSystemInstances ?? []).forEach(walkDeployment);
        (node.containerInstances ?? []).forEach(walkDeployment);
    };
    (json.model.customElements ?? []).forEach(addRelationships);
    (json.model.people ?? []).forEach(addRelationships);
    (json.model.softwareSystems ?? []).forEach((system: any) => {
        addRelationships(system);
        (system.containers ?? []).forEach((container: any) => {
            addRelationships(container);
            (container.components ?? []).forEach(addRelationships);
        });
    });
    (json.model.deploymentNodes ?? []).forEach(walkDeployment);
    return ids;
}

/** Every relationship id referenced by a view. */
function viewRelationshipIds(json: any): string[] {
    const ids: string[] = [];
    for (const views of Object.values(json.views ?? {})) {
        if (!Array.isArray(views)) continue;
        for (const view of views as any[]) {
            for (const rel of view.relationships ?? []) {
                ids.push(String(rel.id));
            }
        }
    }
    return ids;
}

const DUPLICATE_RELATIONSHIPS = `workspace {
model {
u = person "User"
s = softwareSystem "S" {
c = container "C" {
a = component "A"
b = component "B"
}
}
u -> s "uses"
u -> s "uses"
a -> b "calls"
a -> b "calls"
}
views {
component c {
include *
}
}
}
`;

describe('view relationships reference the model', () => {
    it('never references a relationship the model dropped as a duplicate', async () => {
        const json = await generate(DUPLICATE_RELATIONSHIPS);
        const modelIds = modelRelationshipIds(json);
        const referenced = viewRelationshipIds(json);

        expect(referenced.length).toBeGreaterThan(0);
        for (const id of referenced) {
            expect(modelIds.has(id), `view references relationship ${id} missing from the model`).toBe(true);
        }
    });

    it('keeps one relationship per source/destination/description triple', async () => {
        const json = await generate(DUPLICATE_RELATIONSHIPS);
        const person = json.model.people[0];
        const samePair = (person.relationships ?? []).filter(
            (rel: any) => rel.destinationId === json.model.softwareSystems[0].id,
        );
        expect(samePair).toHaveLength(1);
    });

    it('keeps relationships that share a pair but differ in description', async () => {
        const json = await generate(`workspace {
model {
u = person "User"
s = softwareSystem "S"
u -> s "reads"
u -> s "writes"
}
views {
systemContext s {
include *
}
}
}
`);
        const person = json.model.people[0];
        const descriptions = (person.relationships ?? []).map((rel: any) => rel.description).sort();
        expect(descriptions).toEqual(['reads', 'writes']);

        const modelIds = modelRelationshipIds(json);
        for (const id of viewRelationshipIds(json)) {
            expect(modelIds.has(id)).toBe(true);
        }
    });
});
describe('relationship view shape', () => {
    const DSL = `workspace {
    model {
        a = softwareSystem "A"
        b = softwareSystem "B"
        c = softwareSystem "C"
        a -> b "ab"
        a -> c "ac"
        b -> c "bc"
    }

    views {
        systemLandscape "L" {
            include *
        }
    }
}`;

    it('carries no element coordinates', async () => {
        const json = await generate(DSL);
        const relationships = json.views.systemLandscapeViews[0].relationships;

        expect(relationships.length).toBeGreaterThan(0);
        for (const relationship of relationships) {
            expect(relationship).not.toHaveProperty('x');
            expect(relationship).not.toHaveProperty('y');
        }
    });

    it('has no duplicate consecutive vertices', async () => {
        // A workspace whose edges really are routed around other elements.
        const json = await generate(readFileSync(resolve('test/fixtures/big-bank-plc/input.dsl'), 'utf8'));
        const relationships = Object.keys(json.views)
            .filter(key => Array.isArray(json.views[key]))
            .flatMap(key => json.views[key])
            .flatMap((view: any) => view.relationships ?? []);
        const routed = relationships.filter((relationship: any) => (relationship.vertices ?? []).length > 0);

        expect(routed.length).toBeGreaterThan(0);
        for (const relationship of routed) {
            const vertices = relationship.vertices;
            for (let i = 1; i < vertices.length; i++) {
                expect({ x: vertices[i].x, y: vertices[i].y })
                    .not.toEqual({ x: vertices[i - 1].x, y: vertices[i - 1].y });
            }
        }
    });
});
