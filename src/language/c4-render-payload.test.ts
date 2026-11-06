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

const DSL = `workspace {
    model {
        p1 = person "Person"
        s1 = softwareSystem "A" {
            c1 = container "C1"
            c2 = container "C2"
        }
        s2 = softwareSystem "B" {
            c3 = container "C3"
        }
        p1 -> c1 "uses"
        c1 -> c3 "calls"
        prod = deploymentEnvironment "Prod" {
            d1 = deploymentNode "D" {
                d2 = deploymentNode "D2" {
                    i1 = infrastructureNode "I"
                    ai = containerInstance c1
                    bi = containerInstance c3
                    ai -> bi "calls"
                }
            }
        }
    }
    views {
        systemContext s1 "ctx" {
            include *
        }
        container s2 "cont" {
            include *
        }
        deployment * prod "dep" {
            include *
        }
        filtered "ctx" include "Person" "f"
    }
}`;

async function generateView(content: string, key: string): Promise<any> {
    const services = createC4Services({ connection: undefined as any, ...EmptyFileSystem }).C4;
    const document = services.shared.workspace.LangiumDocumentFactory.fromString(content, URI.parse('file:///payload.dsl'));
    services.shared.workspace.LangiumDocuments.addDocument(document);
    await services.shared.workspace.DocumentBuilder.build([document]);
    const root: any = document.parseResult.value;
    const workspace = isWorkspace(root) ? root : root.workspaces[0];
    return new C4JsonGenerator(services).generateView(workspace, key);
}

const ELEMENT_ARRAYS = [
    'people', 'softwareSystems', 'deploymentNodes',
    'containers', 'components', 'children',
    'infrastructureNodes', 'softwareSystemInstances', 'containerInstances'
];

function modelRelationships(model: any): any[] {
    const relationships: any[] = [];
    const walk = (nodes: any[]) => {
        for (const node of nodes ?? []) {
            relationships.push(...(node.relationships ?? []));
            for (const key of ELEMENT_ARRAYS) if (Array.isArray(node[key])) walk(node[key]);
        }
    };
    for (const key of ['people', 'softwareSystems', 'deploymentNodes']) walk(model[key]);
    return relationships;
}

function modelContent(model: any): { elements: string[]; names: string[]; relationships: string[]; endpoints: string[] } {
    const elements: string[] = [];
    const names: string[] = [];
    const relationships: string[] = [];
    const endpoints: string[] = [];
    const walk = (nodes: any[]) => {
        for (const node of nodes ?? []) {
            elements.push(String(node.id));
            names.push(String(node.name));
            for (const relationship of node.relationships ?? []) {
                relationships.push(String(relationship.id));
                endpoints.push(String(relationship.sourceId), String(relationship.destinationId));
            }
            for (const key of ELEMENT_ARRAYS) if (Array.isArray(node[key])) walk(node[key]);
        }
    };
    for (const key of ['people', 'softwareSystems', 'deploymentNodes']) walk(model[key]);
    return { elements: elements.sort(), names: names.sort(), relationships: relationships.sort(), endpoints: endpoints.sort() };
}

describe('per-view payload', () => {
    it('builds only the requested view', async () => {
        const payload = await generateView(DSL, 'ctx');

        const viewArrays = Object.entries(payload.views)
            .filter(([key, value]) => key !== 'configuration' && value !== undefined)
            .map(([key]) => key);
        expect(viewArrays).toEqual(['systemContextViews']);
        expect(payload.views.systemContextViews).toHaveLength(1);
        expect(payload.views.systemContextViews[0].key).toBe('ctx');
    });

    it('keeps the view elements, their ancestors and the view relationships', async () => {
        const payload = await generateView(DSL, 'cont');

        const { names } = modelContent(payload.model);
        expect(names).toEqual(['A', 'B', 'C3']);
        expect(names).not.toContain('C1');
        expect(names).not.toContain('C2');
        expect(payload.views.containerViews[0].key).toBe('cont');
        expect(payload.views.systemContextViews).toBeUndefined();
    });

    it('keeps the deployment tree around an infrastructure node', async () => {
        const payload = await generateView(DSL, 'dep');

        const { elements, endpoints, relationships } = modelContent(payload.model);
        const view = payload.views.deploymentViews[0];
        const viewElements = (view.elements ?? []).map((element: any) => String(element.id));
        const viewRelationships = (view.relationships ?? []).map((relationship: any) => String(relationship.id));

        expect(viewElements.every((id: string) => elements.includes(id))).toBe(true);
        expect(relationships).toEqual(viewRelationships.sort());
        expect(endpoints.every((id: string) => elements.includes(id))).toBe(true);
        expect(payload.views.deploymentViews[0].key).toBe('dep');
    });

    it('keeps the referenced software systems and containers of a deployment view', async () => {
        const payload = await generateView(DSL, 'dep');

        // Collect every softwareSystemId / containerId the deployment model tree references.
        const referenced: string[] = [];
        const walk = (node: any): void => {
            if (!node || typeof node !== 'object') return;
            if (Array.isArray(node)) { for (const child of node) walk(child); return; }
            if (typeof node.softwareSystemId === 'string') referenced.push(node.softwareSystemId);
            if (typeof node.containerId === 'string') referenced.push(node.containerId);
            for (const key of ['children', 'infrastructureNodes', 'softwareSystemInstances', 'containerInstances']) {
                if (Array.isArray(node[key])) walk(node[key]);
            }
        };
        walk(payload.model.deploymentNodes);

        // The deployment view must reference at least one base software system / container.
        expect(referenced.length).toBeGreaterThan(0);
        // Every referenced base element must be present in the payload model, otherwise
        // the renderer crashes in #registerDeploymentNode (Cannot read properties of
        // undefined (reading 'name')).
        const { elements, names } = modelContent(payload.model);
        for (const id of referenced) {
            expect(elements).toContain(id);
        }
        // The referenced software systems must be named (the renderer reads .name).
        const systemNames = (payload.model.softwareSystems ?? []).map((s: any) => s.name);
        expect(systemNames.length).toBeGreaterThan(0);
    });

    it('keeps the base view of a filtered view', async () => {
        const payload = await generateView(DSL, 'f');

        expect(payload.views.filteredViews[0].key).toBe('f');
        expect(payload.views.systemContextViews[0].key).toBe('ctx');
    });

    it('keeps the linked relationships the renderer follows for tags', async () => {
        const payload = await generateView(DSL, 'ctx');

        const view = payload.views.systemContextViews[0];
        const relationships = modelRelationships(payload.model);
        const byId = new Map(relationships.map((relationship: any) => [String(relationship.id), relationship]));

        const viewRelationships = (view.relationships ?? []).map((relationship: any) => byId.get(String(relationship.id)));
        expect(viewRelationships.every(Boolean)).toBe(true);

        const pending = viewRelationships
            .map((relationship: any) => relationship?.linkedRelationshipId)
            .filter((id: any) => id !== undefined)
            .map(String);
        expect(pending.length).toBeGreaterThan(0);

        // Every link, including transitive ones, resolves inside the payload.
        const seen = new Set<string>();
        while (pending.length > 0) {
            const id = pending.pop()!;
            if (seen.has(id)) continue;
            seen.add(id);
            const linked = byId.get(id);
            expect(linked).toBeDefined();
            if (linked?.linkedRelationshipId !== undefined) {
                pending.push(String(linked.linkedRelationshipId));
            }
        }
    });

    it('keeps the workspace metadata and the view configuration', async () => {
        const payload = await generateView(DSL, 'ctx');

        expect(payload.id).toBe(1);
        expect(payload.views.configuration).toBeDefined();
    });

    it('returns undefined for an unknown view', async () => {
        expect(await generateView(DSL, 'missing')).toBeUndefined();
    });
});
