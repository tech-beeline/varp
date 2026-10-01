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
    const doc = services.shared.workspace.LangiumDocumentFactory.fromString(dsl, URI.parse('file:///custom-elements.dsl'));
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

function customElement(json: any, name: string): any {
    return (json.model.customElements ?? []).find((element: any) => element.name === name);
}

describe('custom element header', () => {
    it('maps metadata, description and tags positionally', async () => {
        const json = await generate(`workspace {
    model {
        box = element "Box" "Metadata" "Description" "Tag"
    }
}
`);

        const box = customElement(json, 'Box');
        expect(box.metadata).toBe('Metadata');
        expect(box.description).toBe('Description');
        expect(box.tags).toContain('Tag');
    });

    it('maps a single trailing token as the metadata', async () => {
        const json = await generate(`workspace {
    model {
        box = element "Box" "Metadata"
    }
}
`);

        const box = customElement(json, 'Box');
        expect(box.metadata).toBe('Metadata');
        expect(box.description).toBeUndefined();
    });

    it('omits metadata and description without a header', async () => {
        const json = await generate(`workspace {
    model {
        box = element "Box"
    }
}
`);

        const box = customElement(json, 'Box');
        expect(box.metadata).toBeUndefined();
        expect(box.description).toBeUndefined();
    });

    it('emits the group path of a grouped custom element', async () => {
        const json = await generate(`workspace {
    model {
        group "Group A" {
            box = element "Box"
        }
    }
}
`);

        expect(customElement(json, 'Box').group).toBe('Group A');
    });
});
