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
async function generate(content: string): Promise<any> {
    const services = createC4Services({ connection: undefined as any, ...EmptyFileSystem }).C4;
    const doc = services.shared.workspace.LangiumDocumentFactory.fromString(
        content,
        URI.parse('file:///style-booleans.dsl')
    );
    services.shared.workspace.LangiumDocuments.addDocument(doc);
    await services.shared.workspace.DocumentBuilder.build([doc]);
    expect(doc.parseResult.parserErrors).toHaveLength(0);
    const root: any = doc.parseResult.value;
    const workspace = isWorkspace(root) ? root : root.workspaces[0];
    return new C4JsonGenerator(services).generate(workspace);
}

describe('boolean style properties', () => {
    it('emits true/false as JSON booleans', async () => {
        const json = await generate(`
workspace {
    model {
        a = softwareSystem "A"
        b = softwareSystem "B"
        a -> b "Uses"
    }
    views {
        styles {
            element "Database" {
                metadata false
                description false
            }
            relationship "Uses" {
                dashed true
                jump false
                metadata true
                description true
            }
        }
    }
}
`);

        const styles = json.views.configuration.styles;
        expect(styles.elements[0]).toMatchObject({ metadata: false, description: false });
        expect(styles.relationships[0]).toMatchObject({
            dashed: true, jump: false, metadata: true, description: true
        });
    });
});
