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
import { isWorkspace } from '../generated/ast';

async function generate(content: string): Promise<any> {
    const services = createC4Services({ connection: undefined as any, ...EmptyFileSystem }).C4;
    const document = services.shared.workspace.LangiumDocumentFactory.fromString(content, URI.parse('file:///packing.dsl'));
    services.shared.workspace.LangiumDocuments.addDocument(document);
    await services.shared.workspace.DocumentBuilder.build([document]);
    const root: any = document.parseResult.value;
    const workspace = isWorkspace(root) ? root : root.workspaces[0];
    return new C4JsonGenerator(services).generate(workspace);
}

/** Distinct element positions and the aspect ratio of their bounding box. */
function geometry(view: any) {
    const xs = new Set<number>();
    const ys = new Set<number>();
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const element of view.elements ?? []) {
        xs.add(element.x);
        ys.add(element.y);
        minX = Math.min(minX, element.x);
        minY = Math.min(minY, element.y);
        maxX = Math.max(maxX, element.x + element.width);
        maxY = Math.max(maxY, element.y + element.height);
    }
    const width = maxX - minX, height = maxY - minY;
    return { columns: xs.size, rows: ys.size, aspect: Math.max(width, height) / Math.min(width, height) };
}

describe('disconnected view packing', () => {
    it('packs many isolated elements into a grid instead of a strip', async () => {
        const elements = Array.from({ length: 60 }, (_, index) => `s${index} = softwareSystem "S${index}"`).join('\n        ');
        const json = await generate(`workspace {
    model {
        ${elements}
    }
    views {
        systemLandscape "L" {
            include *
        }
    }
}`);

        const view = json.views.systemLandscapeViews[0];
        const { columns, rows, aspect } = geometry(view);

        expect(view.elements).toHaveLength(60);
        expect(columns).toBeGreaterThan(2);
        expect(rows).toBeGreaterThan(2);
        expect(aspect).toBeLessThan(3);
    });

    it('leaves a connected view in one layout', async () => {
        const elements = Array.from({ length: 60 }, (_, index) => `s${index} = softwareSystem "S${index}"`).join('\n        ');
        const relationships = Array.from({ length: 59 }, (_, index) => `s${index} -> s${index + 1} "calls"`).join('\n        ');
        const json = await generate(`workspace {
    model {
        ${elements}
        ${relationships}
    }
    views {
        systemLandscape "L" {
            include *
        }
    }
}`);

        const view = json.views.systemLandscapeViews[0];
        const { rows } = geometry(view);

        expect(view.elements).toHaveLength(60);
        expect(rows).toBeGreaterThan(2);
        expect(view.elements.every((element: any) => typeof element.x === 'number')).toBe(true);
    });
});
