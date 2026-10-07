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

async function diagnosticsFor(filter: string): Promise<string[]> {
    const services = createC4Services({ connection: undefined as any, ...EmptyFileSystem }).C4;
    const dsl = `workspace {
    model {
        a = softwareSystem "A"
    }
    views {
        systemLandscape {
            include ${filter}
        }
    }
}
`;
    const doc = services.shared.workspace.LangiumDocumentFactory.fromString(dsl, URI.parse('file:///quoted-filter-validation.dsl'));
    services.shared.workspace.LangiumDocuments.addDocument(doc);
    await services.shared.workspace.DocumentBuilder.build([doc], { validation: true });
    return (doc.diagnostics ?? []).map(d => (typeof d.message === 'string' ? d.message : d.message.value));
}

describe('quoted view filter validation', () => {
    it('reports a filter that does not parse the way the reference implementation does', async () => {
        const diagnostics = await diagnosticsFor('"relationship.tag=alpha"');
        expect(diagnostics).toContain('The element/relationship "relationship.tag=alpha" does not exist');
    });

    it('accepts a valid quoted filter', async () => {
        expect(await diagnosticsFor('"relationship.tag==alpha"')).toEqual([]);
    });
});
