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
    const doc = services.shared.workspace.LangiumDocumentFactory.fromString(dsl, URI.parse('file:///terminology.dsl'));
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
    model {
        user = person "User"
    }
    views {
        terminology {
            person "Person"
            softwareSystem "Software System"
            container "Container"
            component "Component"
            deploymentNode "Deployment Node"
            infrastructureNode "Infrastructure Node"
            relationship "Relationship"
            metadata angle
        }
    }
}
`;

describe('terminology', () => {
    it('emits terminology values without surrounding quotes', async () => {
        const json = await generate(dsl);
        expect(json.views.configuration.terminology).toEqual({
            person: 'Person',
            softwareSystem: 'Software System',
            container: 'Container',
            component: 'Component',
            deploymentNode: 'Deployment Node',
            infrastructureNode: 'Infrastructure Node',
            relationship: 'Relationship'
        });
    });

    it('maps the metadata directive to configuration.metadataSymbols', async () => {
        const json = await generate(dsl);
        expect(json.views.configuration.metadataSymbols).toBe('AngleBrackets');
        expect(json.views.configuration.terminology.metadata).toBeUndefined();
    });

    it('defaults metadataSymbols to SquareBrackets and terminology to an empty object', async () => {
        const json = await generate('workspace {\n    model {\n        user = person "User"\n    }\n}\n');
        expect(json.views.configuration.metadataSymbols).toBe('SquareBrackets');
        expect(json.views.configuration.terminology).toEqual({});
    });

    it.each([
        ['square', 'SquareBrackets'],
        ['round', 'RoundBrackets'],
        ['curly', 'CurlyBrackets'],
        ['angle', 'AngleBrackets'],
        ['double-angle', 'DoubleAngleBrackets'],
        ['none', 'None']
    ])('maps metadata %s to %s', async (keyword, expected) => {
        const json = await generate(`workspace {
    views {
        terminology {
            metadata ${keyword}
        }
    }
}
`);
        expect(json.views.configuration.metadataSymbols).toBe(expected);
    });
});
