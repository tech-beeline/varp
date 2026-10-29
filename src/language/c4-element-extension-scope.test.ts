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

/**
 * `!element Core` shares its name with the real `Core` software system. The
 * directive must not shadow that system when a view scopes itself with
 * `dynamic Core` / `image Core`, otherwise the emitted `elementId` is the
 * directive's dangling `elementextension_*` id.
 */
const DSL = `workspace {
    model {
        core = softwareSystem "Core"
        !element Core {
            gw = container "GW"
            db = container "DB"
        }
    }
    views {
        dynamic Core "0001" {
            Core.gw -> Core.db "query"
        }
        image Core "datamodel" {
            title "model"
        }
    }
}
`;

async function generate(dsl: string) {
    const services = createC4Services({ connection: undefined as any, ...EmptyFileSystem }).C4;
    const doc = services.shared.workspace.LangiumDocumentFactory.fromString(dsl, URI.parse('file:///element-extension-scope.dsl'));
    services.shared.workspace.LangiumDocuments.addDocument(doc);
    await services.shared.workspace.DocumentBuilder.build([doc]);
    const root = doc.parseResult.value;
    const workspace = isWorkspace(root) ? root : (root as any).workspaces?.[0];
    return new C4JsonGenerator(services).generate(workspace);
}

describe('!element directive does not shadow its target', () => {
    it('scopes dynamic and image views to the extended software system', async () => {
        const json: any = await generate(DSL);
        const systemId = json.model.softwareSystems[0].id;

        expect(json.views.dynamicViews[0].elementId).toBe(systemId);
        expect(json.views.dynamicViews[0].name).toBe('Dynamic View: Core');
        expect(json.views.imageViews[0].elementId).toBe(systemId);
    });

    it('still resolves containers contributed by the directive', async () => {
        const json: any = await generate(DSL);
        const containers = json.model.softwareSystems[0].containers ?? [];
        const names = containers.map((c: any) => c.name);
        expect(names).toContain('GW');
        expect(names).toContain('DB');

        const viewElementIds = (json.views.dynamicViews[0].elements ?? []).map((e: any) => e.id);
        expect(viewElementIds.length).toBe(2);
    });
});
