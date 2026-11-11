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
import { C4JsonEnricher } from './c4-json-enricher';
import { isWorkspace } from '../generated/ast';

/** Generates and enriches the workspace JSON, as the full-content pipeline does. */
async function generateFull(content: string): Promise<any> {
    const services = createC4Services({ connection: undefined as any, ...EmptyFileSystem }).C4;
    const uri = 'file:///element-extension-perspectives.dsl';
    const doc = services.shared.workspace.LangiumDocumentFactory.fromString(content, URI.parse(uri));
    services.shared.workspace.LangiumDocuments.addDocument(doc);
    await services.shared.workspace.DocumentBuilder.build([doc]);
    const root: any = doc.parseResult.value;
    const workspace = isWorkspace(root) ? root : root.workspaces?.[0];
    const json = await new C4JsonGenerator(services).generate(workspace, uri);
    await new C4JsonEnricher((services as any).shared).enrich(uri, json);
    return json;
}

describe('perspectives in an element extension', () => {
    it('merges the extension perspectives with the ones of the extended element', async () => {
        const json = await generateFull(`
workspace {
    model {
        system = softwareSystem "System" {
            perspectives {
                perspective "Zulu" {
                    description "Declared in the element"
                    value "Own"
                }
            }
        }
        !element system {
            perspectives {
                perspective "Beta" {
                    description "Added by the extension"
                    value "Overlay"
                }
            }
        }
    }
}
`);

        expect(json.model.softwareSystems[0].perspectives).toEqual([
            { description: 'Added by the extension', name: 'Beta', value: 'Overlay' },
            { description: 'Declared in the element', name: 'Zulu', value: 'Own' }
        ]);
    });

    it('keeps the extension tags and perspectives of an element without its own', async () => {
        const json = await generateFull(`
workspace {
    model {
        system = softwareSystem "System"
        !element system {
            tags "Extended"
            perspectives {
                "Security" "Handled by the gateway"
            }
        }
    }
}
`);

        expect(json.model.softwareSystems[0].tags).toBe('Element,Software System,Extended');
        expect(json.model.softwareSystems[0].perspectives).toEqual([
            { name: 'Security', description: 'Handled by the gateway' }
        ]);
    });
});
