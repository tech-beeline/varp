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

import { describe, it, expect, beforeAll } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NodeFileSystem } from 'langium/node';
import { URI } from 'vscode-uri';
import { createC4Services } from './c4-module';

const ROOT = join(tmpdir(), 'c4-path-completion');

beforeAll(() => {
    rmSync(ROOT, { recursive: true, force: true });
    mkdirSync(join(ROOT, 'models'), { recursive: true });
    mkdirSync(join(ROOT, 'docs'), { recursive: true });
    writeFileSync(join(ROOT, 'alpha.dsl'), 'workspace { }');
    writeFileSync(join(ROOT, 'beta.dsl'), 'workspace { }');
    writeFileSync(join(ROOT, 'notes.md'), '# notes');
    writeFileSync(join(ROOT, 'icon.svg'), '<svg />');
    writeFileSync(join(ROOT, 'models', 'inner.dsl'), 'workspace { }');
});

async function completeTemplate(template: string) {
    const services = createC4Services({ connection: undefined as any, ...NodeFileSystem }).C4;
    const uri = URI.file(join(ROOT, 'workspace.dsl'));
    const text = template.replace('<C>', '');
    writeFileSync(uri.fsPath, text);
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

describe('path completion', () => {
    it('offers the dsl files and folders for !include', async () => {
        const items = await completeTemplate(`workspace {
    model {
        !include <C>
    }
}`);

        expect(labels(items)).toEqual(['docs/', 'models/', 'alpha.dsl', 'beta.dsl']);
        expect(items[0].labelDetails?.description).toBe('folder');
        expect(items[2].labelDetails?.description).toBe('file');
    });

    it('filters by the typed fragment inside quotes', async () => {
        const items = await completeTemplate(`workspace {
    model {
        !include 'be<C>'
    }
}`);

        expect(labels(items)).toEqual(['beta.dsl']);
        expect(items[0].textEdit).toMatchObject({ newText: 'beta.dsl' });
    });

    it('lists the entries of a typed folder', async () => {
        const items = await completeTemplate(`workspace {
    model {
        !include models/<C>
    }
}`);

        expect(labels(items)).toEqual(['inner.dsl']);
    });

    it('offers folders for !docs', async () => {
        const items = await completeTemplate(`workspace {
    !docs <C>
}`);

        expect(labels(items)).toEqual(['docs/', 'models/']);
    });

    it('offers images for an icon', async () => {
        const items = await completeTemplate(`workspace {
    model {
        a = softwareSystem "A" {
            icon <C>
        }
    }
}`);

        expect(labels(items)).toEqual(['docs/', 'models/', 'icon.svg']);
    });
});
