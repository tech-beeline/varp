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
    const uri = URI.parse('file:///completion-keywords.dsl');
    const document = services.shared.workspace.LangiumDocumentFactory.fromString(text, uri);
    services.shared.workspace.LangiumDocuments.addDocument(document);
    await services.shared.workspace.DocumentBuilder.build([document]);

    const result: any = await services.lsp.CompletionProvider!.getCompletion(document, {
        textDocument: { uri: uri.toString() },
        position: document.textDocument.positionAt(offset),
    } as any);
    return (result?.items ?? []) as any[];
}

/** Completes at the `<C>` marker of the template. */
async function completeTemplate(template: string) {
    const offset = template.indexOf('<C>');
    return completeAt(template.replace('<C>', ''), offset);
}

const MODEL = `    model {
        a = softwareSystem "A" {
            tags "critical"
        }
        b = softwareSystem "B"
        a -> b "calls"
    }`;

function labels(items: any[]): string[] {
    return items.map(item => item.label);
}

describe('keyword completion', () => {
    it('offers the view types at the start of a line inside views', async () => {
        const items = await completeTemplate(`workspace {
${MODEL}
    views {
        <C>
    }
}`);
        const labels = items.map(item => item.label);

        expect(labels).toContain('systemLandscape');
        expect(labels).toContain('container');
        expect(labels).toContain('filtered');
        expect(labels).toContain('!include');
        expect(labels).not.toContain('include');
    });

    it('filters keywords by the typed prefix and replaces it', async () => {
        const template = `workspace {
${MODEL}
    views {
        sys<C>
    }
}`;
        const offset = template.indexOf('<C>');
        const text = template.replace('<C>', '');
        const items = await completeAt(text, offset);

        expect(labels(items).sort()).toEqual(['systemContext', 'systemLandscape']);
        expect(items[0].textEdit).toMatchObject({
            range: {
                start: { line: 9, character: 8 },
                end: { line: 9, character: 11 },
            },
            newText: 'systemLandscape',
        });
    });

    it('offers the style properties inside an element style', async () => {
        const labels = (await completeTemplate(`workspace {
${MODEL}
    styles {
        element "critical" {
            <C>
        }
    }
}`)).map(item => item.label);

        expect(labels).toContain('shape');
        expect(labels).toContain('strokeWidth');
        expect(labels).toContain('iconPosition');
    });

    it('offers the view body keywords inside a view', async () => {
        const labels = (await completeTemplate(`workspace {
${MODEL}
    views {
        systemLandscape "L" {
            <C>
        }
    }
}`)).map(item => item.label);

        expect(labels).toEqual(['include', 'exclude', 'autoLayout', 'animation', 'title', 'default', 'description', 'properties', '!script', '!include']);
    });

    it('offers element kinds inside the model', async () => {
        const labels = (await completeTemplate(`workspace {
    model {
        <C>
    }
}`)).map(item => item.label);

        expect(labels).toContain('person');
        expect(labels).toContain('softwareSystem');
        expect(labels).toContain('!elements');
        expect(labels).toContain('group');
    });

    it('offers view types again after a closed view', async () => {
        const labels = (await completeTemplate(`workspace {
${MODEL}
    views {
        systemLandscape "L" {
            include *
        }
        <C>
    }
}`)).map(item => item.label);

        expect(labels).toContain('systemLandscape');
        expect(labels).not.toContain('include');
    });

    it('uses the canonical spelling of the keywords', async () => {
        const modelLabels = (await completeTemplate(`workspace {
    model {
        <C>
    }
}`)).map(item => item.label);
        const viewLabels = (await completeTemplate(`workspace {
${MODEL}
    views {
        systemLandscape "L" {
            <C>
        }
    }
}`)).map(item => item.label);

        expect(modelLabels).toContain('softwareSystem');
        expect(modelLabels).not.toContain('softwaresystem');
        expect(viewLabels).toContain('autoLayout');
        expect(viewLabels).not.toContain('autolayout');
    });
});
