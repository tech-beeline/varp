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

/** Parses a DSL string, links it, and runs the JSON generator. */
async function generate(views: string): Promise<any> {
    const services = createC4Services({ connection: undefined as any, ...EmptyFileSystem }).C4;
    const content = `workspace {
    !identifiers hierarchical
    model {
        s = softwareSystem "S" {
            queue = container "Queue"
        }
        a = softwareSystem "A"
        b = softwareSystem "B"
        s.queue -> a "publishes" {
            tags Kafka
        }
        s -> b "calls"
    }
    views {
${views}
    }
}`;
    const doc = services.shared.workspace.LangiumDocumentFactory.fromString(
        content,
        URI.parse('file:///system-context-defaults.dsl')
    );
    services.shared.workspace.LangiumDocuments.addDocument(doc);
    await services.shared.workspace.DocumentBuilder.build([doc]);
    expect(doc.parseResult.parserErrors).toHaveLength(0);
    const root: any = doc.parseResult.value;
    const workspace = isWorkspace(root) ? root : root.workspaces[0];
    return new C4JsonGenerator(services).generate(workspace);
}

/** Element names of the view, resolved through the model. */
function viewElements(json: any, view: any): string[] {
    const names = new Map<string, string>();
    for (const group of Object.values(json.model)) {
        if (!Array.isArray(group)) continue;
        for (const element of group as any[]) names.set(element.id, element.name);
    }
    return (view.elements ?? []).map((element: any) => names.get(element.id));
}

describe('system context views', () => {
    it('keeps the scoped system when the include expression matches nothing', async () => {
        const json = await generate(`        systemContext s "ctx" {
            include "relationship.source==s.queue"
        }`);

        const view = json.views.systemContextViews[0];
        expect(view.softwareSystemId).toBe(json.model.softwareSystems[0].id);
        expect(viewElements(json, view)).toEqual(['S']);
        expect(view.relationships ?? []).toEqual([]);
    });

    it('adds the related systems and their relationships for include *', async () => {
        const json = await generate(`        systemContext s "ctx" {
            include *
        }`);

        const view = json.views.systemContextViews[0];
        expect(viewElements(json, view)).toEqual(['S', 'A', 'B']);
        expect(view.relationships ?? []).toHaveLength(2);
    });

    it('does not add elements for a relationship filter alone', async () => {
        const json = await generate(`        systemContext s "ctx" {
            include "relationship.tag==Kafka"
        }`);

        const view = json.views.systemContextViews[0];
        expect(viewElements(json, view)).toEqual(['S']);
    });

});
