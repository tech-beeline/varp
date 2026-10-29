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

const DOCUMENT = `workspace {
    model {
        // Billing core
        billing = softwareSystem "Billing" "Charges customers" {
            tags "critical"
            url "https://billing.example.com"
            properties {
                owner "team-billing"
            }
            api = container "API" "REST API" "Java" {
                tags "db"
            }
        }
        crm = softwareSystem "CRM"
        billing -> crm "sends invoices"
    }
    views {
        systemLandscape "landscape" {
            include *
            description "All systems"
        }
    }
    !const API_URL "https://api.example.com"
}`;

async function hoverAt(text: string, marker: string, delta = 0) {
    const services = createC4Services({ connection: undefined as any, ...EmptyFileSystem }).C4;
    const uri = URI.parse('file:///hover.dsl');
    const document = services.shared.workspace.LangiumDocumentFactory.fromString(text, uri);
    services.shared.workspace.LangiumDocuments.addDocument(document);
    await services.shared.workspace.DocumentBuilder.build([document]);

    const offset = text.indexOf(marker) + delta;
    const hover: any = await services.lsp.HoverProvider!.getHoverContent(document, {
        textDocument: { uri: uri.toString() },
        position: document.textDocument.positionAt(offset),
    } as any);
    return hover?.contents?.value as string | undefined;
}

describe('hover', () => {
    it('describes an element with its type, name and description', async () => {
        const value = await hoverAt(DOCUMENT, '"Billing"', 1);

        expect(value).toContain('**software system** `billing` — Billing');
        expect(value).toContain('Charges customers');
    });

    it('lists the details of the element type', async () => {
        const value = await hoverAt(DOCUMENT, '"API"', 1);

        expect(value).toContain('**container** `api` — API');
        expect(value).toContain('technology: `Java`');
        expect(value).toContain('tags: `db`');
    });

    it('shows tags, url and properties of a software system', async () => {
        const value = await hoverAt(DOCUMENT, '"Billing"', 1);

        expect(value).toContain('tags: `critical`');
        expect(value).toContain('url: https://billing.example.com');
        expect(value).toContain('properties: 1');
    });

    it('resolves a reference to the declaration', async () => {
        const value = await hoverAt(DOCUMENT, 'billing -> crm', 1);

        expect(value).toContain('**software system** `billing` — Billing');
    });

    it('appends the comment written above the element', async () => {
        const value = await hoverAt(DOCUMENT, '"Billing"', 1);

        expect(value).toContain('---');
        expect(value).toContain('> Billing core');
    });

    it('appends a block comment', async () => {
        const text = DOCUMENT.replace('// Billing core', '/*\n         * Billing core\n         * second line\n         */');
        const value = await hoverAt(text, '"Billing"', 1);

        expect(value).toContain('> Billing core');
        expect(value).toContain('> second line');
    });

    it('describes a view by its key', async () => {
        const value = await hoverAt(DOCUMENT, '"landscape"', 1);

        expect(value).toContain('**system landscape view** `landscape`');
        expect(value).toContain('All systems');
    });

    it('describes a relationship', async () => {
        const value = await hoverAt(DOCUMENT, 'sends invoices', 1);

        expect(value).toContain('**relationship**');
        expect(value).toContain('sends invoices');
    });

    it('describes a constant', async () => {
        const value = await hoverAt(DOCUMENT, 'API_URL', 1);

        expect(value).toContain('**constant** `API_URL`');
        expect(value).toContain('https://api.example.com');
    });

    it('shows nothing over whitespace', async () => {
        const value = await hoverAt(DOCUMENT, 'model {\n        ', 1);

        expect(value).toBeUndefined();
    });
});
