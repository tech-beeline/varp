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
import { URI, Utils } from 'vscode-uri';
import { createC4Services } from './c4-module';
import { C4JsonGenerator } from './c4-json-generator';

const PROJECT = URI.parse('file:///include-in-element/');

/** Builds a project from virtual files and generates the JSON of `main.dsl`. */
async function generate(files: Record<string, string>): Promise<any> {
    const services = createC4Services({ connection: undefined as any, ...EmptyFileSystem }).C4;
    const docs = [];
    for (const [name, content] of Object.entries(files)) {
        const doc = services.shared.workspace.LangiumDocumentFactory.fromString(content, Utils.resolvePath(PROJECT, name));
        services.shared.workspace.LangiumDocuments.addDocument(doc);
        docs.push(doc);
    }
    await services.shared.workspace.DocumentBuilder.build(docs);
    const errors = docs.flatMap(doc => (doc.parseResult.parserErrors ?? []).map((error: any) => `${doc.uri.path}: ${error.message}`));
    expect(errors.join('\n')).toBe('');
    const main = docs[0];
    const root: any = main.parseResult.value;
    return new C4JsonGenerator(services).generate(root.workspaces?.[0] ?? root, main.uri.toString());
}

const names = (items: any[] | undefined): string[] => (items ?? []).map(item => item.name);

describe('!include inside element bodies', () => {
    it('contributes containers to a software system', async () => {
        const json = await generate({
            'main.dsl': `workspace {\nmodel {\ns = softwareSystem "S" {\n!include 'children.dsl'\n}\n}\n}\n`,
            'children.dsl': `c = container "C"\n`,
        });
        expect(names(json.model.softwareSystems[0].containers)).toEqual(['C']);
    });

    it('contributes containers to a software system through a group', async () => {
        const json = await generate({
            'main.dsl': `workspace {\nmodel {\ns = softwareSystem "S" {\ngroup "G" {\n!include 'children.dsl'\n}\n}\n}\n}\n`,
            'children.dsl': `c = container "C"\n`,
        });
        expect(names(json.model.softwareSystems[0].containers)).toEqual(['C']);
        expect(json.model.softwareSystems[0].containers[0].group).toBe('G');
    });

    it('contributes components to a container', async () => {
        const json = await generate({
            'main.dsl': `workspace {\nmodel {\ns = softwareSystem "S" {\nc = container "C" {\n!include 'children.dsl'\n}\n}\n}\n}\n`,
            'children.dsl': `comp = component "Comp"\n`,
        });
        expect(names(json.model.softwareSystems[0].containers[0].components)).toEqual(['Comp']);
    });

    it('contributes relationships to a component', async () => {
        const json = await generate({
            'main.dsl': `workspace {\nmodel {\ns = softwareSystem "S" {\nc = container "C" {\na = component "A" {\n!include 'children.dsl'\n}\nb = component "B"\n}\n}\n}\n}\n`,
            'children.dsl': `a -> b "uses"\n`,
        });
        const components = json.model.softwareSystems[0].containers[0].components;
        const relationships = components.flatMap((component: any) => component.relationships ?? []);
        const namesById = new Map(components.map((component: any) => [component.id, component.name]));
        expect(relationships).toHaveLength(1);
        expect(namesById.get(relationships[0].sourceId)).toBe('A');
        expect(namesById.get(relationships[0].destinationId)).toBe('B');
    });

    it('contributes child nodes, infrastructure nodes and instances to a deployment node', async () => {
        const json = await generate({
            'main.dsl': `workspace {\nmodel {\ns = softwareSystem "S" {\nc = container "C"\n}\nlive = deploymentEnvironment "Live" {\nnode = deploymentNode "Node" {\n!include 'children.dsl'\n}\n}\n}\n}\n`,
            'children.dsl': `child = deploymentNode "Child"\ninfra = infrastructureNode "Infra"\ninst = containerInstance c\n`,
        });
        const node = json.model.deploymentNodes[0];
        expect(names(node.children)).toEqual(['Child']);
        expect(names(node.infrastructureNodes)).toEqual(['Infra']);
        expect(node.containerInstances).toHaveLength(1);
    });

    it('contributes deployment nodes to a deployment environment', async () => {
        const json = await generate({
            'main.dsl': `workspace {\nmodel {\nlive = deploymentEnvironment "Live" {\n!include 'children.dsl'\n}\n}\n}\n`,
            'children.dsl': `node = deploymentNode "Node"\n`,
        });
        expect(names(json.model.deploymentNodes)).toEqual(['Node']);
    });

    it('contributes elements to a group at model level', async () => {
        const json = await generate({
            'main.dsl': `workspace {\nmodel {\ngroup "G" {\n!include 'children.dsl'\n}\n}\n}\n`,
            'children.dsl': `s = softwareSystem "S"\n`,
        });
        expect(names(json.model.softwareSystems)).toEqual(['S']);
        expect(json.model.softwareSystems[0].group).toBe('G');
    });

    it('contributes elements to a model block', async () => {
        const json = await generate({
            'main.dsl': `workspace {\nmodel {\n!include 'children.dsl'\n}\n}\n`,
            'children.dsl': `s = softwareSystem "S"\n`,
        });
        expect(names(json.model.softwareSystems)).toEqual(['S']);
    });
});

describe('!include inside !element bodies', () => {
    it('contributes containers to an extended software system', async () => {
        const json = await generate({
            'main.dsl': `workspace {\nmodel {\ns = softwareSystem "S"\n!element s {\n!include 'children.dsl'\n}\n}\n}\n`,
            'children.dsl': `c = container "C"\n`,
        });
        expect(names(json.model.softwareSystems[0].containers)).toEqual(['C']);
    });

    it('contributes containers to an extended software system through a group', async () => {
        const json = await generate({
            'main.dsl': `workspace {\nmodel {\ns = softwareSystem "S"\n!element s {\ngroup "G" {\n!include 'children.dsl'\n}\n}\n}\n}\n`,
            'children.dsl': `c = container "C"\n`,
        });
        expect(names(json.model.softwareSystems[0].containers)).toEqual(['C']);
    });

    it('contributes components to an extended container', async () => {
        const json = await generate({
            'main.dsl': `workspace {\nmodel {\ns = softwareSystem "S" {\nc = container "C"\n}\n!element c {\n!include 'children.dsl'\n}\n}\n}\n`,
            'children.dsl': `comp = component "Comp"\n`,
        });
        expect(names(json.model.softwareSystems[0].containers[0].components)).toEqual(['Comp']);
    });

    it('contributes child nodes, infrastructure nodes and instances to an extended deployment node', async () => {
        const json = await generate({
            'main.dsl': `workspace {\nmodel {\ns = softwareSystem "S" {\nc = container "C"\n}\nlive = deploymentEnvironment "Live" {\nnode = deploymentNode "Node"\n}\n!element node {\n!include 'children.dsl'\n}\n}\n}\n`,
            'children.dsl': `child = deploymentNode "Child"\ninfra = infrastructureNode "Infra"\ninst = containerInstance c\n`,
        });
        const node = json.model.deploymentNodes[0];
        expect(names(node.children)).toEqual(['Child']);
        expect(names(node.infrastructureNodes)).toEqual(['Infra']);
        expect(node.containerInstances).toHaveLength(1);
    });

    it('contributes relationships to an extended component', async () => {
        const json = await generate({
            'main.dsl': `workspace {\nmodel {\ns = softwareSystem "S" {\nc = container "C" {\na = component "A"\nb = component "B"\n}\n}\n!element a {\n!include 'children.dsl'\n}\n}\n}\n`,
            'children.dsl': `a -> b "uses"\n`,
        });
        const components = json.model.softwareSystems[0].containers[0].components;
        const relationships = components.flatMap((component: any) => component.relationships ?? []);
        const namesById = new Map(components.map((component: any) => [component.id, component.name]));
        expect(relationships).toHaveLength(1);
        expect(namesById.get(relationships[0].sourceId)).toBe('A');
        expect(namesById.get(relationships[0].destinationId)).toBe('B');
    });

    it('contributes relationships to a person', async () => {
        const json = await generate({
            'main.dsl': `workspace {\nmodel {\nu = person "U" {\n!include 'children.dsl'\n}\ns = softwareSystem "S"\n}\n}\n`,
            'children.dsl': `u -> s "uses"\n`,
        });
        const person = json.model.people[0];
        expect(person.relationships).toHaveLength(1);
        expect(person.relationships[0].destinationId).toBe(json.model.softwareSystems[0].id);
    });

    it('contributes relationships to an infrastructure node', async () => {
        const json = await generate({
            'main.dsl': `workspace {\nmodel {\nlive = deploymentEnvironment "Live" {\nnode = deploymentNode "Node" {\ninfra = infrastructureNode "Infra" {\n!include 'children.dsl'\n}\n}\n}\n}\n}\n`,
            'children.dsl': `infra -> node "connects"\n`,
        });
        const infra = json.model.deploymentNodes[0].infrastructureNodes[0];
        expect(infra.relationships).toHaveLength(1);
        expect(infra.relationships[0].destinationId).toBe(json.model.deploymentNodes[0].id);
    });

    it('contributes relationships to a custom element', async () => {
        const json = await generate({
            'main.dsl': `workspace {\nmodel {\ns = softwareSystem "S"\ncustom = element "Custom" {\n!include 'children.dsl'\n}\n}\n}\n`,
            'children.dsl': `custom -> s "uses"\n`,
        });
        const custom = json.model.customElements[0];
        expect(custom.relationships).toHaveLength(1);
        expect(custom.relationships[0].destinationId).toBe(json.model.softwareSystems[0].id);
    });

    it('contributes relationships to a container instance', async () => {
        const json = await generate({
            'main.dsl': `workspace {\nmodel {\ns = softwareSystem "S" {\nc = container "C"\n}\nlive = deploymentEnvironment "Live" {\nnode = deploymentNode "Node" {\ninst = containerInstance c {\n!include 'children.dsl'\n}\n}\n}\n}\n}\n`,
            'children.dsl': `inst -> node "connects"\n`,
        });
        const instance = json.model.deploymentNodes[0].containerInstances[0];
        expect(instance.relationships).toHaveLength(1);
    });

    it('contributes child nodes to a deployment node through a group', async () => {
        const json = await generate({
            'main.dsl': `workspace {\nmodel {\nlive = deploymentEnvironment "Live" {\nnode = deploymentNode "Node" {\ngroup "G" {\n!include 'children.dsl'\n}\n}\n}\n}\n}\n`,
            'children.dsl': `child = deploymentNode "Child"\n`,
        });
        const node = json.model.deploymentNodes[0];
        expect(names(node.children)).toEqual(['Child']);
        expect(node.children[0].group).toBe('G');
    });

    it('contributes deployment nodes to a deployment environment through a group', async () => {
        const json = await generate({
            'main.dsl': `workspace {\nmodel {\nlive = deploymentEnvironment "Live" {\ngroup "G" {\n!include 'children.dsl'\n}\n}\n}\n}\n`,
            'children.dsl': `node = deploymentNode "Node"\n`,
        });
        expect(names(json.model.deploymentNodes)).toEqual(['Node']);
        expect(json.model.deploymentNodes[0].group).toBe('G');
    });
});
