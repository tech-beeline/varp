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
    const doc = services.shared.workspace.LangiumDocumentFactory.fromString(dsl, URI.parse('file:///workspace-metadata.dsl'));
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

const dsl = `workspace {
    properties {
        "workspace.property" "workspace value"
    }
    model {
        properties {
            "model.property" "model value"
        }
        system = softwareSystem "System"
    }
    views {
        properties {
            "views.property" "views value"
        }
        systemLandscape "landscape" {
            include *
        }
    }
}
`;

describe('workspace root fields', () => {
    it('emits a non-zero id and an empty configuration', async () => {
        const json = await generate(dsl);
        // id 0 is the renderer's playground marker, which prints the current date
        // instead of the workspace timestamp
        expect(json.id).toBe(1);
        expect(json.configuration).toEqual({});
    });

    it('emits workspace properties at the root', async () => {
        const json = await generate(dsl);
        expect(json.properties).toEqual({ 'workspace.property': 'workspace value' });
        // the model and view set properties stay where they were
        expect(json.model.properties).toEqual({ 'model.property': 'model value' });
        expect(json.views.configuration.properties).toEqual({ 'views.property': 'views value' });
    });

    it('omits the root properties when the workspace declares none', async () => {
        const json = await generate(`workspace {
    model {
        system = softwareSystem "System"
    }
    views {
        systemLandscape "landscape" {
            include *
        }
    }
}
`);
        expect(json.properties).toBeUndefined();
    });
});
