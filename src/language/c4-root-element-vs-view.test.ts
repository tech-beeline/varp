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

/** Parses the files, builds the workspace and returns the generated JSON plus diagnostics. */
async function generate(files: Record<string, string>, entry: string) {
    const services = createC4Services({ connection: undefined as any, ...EmptyFileSystem }).C4;
    const docs = Object.entries(files).map(([file, content]) =>
        services.shared.workspace.LangiumDocumentFactory.fromString(content, URI.parse(`file:///root-element/${file}`)));
    for (const doc of docs) services.shared.workspace.LangiumDocuments.addDocument(doc);
    await services.shared.workspace.DocumentBuilder.build(docs);
    const main = docs.find(doc => doc.uri.toString().endsWith(entry))!;
    const root: any = main.parseResult.value;
    const json = await new C4JsonGenerator(services).generate(root.workspaces?.[0] ?? root, main.uri.toString());
    const diagnostics = docs.flatMap(doc => (doc.diagnostics ?? []).map((d: any) => d.message));
    return { json, diagnostics, docs };
}

const WORKSPACE = `workspace {
    model {
        s = softwareSystem "S" {
            c = container "C" {
                !include "fragment.dsl"
            }
        }
    }
}
`;

describe('root-level element declarations inside included fragments', () => {
    it('keeps an unnamed component declaration as a component', async () => {
        const { json, diagnostics } = await generate({
            'main.dsl': WORKSPACE,
            'fragment.dsl': `component "Capability" {
    description "d"
    properties {
        "type" "capability"
    }
}
`,
        }, 'main.dsl');

        const components = (json.model.softwareSystems ?? [])
            .flatMap((s: any) => (s.containers ?? []).flatMap((c: any) => (c.components ?? []).map((co: any) => co.name)));
        expect(components).toEqual(['Capability']);
        expect(diagnostics).toEqual([]);
    }, 60000);

    it('keeps an unnamed container declaration as a container', async () => {
        const { json, diagnostics } = await generate({
            'main.dsl': `workspace {
    model {
        s = softwareSystem "S" {
            !include "fragment.dsl"
        }
    }
}
`,
            'fragment.dsl': `container "C" {
    description "d"
}
`,
        }, 'main.dsl');

        const containers = (json.model.softwareSystems ?? []).flatMap((s: any) => (s.containers ?? []).map((c: any) => c.name));
        expect(containers).toEqual(['C']);
        expect(diagnostics).toEqual([]);
    }, 60000);

    it('still parses a bare view declaration in an included fragment as a view', async () => {
        const { json, diagnostics } = await generate({
            'main.dsl': `workspace {
    model {
        s = softwareSystem "S" {
            c = container "C" {
                comp = component "Comp" {
                }
            }
        }
    }
    views {
        !include "views.dsl"
    }
}
`,
            'views.dsl': `container s {
    include *
}
`,
        }, 'main.dsl');

        expect((json.views?.containerViews ?? []).length).toBe(1);
        expect(diagnostics).toEqual([]);
    }, 60000);
});
