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
        a = softwareSystem "A" {
            tags "critical"
            c = container "C" "cache" "Java" {
                tags "db"
            }
        }
        b = softwareSystem "B"
        a -> b "calls" {
            tags "sync"
        }
    }`;

const WORKSPACE = (extra: string) => `workspace {
${MODEL}
${extra}
}`;

async function completeTemplate(template: string) {
    const services = createC4Services({ connection: undefined as any, ...EmptyFileSystem }).C4;
    const uri = URI.parse('file:///completion-declarations.dsl');
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

describe('declaration completion', () => {
    it('offers element tags in a tags declaration', async () => {
        const items = await completeTemplate(WORKSPACE(`    model {
        d = softwareSystem "D" {
            tags "<C>"
        }
    }`));

        expect(labels(items)).toEqual(['critical', 'db']);
        expect(items[0].labelDetails?.description).toBe('tag');
    });

    it('offers relationship tags inside a relationship', async () => {
        const items = await completeTemplate(WORKSPACE(`    model {
        b -> a "back" {
            tags "<C>"
        }
    }`));

        expect(labels(items)).toEqual(['sync']);
    });

    it('replaces the last tag of a list', async () => {
        const items = await completeTemplate(WORKSPACE(`    model {
        d = softwareSystem "D" {
            tags "critical", "d<C>"
        }
    }`));
        expect(labels(items)).toEqual(['db']);
        expect(items[0].textEdit).toMatchObject({ newText: 'db' });
    });

    it('offers technologies in a technology declaration', async () => {
        const items = await completeTemplate(WORKSPACE(`    model {
        d = container "D" "desc" {
            technology "<C>"
        }
    }`));

        expect(labels(items)).toEqual(['Java']);
        expect(items[0].labelDetails?.description).toBe('technology');
    });

    it('offers tags in style selectors', async () => {
        const items = await completeTemplate(WORKSPACE(`    styles {
        element "<C>" {
            shape Box
        }
    }`));

        expect(labels(items)).toEqual(['critical', 'db']);
    });

    it('offers tags in a filtered view', async () => {
        const items = await completeTemplate(WORKSPACE(`    views {
        systemLandscape "L" {
            include *
        }
        filtered L include "<C>"
    }`));

        expect(labels(items)).toEqual(['critical', 'db']);
    });

    it('offers shapes in an element style', async () => {
        const items = await completeTemplate(WORKSPACE(`    styles {
        element "critical" {
            shape <C>
        }
    }`));

        expect(labels(items)).toContain('Box');
        expect(labels(items)).toContain('Cylinder');
        expect(labels(items)).toContain('MobileDevicePortrait');
    });

    it('offers border and routing values', async () => {
        const border = await completeTemplate(WORKSPACE(`    styles {
        element "critical" {
            border <C>
        }
    }`));
        const routing = await completeTemplate(WORKSPACE(`    styles {
        relationship "sync" {
            routing <C>
        }
    }`));

        expect(labels(border)).toEqual(['Solid', 'Dashed', 'Dotted']);
        expect(labels(routing)).toEqual(['Direct', 'Orthogonal', 'Curved']);
    });

    it('offers the autoLayout directions', async () => {
        const items = await completeTemplate(WORKSPACE(`    views {
        systemLandscape "L" {
            include *
            autoLayout <C>
        }
    }`));

        expect(labels(items)).toEqual(['tb', 'bt', 'lr', 'rl']);
    });

    it('offers the declared constants inside a substitution', async () => {
        const items = await completeTemplate(`workspace {
    !const API_URL "https://api.example.com"
    model {
        a = softwareSystem "A" {
            description "\${AP<C>}"
        }
    }
}`);

        expect(labels(items)).toEqual(['API_URL']);
        expect(items[0].labelDetails?.description).toBe('constant');
        expect(items[0].textEdit).toMatchObject({ newText: 'API_URL' });
    });

    it('offers known and used property keys inside a properties block', async () => {
        const items = await completeTemplate(`workspace {
    model {
        a = softwareSystem "A" {
            properties {
                owner "team-a"
            }
        }
        b = softwareSystem "B" {
            properties {
                "<C>"
            }
        }
    }
}`);

        expect(labels(items)).toContain('structurizr.groupSeparator');
        expect(labels(items)).toContain('plantuml.url');
        expect(labels(items)).toContain('owner');
    });

    it('offers the view keys for a filtered view', async () => {
        const items = await completeTemplate(WORKSPACE(`    views {
        systemLandscape "L" {
            include *
        }
        filtered <C>
    }`));

        expect(labels(items)).toEqual(['L']);
        expect(items[0].labelDetails?.description).toBe('view');
    });
});
