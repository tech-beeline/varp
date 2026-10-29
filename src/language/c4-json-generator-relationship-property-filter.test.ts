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
    const doc = services.shared.workspace.LangiumDocumentFactory.fromString(dsl, URI.parse('file:///relationship-property-filter.dsl'));
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

/** Every model relationship with its id, in declaration order. */
function modelRelationships(model: any): { id: string; description: string }[] {
    const rels: { id: string; description: string }[] = [];
    for (const system of model.softwareSystems ?? []) {
        for (const rel of system.relationships ?? []) rels.push({ id: rel.id, description: rel.description });
    }
    return rels;
}

const MODEL = `workspace {
    model {
        a = softwareSystem "A"
        b = softwareSystem "B"
        c = softwareSystem "C"
        a -> b "HasProp" {
            properties {
                "propKey" "propValue"
            }
        }
        a -> c "NoProp"
    }
    views {
        systemLandscape "Filtered" {
            include *
%s        }
    }
}
`;

describe('relationship.properties view filter', () => {
    it('keeps every relationship when there is no property filter', async () => {
        const json = await generate(MODEL.replace('%s', ''));
        const view = json.views.systemLandscapeViews[0];
        expect(modelRelationships(json.model)).toHaveLength(2);
        expect(view.relationships).toHaveLength(2);
    });

    it('excludes the relationship carrying the filtered property', async () => {
        const json = await generate(MODEL.replace('%s', 'exclude relationship.properties["propKey"]=="propValue"'));
        const view = json.views.systemLandscapeViews[0];
        const all = modelRelationships(json.model);
        const hasProp = all.find(r => r.description === 'HasProp');
        const noProp = all.find(r => r.description === 'NoProp');
        expect(hasProp).toBeDefined();
        expect(noProp).toBeDefined();

        const viewIds = view.relationships.map((r: any) => r.id);
        // The NoProp relationship stays; the HasProp one is excluded by the filter.
        expect(viewIds).toContain(noProp!.id);
        expect(viewIds).not.toContain(hasProp!.id);
        expect(viewIds).toHaveLength(1);
    });
});
