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
import { C4JsonGenerator } from './c4-json-generator';
import { DEFAULT_THEME_JSON, DEFAULT_THEME_URL } from './c4-default-theme';
import { isWorkspace } from '../generated/ast';

async function generate(dsl: string): Promise<any> {
    const services = createC4Services({ connection: undefined as any, ...EmptyFileSystem }).C4;
    const doc = services.shared.workspace.LangiumDocumentFactory.fromString(dsl, URI.parse('file:///themes.dsl'));
    services.shared.workspace.LangiumDocuments.addDocument(doc);
    await services.shared.workspace.DocumentBuilder.build([doc]);
    const root = doc.parseResult.value;
    if (isWorkspace(root)) {
        return new C4JsonGenerator(services).generate(root);
    }
    const anyRoot = root as any;
    if (anyRoot.$type === 'C4Document' && anyRoot.workspaces?.length > 0) {
        return new C4JsonGenerator(services).generate(anyRoot.workspaces[0]);
    }
    throw new Error('No workspace found');
}

function workspaceWithViews(views: string): string {
    return `workspace {
    model {
        a = softwareSystem "A"
    }
    views {
${views}
    }
}
`;
}

describe('themes', () => {
    it('resolves the default theme name to its canonical URL', async () => {
        const json = await generate(workspaceWithViews('        theme default'));
        expect(json.views.configuration.themes).toEqual([DEFAULT_THEME_URL]);
    });

    it.each(['default', 'Default', 'DEFAULT'])('resolves %s to the canonical URL', async (name) => {
        const json = await generate(workspaceWithViews(`        theme ${name}`));
        expect(json.views.configuration.themes).toEqual([DEFAULT_THEME_URL]);
    });

    it('keeps explicit theme URLs unchanged', async () => {
        const json = await generate(workspaceWithViews('        theme https://example.com/theme.json'));
        expect(json.views.configuration.themes).toEqual(['https://example.com/theme.json']);
    });

    it('resolves the default name inside a themes list and keeps the declaration order', async () => {
        const json = await generate(workspaceWithViews('        themes https://example.com/one.json default'));
        expect(json.views.configuration.themes).toEqual(['https://example.com/one.json', DEFAULT_THEME_URL]);
    });

    it('bundles element styles for the default theme', () => {
        const theme = JSON.parse(DEFAULT_THEME_JSON);
        expect(Array.isArray(theme.elements)).toBe(true);
        expect(theme.elements.length).toBeGreaterThan(0);
        expect(theme.elements).toContainEqual({ tag: 'Person', background: '#08427b', color: '#ffffff', shape: 'Person' });
    });
});
