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
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { EmptyFileSystem } from 'langium';
import { URI } from 'vscode-uri';
import { createC4Services } from './c4-module';
import { C4JsonGenerator } from './c4-json-generator';
import { isWorkspace } from '../generated/ast';

async function generate(dsl: string): Promise<any> {
    const services = createC4Services({ connection: undefined as any, ...EmptyFileSystem }).C4;
    const doc = services.shared.workspace.LangiumDocumentFactory.fromString(dsl, URI.parse('file:///deployment-instances.dsl'));
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

function collect(node: any, predicate: (node: any) => boolean, result: any[] = []): any[] {
    if (!node || typeof node !== 'object') return result;
    if (Array.isArray(node)) {
        node.forEach(item => collect(item, predicate, result));
        return result;
    }
    if (predicate(node)) result.push(node);
    Object.values(node).forEach(value => collect(value, predicate, result));
    return result;
}

function allRelationships(json: any): any[] {
    return collect(json.model, node => typeof node.sourceId === 'string');
}

const instanceDsl = `workspace {
    !identifiers hierarchical
    model {
        ss = softwareSystem "Software System" {
            c = container "Container"
        }
        live = deploymentEnvironment "Live" {
            node = deploymentNode "Node" {
                instanceOf ss
                instanceOf ss.c
            }
        }
    }
}
`;

describe('deployment instances', () => {
    it('materialises instanceOf into software system and container instances', async () => {
        const json = await generate(instanceDsl);
        const softwareSystemInstances = collect(json.model, node => Array.isArray(node.softwareSystemInstances)).flatMap(node => node.softwareSystemInstances);
        const containerInstances = collect(json.model, node => Array.isArray(node.containerInstances)).flatMap(node => node.containerInstances);
        expect(softwareSystemInstances).toHaveLength(1);
        expect(containerInstances).toHaveLength(1);
        expect(softwareSystemInstances[0].softwareSystemId).toBeDefined();
        expect(containerInstances[0].containerId).toBeDefined();
    });
});

const projectionDsl = `workspace {
    !identifiers hierarchical
    model {
        ss = softwareSystem "Software System" {
            ui = container "UI"
            backend = container "Backend"
            ui -> backend "Makes API requests to" "JSON/HTTPS"
        }
        live = deploymentEnvironment "Live" {
            node = deploymentNode "Node" {
                uiInst = instanceOf ss.ui
                backendInst = instanceOf ss.backend
                lb = infrastructureNode "Load Balancer"
            }
            ss.ui -> node.lb "To load balancer"
            node.lb -> ss.backend "From load balancer"
        }
    }
}
`;

/** Maps container ids to their names, since instances only carry containerId. */
function containerNames(json: any): Map<string, string> {
    const names = new Map<string, string>();
    for (const container of collect(json.model, node => Array.isArray(node.containers)).flatMap(node => node.containers)) {
        names.set(container.id, container.name);
    }
    return names;
}

/** Container instances grouped by container name, in declaration order. */
function instancesByContainerName(json: any): Map<string, any[]> {
    const names = containerNames(json);
    const byName = new Map<string, any[]>();
    for (const ci of collect(json.model, node => Array.isArray(node.containerInstances)).flatMap(node => node.containerInstances)) {
        const name = names.get(ci.containerId) ?? '';
        const list = byName.get(name) ?? [];
        list.push(ci);
        byName.set(name, list);
    }
    return byName;
}

function instanceIds(json: any): { ui: string; backend: string; lb: string } {
    const names = containerNames(json);
    const containerInstances = collect(json.model, node => Array.isArray(node.containerInstances)).flatMap(node => node.containerInstances);
    const infrastructureNodes = collect(json.model, node => Array.isArray(node.infrastructureNodes)).flatMap(node => node.infrastructureNodes);
    const ui = containerInstances.find((ci: any) => names.get(ci.containerId)?.includes('UI'));
    const backend = containerInstances.find((ci: any) => names.get(ci.containerId)?.includes('Backend'));
    const lb = infrastructureNodes[0];
    return { ui: ui.id, backend: backend.id, lb: lb.id };
}

describe('deployment relationship projection', () => {
    it('projects a static container source onto its container instance', async () => {
        const json = await generate(projectionDsl);
        const ids = instanceIds(json);
        const rel = allRelationships(json).find(r => r.sourceId === ids.ui && r.destinationId === ids.lb);
        expect(rel).toBeDefined();
        expect(rel.description).toBe('To load balancer');
    });

    it('projects a static container destination onto its container instance', async () => {
        const json = await generate(projectionDsl);
        const ids = instanceIds(json);
        const rel = allRelationships(json).find(r => r.sourceId === ids.lb && r.destinationId === ids.backend);
        expect(rel).toBeDefined();
        expect(rel.description).toBe('From load balancer');
    });

    it('does not emit the static container relationship for a deployment-context relationship', async () => {
        const json = await generate(projectionDsl);
        const ids = instanceIds(json);
        const staticUi = collect(json.model, node => Array.isArray(node.containers)).flatMap(node => node.containers).find((c: any) => c.name === 'UI');
        expect(allRelationships(json).some(r => r.sourceId === staticUi.id && r.description === 'To load balancer')).toBe(false);
        expect(ids.ui).toBeDefined();
    });
});

const noRelationshipBodyDsl = `workspace {
    !identifiers hierarchical
    model {
        ss = softwareSystem "Software System" {
            ui = container "UI"
            backend = container "Backend"
            ui -> backend "Makes API requests to" "JSON/HTTPS"
        }
        live = deploymentEnvironment "Live" {
            node = deploymentNode "Node" {
                uiInst = instanceOf ss.ui
                backendInst = instanceOf ss.backend
                lb = infrastructureNode "Load Balancer"
            }
            ss.ui -/> ss.backend {
                ss.ui -> node.lb
            }
        }
    }
}
`;

describe('-/> body relationships', () => {
    it('projects body relationships onto instances and inherits description/technology', async () => {
        const json = await generate(noRelationshipBodyDsl);
        const ids = instanceIds(json);
        const rel = allRelationships(json).find(r => r.sourceId === ids.ui && r.destinationId === ids.lb);
        expect(rel).toBeDefined();
        expect(rel.description).toBe('Makes API requests to');
        expect(rel.technology).toBe('JSON/HTTPS');
        expect(allRelationships(json).some(r => r.sourceId === ids.ui && r.destinationId === ids.backend)).toBe(false);
    });
});

describe('no-relationship fixture', () => {
    const fixturePath = resolve(__dirname, '../../test/fixtures/dsl/no-relationship.dsl');

    function containerInstance(json: any, environment: string, namePart: string): any {
        const names = containerNames(json);
        return collect(json.model, node => Array.isArray(node.containerInstances))
            .flatMap(node => node.containerInstances)
            .find((ci: any) => ci.environment === environment && names.get(ci.containerId)?.includes(namePart));
    }



    it('matches expected behaviour across all deployment environments', async () => {
        const json = await generate(readFileSync(fixturePath, 'utf-8'));
        const relationships = allRelationships(json);

        const relationshipIds = relationships.map(r => r.id);
        expect(new Set(relationshipIds).size).toBe(relationshipIds.length);

        // Environment One: ui -> backend is kept.
        const oneUi = containerInstance(json, 'One', 'UI');
        const oneBackend = containerInstance(json, 'One', 'Backend');
        expect(relationships.some(r => r.sourceId === oneUi.id && r.destinationId === oneBackend.id)).toBe(true);

        for (const environment of ['Two', 'Three']) {
            const ui = containerInstance(json, environment, 'UI');
            const backend = containerInstance(json, environment, 'Backend');

            // ui -> backend is removed and replaced by ui -> load balancer -> backend.
            expect(relationships.some(r => r.sourceId === ui.id && r.destinationId === backend.id)).toBe(false);
            const toLb = relationships.find(r => r.sourceId === ui.id);
            expect(toLb?.description).toBe('Makes API requests to');
            expect(toLb?.technology).toBe('JSON/HTTPS');
            const fromLb = relationships.find(r => r.sourceId === toLb?.destinationId && r.destinationId === backend.id);
            expect(fromLb?.description).toBe('Forwards API requests to');
            // Empty technology is omitted.
            expect(fromLb?.technology).toBeUndefined();
        }
    });
});

const deploymentGroupsDsl = `workspace {
    !identifiers hierarchical
    model {
        ss = softwareSystem "Software System" {
            ui = container "UI"
            backend = container "Backend"
            ui -> backend "Makes API requests to" "JSON/HTTPS"
        }
        live = deploymentEnvironment "Live" {
            serviceInstance1 = deploymentGroup "Service Instance 1"
            serviceInstance2 = deploymentGroup "Service Instance 2"
            node = deploymentNode "Node" {
                uiOne = containerInstance ui serviceInstance1
                backendOne = containerInstance backend serviceInstance1
                uiTwo = containerInstance ui serviceInstance2
                backendTwo = containerInstance backend serviceInstance2
            }
            nodeInherited = deploymentNode "Inherited Node" {
                deploymentGroup serviceInstance1
                uiInherited = containerInstance ui
            }
        }
    }
}
`;

describe('deployment groups', () => {
    it('emits the single deployment group of an instance', async () => {
        const json = await generate(deploymentGroupsDsl);
        const instances = instancesByContainerName(json);
        expect(instances.get('UI')![0].deploymentGroups).toEqual(['Service Instance 1']);
        expect(instances.get('UI')![1].deploymentGroups).toEqual(['Service Instance 2']);
        expect(instances.get('Backend')![0].deploymentGroups).toEqual(['Service Instance 1']);
        expect(instances.get('Backend')![1].deploymentGroups).toEqual(['Service Instance 2']);
    });

    it('keeps the deployment groups of the node out of the instance field', async () => {
        const json = await generate(deploymentGroupsDsl);
        // The reference inherits node groups only for relationship scoping, not in the
        // instance's own deploymentGroups
        const inherited = instancesByContainerName(json).get('UI')![2];
        expect(inherited.deploymentGroups).toBeUndefined();
    });

    it('emits a comma separated group list sorted by name', async () => {
        const json = await generate(`workspace {
    model {
        ss = softwareSystem "Software System" {
            c = container "Container"
        }
        live = deploymentEnvironment "Live" {
            serviceInstance2 = deploymentGroup "Service Instance 2"
            serviceInstance1 = deploymentGroup "Service Instance 1"
            node = deploymentNode "Node" {
                instance = containerInstance c serviceInstance2,serviceInstance1
            }
        }
    }
}
`);
        const instance = collect(json.model, node => Array.isArray(node.containerInstances)).flatMap(node => node.containerInstances)[0];
        expect(instance.deploymentGroups).toEqual(['Service Instance 1', 'Service Instance 2']);
    });

    it('projects a relationship only between instances that share a group', async () => {
        const json = await generate(deploymentGroupsDsl);
        const instances = instancesByContainerName(json);
        const uiOne = instances.get('UI')![0];
        const uiTwo = instances.get('UI')![1];
        const backendOne = instances.get('Backend')![0];
        const backendTwo = instances.get('Backend')![1];
        const relationships = allRelationships(json);
        const projected = (source: any, destination: any) =>
            relationships.some(r => r.sourceId === source.id && r.destinationId === destination.id);

        // Same group: projected
        expect(projected(uiOne, backendOne)).toBe(true);
        expect(projected(uiTwo, backendTwo)).toBe(true);
        // Different groups: the reference does not project across them
        expect(projected(uiOne, backendTwo)).toBe(false);
        expect(projected(uiTwo, backendOne)).toBe(false);
    });
});
