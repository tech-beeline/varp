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
    const doc = services.shared.workspace.LangiumDocumentFactory.fromString(dsl, URI.parse('file:///no-relationship.dsl'));
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

function collectRelationships(node: any, result: any[] = []): any[] {
    if (!node || typeof node !== 'object') return result;
    if (Array.isArray(node)) {
        node.forEach(item => collectRelationships(item, result));
        return result;
    }
    if (node.sourceId) result.push(node);
    Object.values(node).forEach(value => collectRelationships(value, result));
    return result;
}

/** Relationships whose source and destination are both container instances in the model. */
function instanceRelationships(json: any): any[] {
    const instanceIds = new Set<string>();
    const walk = (node: any) => {
        if (!node || typeof node !== 'object') return;
        if (Array.isArray(node)) {
            node.forEach(walk);
            return;
        }
        if (Array.isArray(node.containerInstances)) {
            node.containerInstances.forEach((ci: any) => instanceIds.add(ci.id));
        }
        Object.values(node).forEach(walk);
    };
    walk(json.model);
    return collectRelationships(json.model).filter(rel => instanceIds.has(rel.sourceId) && instanceIds.has(rel.destinationId));
}

/** Projected (implied) instance relationships carry a linkedRelationshipId. */
function projectedInstanceRelationships(json: any): any[] {
    return instanceRelationships(json).filter(rel => rel.linkedRelationshipId !== undefined);
}

function workspace(environmentBody: string): string {
    return `workspace {
    !identifiers hierarchical
    model {
        ss = softwareSystem "Software System" {
            ui = container "UI"
            backend = container "Backend"
            ui -> backend "Makes API requests to" "JSON/HTTPS"
        }
        live = deploymentEnvironment "Live" {
            deploymentNode "Node" {
                uiInst = containerInstance ss.ui
                backendInst = containerInstance ss.backend
            }
            ${environmentBody}
        }
    }
}
`;
}

describe('-/> no relationship', () => {
    it('keeps the projected container instance relationship without the directive', async () => {
        const json = await generate(workspace(''));
        const projected = projectedInstanceRelationships(json);
        expect(projected.length).toBeGreaterThan(0);
        expect(projected[0].description).toBe('Makes API requests to');
    });

    it('removes the projected relationship when using container identifiers', async () => {
        const json = await generate(workspace('ss.ui -/> ss.backend {\n            }'));
        expect(projectedInstanceRelationships(json)).toHaveLength(0);
    });

    it('removes the projected relationship when using container instance identifiers', async () => {
        const json = await generate(workspace('uiInst -/> backendInst {\n            }'));
        expect(projectedInstanceRelationships(json)).toHaveLength(0);
    });

    it('removes only the relationship matching the given description', async () => {
        const matching = await generate(workspace('uiInst -/> backendInst "Makes API requests to" {\n            }'));
        expect(projectedInstanceRelationships(matching)).toHaveLength(0);

        const nonMatching = await generate(workspace('uiInst -/> backendInst "Something else" {\n            }'));
        expect(projectedInstanceRelationships(nonMatching).length).toBeGreaterThan(0);
    });

    it('does not remove an explicit relationship between the instances', async () => {
        const json = await generate(workspace('uiInst -/> backendInst {\n            }\n            uiInst -> backendInst "Explicit"'));
        expect(projectedInstanceRelationships(json)).toHaveLength(0);
        const explicit = instanceRelationships(json).filter(rel => rel.linkedRelationshipId === undefined);
        expect(explicit).toHaveLength(1);
        expect(explicit[0].description).toBe('Explicit');
    });
});
