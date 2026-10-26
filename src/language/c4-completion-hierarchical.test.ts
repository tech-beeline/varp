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
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { EmptyFileSystem } from 'langium';
import { URI } from 'vscode-uri';
import { createC4Services } from './c4-module';

async function completeAt(text: string, offset: number) {
    const root = resolve('test/fixtures/complex-include');
    const services = createC4Services({ connection: undefined as any, ...EmptyFileSystem }).C4;
    const files = readdirSync(root).filter(file => file.endsWith('.dsl'));
    const docs = files.map(file => {
        const uri = URI.file(join(root, file));
        const content = file === 'input.dsl' ? text : readFileSync(uri.fsPath, 'utf8');
        return services.shared.workspace.LangiumDocumentFactory.fromString(content, uri);
    });
    for (const doc of docs) {
        services.shared.workspace.LangiumDocuments.addDocument(doc);
    }
    await services.shared.workspace.DocumentBuilder.build(docs);

    const input = docs.find(doc => doc.uri.path.endsWith('input.dsl'))!;
    const result: any = await services.lsp.CompletionProvider!.getCompletion(input, {
        textDocument: { uri: input.uri.toString() },
        position: input.textDocument.positionAt(offset),
    } as any);
    return (result?.items ?? []) as any[];
}

const WORKSPACE = (body: string) => `workspace extends 1.dsl {
    !identifiers hierarchical
    model {
        !include '3.dsl'
        ${body}
    }
}`;

describe('hierarchical completion', () => {
    it('offers the children of the typed element after a dot', async () => {
        const text = WORKSPACE('s.');
        const items = await completeAt(text, text.indexOf('s.') + 2);

        const labels = items.map(item => item.label).sort();
        expect(labels).toContain('s.c');
        expect(labels).toContain('s.c1');
        // Only direct children: no deeper paths and no unrelated elements.
        expect(labels.every(label => !label.startsWith('s.c.'))).toBe(true);
    });

    it('replaces the typed path with the full child name', async () => {
        const text = WORKSPACE('s.');
        const offset = text.indexOf('s.') + 2;
        const items = await completeAt(text, offset);

        const child = items.find(item => item.label === 's.c1');
        expect(child).toBeDefined();
        expect(child.textEdit).toMatchObject({
            range: {
                start: { line: 4, character: 8 },
                end: { line: 4, character: 10 },
            },
            newText: 's.c1',
        });
    });

    it('keeps the default completion when no dot was typed', async () => {
        const text = WORKSPACE('s');
        const items = await completeAt(text, text.indexOf('s') + 1);

        // The default completion still offers the plain identifiers of the model.
        expect(items.map(item => item.label)).not.toContain('s.c');
    });
});
