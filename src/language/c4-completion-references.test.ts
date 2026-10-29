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

const MODEL = `    model {
        prod = deploymentEnvironment "Prod"
        a = softwareSystem "A" {
            c = container "C"
        }
        b = softwareSystem "B"
    }`;

async function completeTemplate(template: string) {
    const services = createC4Services({ connection: undefined as any, ...EmptyFileSystem }).C4;
    const uri = URI.parse('file:///completion-references.dsl');
    const text = template.replace('<C>', '');
    const document = services.shared.workspace.LangiumDocumentFactory.fromString(text, uri);
    services.shared.workspace.LangiumDocuments.addDocument(document);
    await services.shared.workspace.DocumentBuilder.build([document]);

    const result: any = await services.lsp.CompletionProvider!.getCompletion(document, {
        textDocument: { uri: uri.toString() },
        position: document.textDocument.positionAt(template.indexOf('<C>')),
    } as any);
    return (result?.items ?? []) as any[];
}

function labels(items: any[]): string[] {
    return items.map(item => item.label);
}

describe('reference completion', () => {
    it('offers only software systems as the deployment scope', async () => {
        const items = await completeTemplate(`workspace {
${MODEL}
    views {
        deployment <C> {
            include *
        }
    }
}`);

        expect(labels(items).sort()).toEqual(['a', 'b']);
    });

    it('offers only deployment environments after the scope', async () => {
        const items = await completeTemplate(`workspace {
${MODEL}
    views {
        deployment a <C> {
            include *
        }
    }
}`);

        expect(labels(items)).toContain('prod');
        expect(labels(items)).not.toContain('a');
        expect(labels(items)).not.toContain('c');
        expect(items[0].labelDetails?.description).toBe('deployment environment');
    });

    it('offers every element for a union-typed reference', async () => {
        const items = await completeTemplate(`workspace {
${MODEL}
    views {
        systemLandscape "L" {
            include <C>
        }
    }
}`);

        expect(labels(items)).toEqual(expect.arrayContaining(['a', 'b', 'c', 'prod']));
    });
});
