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

const PROJECT = URI.parse('file:///include-in-views/');

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

describe('!include inside a views block', () => {
    it('contributes a container view', async () => {
        const json = await generate({
            'main.dsl': `workspace {\nmodel {\ns = softwareSystem "S" {\nc = container "C"\n}\n}\nviews {\n!include 'children.dsl'\n}\n}\n`,
            'children.dsl': `container s {\ninclude *\n}\n`,
        });
        expect(json.views.containerViews).toHaveLength(1);
    });

    it('contributes views from a nested views block', async () => {
        const json = await generate({
            'main.dsl': `workspace {\nmodel {\ns = softwareSystem "S" {\nc = container "C"\n}\n}\nviews {\n!include 'children.dsl'\n}\n}\n`,
            'children.dsl': `views {\ncontainer s {\ninclude *\n}\n}\n`,
        });
        expect(json.views.containerViews).toHaveLength(1);
    });

    it('contributes a system context view', async () => {
        const json = await generate({
            'main.dsl': `workspace {\nmodel {\ns = softwareSystem "S"\n}\nviews {\n!include 'children.dsl'\n}\n}\n`,
            'children.dsl': `systemContext s {\ninclude *\n}\n`,
        });
        expect(json.views.systemContextViews).toHaveLength(1);
    });

    it('contributes a system landscape view', async () => {
        const json = await generate({
            'main.dsl': `workspace {\nmodel {\ns = softwareSystem "S"\nu = person "U"\n}\nviews {\n!include 'children.dsl'\n}\n}\n`,
            'children.dsl': `systemLandscape {\ninclude *\n}\n`,
        });
        expect(json.views.systemLandscapeViews).toHaveLength(1);
    });

    it('contributes a deployment view', async () => {
        const json = await generate({
            'main.dsl': `workspace {\nmodel {\ns = softwareSystem "S" {\nc = container "C"\n}\nlive = deploymentEnvironment "Live" {\nnode = deploymentNode "Node" {\ninst = containerInstance c\n}\n}\n}\nviews {\n!include 'children.dsl'\n}\n}\n`,
            'children.dsl': `deployment s live {\ninclude *\n}\n`,
        });
        expect(json.views.deploymentViews).toHaveLength(1);
    });

    it('contributes a dynamic view', async () => {
        const json = await generate({
            'main.dsl': `workspace {\nmodel {\nu = person "U"\ns = softwareSystem "S"\nu -> s\n}\nviews {\n!include 'children.dsl'\n}\n}\n`,
            'children.dsl': `dynamic * {\nu -> s\n}\n`,
        });
        expect(json.views.dynamicViews).toHaveLength(1);
    });

    it('contributes a filtered view', async () => {
        const json = await generate({
            'main.dsl': `workspace {\nmodel {\ns = softwareSystem "S"\n}\nviews {\nsystemContext s "sc" {\ninclude *\n}\n!include 'children.dsl'\n}\n}\n`,
            'children.dsl': `filtered sc exclude "zzz"\n`,
        });
        expect(json.views.systemContextViews).toHaveLength(1);
        expect(json.views.filteredViews).toHaveLength(1);
    });

    it('accepts a simple script in a views fragment', async () => {
        const json = await generate({
            'main.dsl': `workspace {\nmodel {\ns = softwareSystem "S" {\nc = container "C"\n}\n}\nviews {\n!include 'children.dsl'\n}\n}\n`,
            'children.dsl': `views {\n!script groovy {\nprintln "hi"\n}\n}\n`,
        });
        expect(json.views.containerViews ?? []).toHaveLength(0);
    });

    it('accepts a script with nested braces in a views fragment', async () => {
        const json = await generate({
            'main.dsl': `workspace {\nmodel {\ns = softwareSystem "S" {\nc = container "C"\n}\n}\nviews {\n!include 'children.dsl'\n}\n}\n`,
            'children.dsl': `views {\n!script groovy {\nlist.forEach { it.description = "x" }\n}\n}\n`,
        });
        expect(json.views.containerViews ?? []).toHaveLength(0);
    });

    it('accepts a script in a views fragment', async () => {
        const json = await generate({
            'main.dsl': `workspace {\nmodel {\ns = softwareSystem "S" {\nc = container "C"\n}\n}\nviews {\n!include 'children.dsl'\n}\n}\n`,
            'children.dsl': `views {\n!script groovy {\nworkspace.model.relationships.forEach { it.description = (it.linkedRelationshipId != null ? it.linkedRelationshipId : it.id) + " -- " + it.description }\n}\n}\n`,
        });
        expect(json.views.containerViews ?? []).toHaveLength(0);
    });
});
