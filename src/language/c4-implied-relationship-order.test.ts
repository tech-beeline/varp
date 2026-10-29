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

async function generate(dsl: string): Promise<any> {
    const services = createC4Services({ connection: undefined as any, ...EmptyFileSystem }).C4;
    const doc = services.shared.workspace.LangiumDocumentFactory.fromString(dsl, URI.parse('file:///implied-relationship-order/input.dsl'));
    services.shared.workspace.LangiumDocuments.addDocument(doc);
    await services.shared.workspace.DocumentBuilder.build([doc]);
    const root: any = doc.parseResult.value;
    return new C4JsonGenerator(services).generate(root.workspaces?.[0] ?? root, doc.uri.toString());
}

/** Id → element name for every static-structure element of the model. */
function elementNames(json: any): Map<string, string> {
    const names = new Map<string, string>();
    const put = (node: any) => { if (node?.id !== undefined) names.set(String(node.id), String(node.name ?? '')); };
    for (const system of json.model.softwareSystems ?? []) {
        put(system);
        for (const container of system.containers ?? []) {
            put(container);
            for (const component of container.components ?? []) put(component);
        }
    }
    for (const person of json.model.people ?? []) put(person);
    return names;
}

/** Descriptions of every model relationship between the two named elements. */
function descriptionsBetween(json: any, source: string, destination: string): string[] {
    const names = elementNames(json);
    const found: string[] = [];
    const collect = (node: any) => {
        for (const rel of node?.relationships ?? []) {
            if (names.get(String(rel.sourceId)) === source && names.get(String(rel.destinationId)) === destination) {
                found.push(String(rel.description ?? ''));
            }
        }
    };
    const walk = (node: any) => {
        collect(node);
        (node.children ?? []).forEach(walk);
        (node.infrastructureNodes ?? []).forEach(walk);
        (node.softwareSystemInstances ?? []).forEach(walk);
        (node.containerInstances ?? []).forEach(walk);
    };
    for (const system of json.model.softwareSystems ?? []) {
        collect(system);
        for (const container of system.containers ?? []) {
            collect(container);
            (container.components ?? []).forEach(collect);
        }
    }
    (json.model.deploymentNodes ?? []).forEach(walk);
    return found.sort();
}

/** Descriptions of the relationships of the container instance of the named container. */
function instanceDescriptions(json: any, container: string): string[] {
    const names = elementNames(json);
    const containerId = [...names.entries()].find(([, name]) => name === container)?.[0];
    const found: string[] = [];
    const walk = (node: any) => {
        for (const instance of node?.containerInstances ?? []) {
            if (String(instance.containerId) === containerId) {
                for (const rel of instance.relationships ?? []) found.push(String(rel.description ?? ''));
            }
        }
        (node.children ?? []).forEach(walk);
    };
    (json.model.deploymentNodes ?? []).forEach(walk);
    return found.sort();
}

const MODEL = (relationships: string) => `workspace {
    model {
        s = softwareSystem "S" {
            b = container "B" {
                b1 = component "B1"
            }
            a = container "A" {
                a1 = component "A1"
${relationships}
            }
        }
    }
}
`;

describe('implied relationship order', () => {
    it('drops an implied relationship when the pair already carries a relationship', async () => {
        const json = await generate(MODEL(`                -> b "first"
                a1 -> b1 "link"`));

        expect(descriptionsBetween(json, 'A', 'B')).toEqual(['first']);
        expect(descriptionsBetween(json, 'A1', 'B1')).toEqual(['link']);
    });

    it('keeps both when the pair is only linked after the implied relationship was created', async () => {
        const json = await generate(MODEL(`                a1 -> b1 "link"
                -> b "second"`));

        expect(descriptionsBetween(json, 'A', 'B')).toEqual(['link', 'second']);
        expect(descriptionsBetween(json, 'A1', 'B1')).toEqual(['link']);
    });

    it('replicates only the parent relationships of the pair onto deployment instances', async () => {
        const json = await generate(`workspace {
    model {
        s = softwareSystem "S" {
            b = container "B" {
                b1 = component "B1"
            }
            a = container "A" {
                a1 = component "A1"
                -> b "first"
                a1 -> b1 "link"
            }
        }
        prod = deploymentEnvironment "Prod" {
            deploymentNode "Node" {
                ai = containerInstance a
                bi = containerInstance b
            }
        }
    }
}
`);

        expect(descriptionsBetween(json, 'A', 'B')).toEqual(['first']);
        expect(instanceDescriptions(json, 'A')).toEqual(['first']);
    });
});
