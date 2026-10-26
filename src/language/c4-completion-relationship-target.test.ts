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

const DOC = `workspace {
    model {
        a = softwareSystem "A"
        b = softwareSystem "B" {
            c = container "C"
        }
        a -> 
    }
}`;

async function completeAt(text: string, offset: number) {
    const services = createC4Services({ connection: undefined as any, ...EmptyFileSystem }).C4;
    const uri = URI.parse('file:///completion-target.dsl');
    const document = services.shared.workspace.LangiumDocumentFactory.fromString(text, uri);
    services.shared.workspace.LangiumDocuments.addDocument(document);
    await services.shared.workspace.DocumentBuilder.build([document]);

    const result: any = await services.lsp.CompletionProvider!.getCompletion(document, {
        textDocument: { uri: uri.toString() },
        position: document.textDocument.positionAt(offset),
    } as any);
    return (result?.items ?? []) as any[];
}

describe('relationship target completion', () => {
    it('offers the model elements after an arrow', async () => {
        const offset = DOC.indexOf('a -> ') + 'a -> '.length;
        const items = await completeAt(DOC, offset);

        expect(items.map(item => item.label).sort()).toEqual(['a', 'b', 'c']);
    });

    it('shows the element type in the candidate row', async () => {
        const offset = DOC.indexOf('a -> ') + 'a -> '.length;
        const items = await completeAt(DOC, offset);
        const details = Object.fromEntries(items.map(item => [item.label, item.labelDetails?.description]));

        expect(details).toEqual({
            a: 'software system',
            b: 'software system',
            c: 'container',
        });
    });

    it('requests completion after a dot and an arrow', () => {
        const services = createC4Services({ connection: undefined as any, ...EmptyFileSystem }).C4;

        expect(services.lsp.CompletionProvider!.completionOptions?.triggerCharacters).toEqual(['.', '>']);
    });
});
