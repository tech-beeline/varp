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
    const doc = services.shared.workspace.LangiumDocumentFactory.fromString(dsl, URI.parse('file:///technology.dsl'));
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
        system = softwareSystem "System" {
            positional = container "Positional" "Description" "Java"
            declared = container "Declared" "Description" {
                technology "Kotlin"
            }
            overriding = container "Overriding" "Description" "Java" {
                technology "Kotlin"
            }
            quoted = container "Quoted" "Description" {
                technology "Java, Spring"
            }
        }
        deploymentEnvironment "Production" {
            node = deploymentNode "Node" "Description" "Linux" {
                technology "Windows"
            }
        }
    }
    views {
        container system "Containers" {
            include *
        }
    }
}
`;

describe('element technology', () => {
    it('reads the positional technology', async () => {
        const json = await generate(dsl);
        const containers = json.model.softwareSystems[0].containers;
        expect(containers.find((c: any) => c.name === 'Positional').technology).toBe('Java');
    });

    it('reads an in-block technology declaration', async () => {
        const json = await generate(dsl);
        const containers = json.model.softwareSystems[0].containers;
        expect(containers.find((c: any) => c.name === 'Declared').technology).toBe('Kotlin');
    });

    it('lets an in-block technology override the positional one', async () => {
        const json = await generate(dsl);
        const containers = json.model.softwareSystems[0].containers;
        expect(containers.find((c: any) => c.name === 'Overriding').technology).toBe('Kotlin');
    });

    it('keeps commas inside a quoted technology', async () => {
        const json = await generate(dsl);
        const containers = json.model.softwareSystems[0].containers;
        expect(containers.find((c: any) => c.name === 'Quoted').technology).toBe('Java, Spring');
    });

    it('reads an in-block technology on a deployment node', async () => {
        const json = await generate(dsl);
        expect(json.model.deploymentNodes[0].technology).toBe('Windows');
    });
});
