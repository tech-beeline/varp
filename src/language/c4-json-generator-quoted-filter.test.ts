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

/** A quoted view filter whose value is a single keyword token (no whitespace). */
const DSL = `workspace {
    !identifiers hierarchical
    model {
        ss = softwareSystem "Software System" {
            ui = container "UI"
        }
        live = deploymentEnvironment "Live" {
            node = deploymentNode "Node" {
                uiInst = instanceOf ss.ui
                lb = infrastructureNode "Load Balancer"
                ssInst = instanceOf ss
            }
        }
    }
    views {
        deployment ss "Live" {
            include *
            exclude "*->*" "element.type==infrastructureNode" "element.type==softwareSystemInstance"
        }
    }
}
`;

async function generate(dsl: string) {
    const services = createC4Services({ connection: undefined as any, ...EmptyFileSystem }).C4;
    const doc = services.shared.workspace.LangiumDocumentFactory.fromString(dsl, URI.parse('file:///quoted-filter.dsl'));
    services.shared.workspace.LangiumDocuments.addDocument(doc);
    await services.shared.workspace.DocumentBuilder.build([doc]);
    const root = doc.parseResult.value;
    const workspace = isWorkspace(root) ? root : (root as any).workspaces?.[0];
    return new C4JsonGenerator(services).generate(workspace);
}

describe('quoted view filter with keyword values', () => {
    it('parses element.type==<keyword> so the excluded element types drop out of the view', async () => {
        const json: any = await generate(DSL);

        const infraIds = new Set<string>();
        const ssiIds = new Set<string>();
        const visit = (node: any): void => {
            if (!node || typeof node !== 'object') return;
            if (Array.isArray(node)) { node.forEach(visit); return; }
            if (Array.isArray(node.infrastructureNodes)) {
                for (const n of node.infrastructureNodes) infraIds.add(n.id);
            }
            if (Array.isArray(node.softwareSystemInstances)) {
                for (const n of node.softwareSystemInstances) ssiIds.add(n.id);
            }
            for (const key of Object.keys(node)) visit(node[key]);
        };
        visit(json.model);

        const viewElementIds = new Set<string>((json.views.deploymentViews[0].elements ?? []).map((e: any) => e.id));
        expect(infraIds.size).toBe(1);
        expect(ssiIds.size).toBe(1);
        for (const id of infraIds) expect(viewElementIds.has(id)).toBe(false);
        for (const id of ssiIds) expect(viewElementIds.has(id)).toBe(false);
    });
});
