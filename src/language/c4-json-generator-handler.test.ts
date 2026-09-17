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

const workspaceDsl = (systemName: string): string => `
workspace {
    model {
        a = softwareSystem "${systemName}"
    }
}
`;

/**
 * Builds a document and resolves once the handler has generated and cached JSON
 * for it, returning the generation reported by onJsonGenerated.
 */
async function buildAndGenerate(services: any, uri: string, content: string): Promise<{ json: any; generation: number }> {
    const handler = services.generation.C4GeneratorHandler;
    const generated = new Promise<{ json: any; generation: number }>((resolve) => {
        handler.onJsonGenerated = (generatedUri: string, json: any, generation: number) => {
            if (generatedUri === uri) {
                resolve({ json, generation });
            }
        };
    });

    const doc = services.shared.workspace.LangiumDocumentFactory.fromString(content, URI.parse(uri));
    services.shared.workspace.LangiumDocuments.addDocument(doc);
    // Explicit options: the build only reaches the Validated phase (and thus
    // triggers generation) when validation is requested.
    await services.shared.workspace.DocumentBuilder.build([doc], { validation: true });
    return generated;
}

const newServices = () => createC4Services({ connection: undefined as any, ...EmptyFileSystem }).C4;

describe('generation contract', () => {
    it('keeps the generation stable across deliveries of the same build', async () => {
        const services = newServices();
        const handler = services.generation.C4GeneratorHandler;
        const uri = 'file:///generation-a.dsl';
        const built = await buildAndGenerate(services, uri, workspaceDsl('A'));

        const first = handler.getContentForUri(uri);
        const second = handler.getContentForUri(uri);

        expect(first).not.toBeNull();
        expect(second?.generation).toBe(first?.generation);
        expect(second?.generation).toBe(built.generation);
        expect(second?.json).toBe(first?.json);
    });

    it('increments the generation for a new build', async () => {
        const services = newServices();
        const handler = services.generation.C4GeneratorHandler;
        const uriA = 'file:///generation-b1.dsl';
        const uriB = 'file:///generation-b2.dsl';

        const builtA = await buildAndGenerate(services, uriA, workspaceDsl('B1'));
        const builtB = await buildAndGenerate(services, uriB, workspaceDsl('B2'));

        expect(builtB.generation).toBeGreaterThan(builtA.generation);
        // Reading the cached build again does not advance the generation.
        const reread = handler.getContentForUri(uriB);
        expect(reread?.generation).toBe(builtB.generation);
        expect(handler.getContentForUri(uriB)?.generation).toBe(reread?.generation);
    });

    it('reports the cached generation through onJsonGenerated', async () => {
        const services = newServices();
        const handler = services.generation.C4GeneratorHandler;
        const uri = 'file:///generation-c.dsl';
        const built = await buildAndGenerate(services, uri, workspaceDsl('C'));

        expect(handler.getContentForUri(uri)?.generation).toBe(built.generation);
    });
});
