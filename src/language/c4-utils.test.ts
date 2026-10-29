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
import { flatId } from './c4-utils';

const DSL = 'workspace {\nmodel {\na = softwareSystem "A"\n}\n}\n';

function findNode(root: any, type: string): any {
    if (!root || typeof root !== 'object') return undefined;
    if (root.$type === type) return root;
    for (const key of Object.keys(root)) {
        if (key.startsWith('$')) continue;
        const value = root[key];
        if (Array.isArray(value)) {
            for (const item of value) {
                const found = findNode(item, type);
                if (found) return found;
            }
        } else if (value && typeof value === 'object') {
            const found = findNode(value, type);
            if (found) return found;
        }
    }
    return undefined;
}

async function systemNode(services: any, uri: string): Promise<any> {
    const doc = services.shared.workspace.LangiumDocumentFactory.fromString(DSL, URI.parse(uri));
    services.shared.workspace.LangiumDocuments.addDocument(doc);
    await services.shared.workspace.DocumentBuilder.build([doc], { validation: true });
    expect(doc.parseResult.parserErrors ?? []).toHaveLength(0);
    return findNode(doc.parseResult.value, 'SoftwareSystem');
}

describe('flatId', () => {
    it('gives elements from same-named documents distinct ids', async () => {
        const services = createC4Services({ connection: undefined as any, ...EmptyFileSystem }).C4;
        const root = 'file:///root/workspace.dsl';
        const a = await systemNode(services, 'file:///a/landscape.dsl');
        const b = await systemNode(services, 'file:///b/landscape.dsl');
        expect(a).toBeDefined();
        expect(flatId(a, root)).not.toBe(flatId(b, root));
    });

    it('keeps the id stable for the same element', async () => {
        const services = createC4Services({ connection: undefined as any, ...EmptyFileSystem }).C4;
        const root = 'file:///root/workspace.dsl';
        const a = await systemNode(services, 'file:///a/landscape.dsl');
        expect(a).toBeDefined();
        expect(flatId(a, root)).toBe(flatId(a, root));
    });
});
