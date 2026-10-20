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

async function generate(files: Record<string, string>, entry = 'main.dsl') {
    const services = createC4Services({ connection: undefined as any, ...EmptyFileSystem }).C4;
    const docs = Object.entries(files).map(([file, content]) =>
        services.shared.workspace.LangiumDocumentFactory.fromString(content, URI.parse(`file:///include-chain/${file}`)));
    for (const doc of docs) services.shared.workspace.LangiumDocuments.addDocument(doc);
    await services.shared.workspace.DocumentBuilder.build(docs);
    const main = docs.find(doc => doc.uri.toString().endsWith(entry))!;
    const root: any = main.parseResult.value;
    return new C4JsonGenerator(services).generate(root.workspaces?.[0] ?? root, main.uri.toString());
}

/** Relationship keys as "source name -> destination name" over the whole model. */
function relationshipKeys(json: any): string[] {
    const name = (id: string | undefined) => {
        if (!id) return '?';
        for (const s of json.model.softwareSystems ?? []) {
            if (s.id === id) return s.name;
            for (const c of s.containers ?? []) {
                if (c.id === id) return c.name;
                for (const co of c.components ?? []) if (co.id === id) return co.name;
            }
        }
        return id;
    };
    const keys: string[] = [];
    const visit = (node: any) => {
        for (const rel of node.relationships ?? []) keys.push(`${name(rel.sourceId)} -> ${name(rel.destinationId)}`);
        for (const container of node.containers ?? []) {
            visit(container);
            for (const component of container.components ?? []) visit(component);
        }
    };
    for (const s of json.model.softwareSystems ?? []) visit(s);
    return keys;
}

describe('parent resolution through multi-level include chains', () => {
    it('emits the implied relationship from the system of a container reached through two include levels', async () => {
        const json = await generate({
            'main.dsl': `workspace {
    model {
        s = softwareSystem "S" {
            !include "mid.dsl"
        }
        t = softwareSystem "T" {
        }
    }
}
`,
            'mid.dsl': `!include "deep.dsl"
`,
            'deep.dsl': `container "C" {
    comp = component "Comp" {
    }
}
comp -> t "uses"
`,
        });

        const keys = relationshipKeys(json);
        expect(keys).toContain('Comp -> T');
        expect(keys).toContain('C -> T');
        expect(keys).toContain('S -> T');
    }, 60000);
});
