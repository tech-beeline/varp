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

async function completeAt(text: string, offset: number) {
    const services = createC4Services({ connection: undefined as any, ...EmptyFileSystem }).C4;
    const uri = URI.parse('file:///completion-expression.dsl');
    const document = services.shared.workspace.LangiumDocumentFactory.fromString(text, uri);
    services.shared.workspace.LangiumDocuments.addDocument(document);
    await services.shared.workspace.DocumentBuilder.build([document]);

    const result: any = await services.lsp.CompletionProvider!.getCompletion(document, {
        textDocument: { uri: uri.toString() },
        position: document.textDocument.positionAt(offset),
    } as any);
    return (result?.items ?? []) as any[];
}

const VIEW = (body: string) => `workspace {
    model {
        a = softwareSystem "A"
        b = softwareSystem "B"
        a -> b "calls"
    }
    views {
        systemLandscape "L" {
            ${body}
        }
    }
}`;

describe('expression completion', () => {
    it('offers element properties after a logical operator', async () => {
        const text = VIEW('include element.tag==A && element.');
        const items = await completeAt(text, text.indexOf('&& element.') + '&& element.'.length);

        expect(items.map(item => item.label).sort()).toEqual([
            'element.group',
            'element.parent',
            'element.properties',
            'element.tag',
            'element.technology',
            'element.type',
        ]);
    });

    it('offers element properties after element.', async () => {
        const text = VIEW('include element.');
        const items = await completeAt(text, text.indexOf('element.') + 'element.'.length);

        expect(items.map(item => item.label).sort()).toEqual([
            'element.group',
            'element.parent',
            'element.properties',
            'element.tag',
            'element.technology',
            'element.type',
        ]);
    });

    it('offers relationship properties after relationship.', async () => {
        const text = VIEW('exclude relationship.');
        const items = await completeAt(text, text.indexOf('relationship.') + 'relationship.'.length);

        expect(items.map(item => item.label).sort()).toEqual([
            'relationship.destination',
            'relationship.properties',
            'relationship.source',
            'relationship.tag',
        ]);
    });

    it('filters the properties by the typed prefix', async () => {
        const text = VIEW('include Element.tec');
        const items = await completeAt(text, text.indexOf('Element.tec') + 'Element.tec'.length);

        expect(items.map(item => item.label)).toEqual(['element.technology']);
        expect(items[0].textEdit).toMatchObject({ newText: 'element.technology' });
    });

    it('replaces the typed subject with the full property', async () => {
        const text = VIEW('include element.');
        const offset = text.indexOf('element.') + 'element.'.length;
        const items = await completeAt(text, offset);

        const item = items.find(candidate => candidate.label === 'element.tag');
        expect(item).toBeDefined();
        expect(item.textEdit).toMatchObject({
            range: {
                start: { line: 8, character: 20 },
                end: { line: 8, character: 28 },
            },
            newText: 'element.tag',
        });
    });

    it('offers properties inside an !elements expression string', async () => {
        const text = `workspace {
    model {
        a = softwareSystem "A"
        !elements "element.
    }
}`;
        const items = await completeAt(text, text.indexOf('element.') + 'element.'.length);

        expect(items.map(item => item.label)).toContain('element.parent');
    });

    it('does not offer expression properties outside an expression', async () => {
        const text = `workspace {
    model {
        a = softwareSystem "A" {
            description "about element.
        }
    }
}`;
        const items = await completeAt(text, text.indexOf('element.') + 'element.'.length);

        expect(items.map(item => item.label)).not.toContain('element.tag');
    });

    it('offers properties in a view body included from another file', async () => {
        const services = createC4Services({ connection: undefined as any, ...EmptyFileSystem }).C4;
        const docs = [
            `workspace {
    model {
        s = softwareSystem "S"
    }
    views {
        container s "c" {
            !include 'fragment.dsl'
        }
    }
}`,
            'include *\nexclude element.',
        ].map((content, index) => {
            const uri = URI.parse(`file:///completion-view-fragment-${index}.dsl`);
            return services.shared.workspace.LangiumDocumentFactory.fromString(content, uri);
        });
        for (const doc of docs) services.shared.workspace.LangiumDocuments.addDocument(doc);
        await services.shared.workspace.DocumentBuilder.build(docs);

        const fragment = docs[1];
        const text = fragment.textDocument.getText();
        const result: any = await services.lsp.CompletionProvider!.getCompletion(fragment, {
            textDocument: { uri: fragment.uri.toString() },
            position: fragment.textDocument.positionAt(text.length),
        } as any);
        const labels = ((result?.items ?? []) as any[]).map(item => item.label);

        expect(labels).toContain('element.tag');
    });
});
