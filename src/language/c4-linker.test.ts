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
import { EmptyFileSystem, type LangiumDocument } from 'langium';
import { URI } from 'vscode-uri';
import { createC4Services } from './c4-module';

async function buildDocument(content: string): Promise<LangiumDocument> {
    const services = createC4Services({ connection: undefined as any, ...EmptyFileSystem }).C4;
    const doc = services.shared.workspace.LangiumDocumentFactory.fromString(content, URI.parse('file:///linker.dsl'));
    services.shared.workspace.LangiumDocuments.addDocument(doc);
    await services.shared.workspace.DocumentBuilder.build([doc], { validation: true });
    return doc;
}

function diagnostics(doc: LangiumDocument): string[] {
    return (doc.diagnostics ?? []).map(d => (typeof d.message === 'string' ? d.message : d.message.value));
}

describe('unresolved references', () => {
    it('names an unknown relationship target as a destination element', async () => {
        const doc = await buildDocument(`workspace {
    model {
        a = softwareSystem "A"
        a -> zz "calls"
    }
}
`);

        expect(diagnostics(doc)).toEqual(['The destination element "zz" does not exist']);
    });

    it('names an unknown relationship source as a source element', async () => {
        const doc = await buildDocument(`workspace {
    model {
        a = softwareSystem "A"
        zz -> a "calls"
    }
}
`);

        expect(diagnostics(doc)).toEqual(['The source element "zz" does not exist']);
    });

    it('reports the identifier of an element that an !element target does not match', async () => {
        const doc = await buildDocument(`workspace {
    model {
        a = softwareSystem "A"
        !element missing {
            tags "x"
        }
    }
}
`);

        expect(diagnostics(doc)).toEqual(['An element identified by "missing" could not be found']);
    });
});
