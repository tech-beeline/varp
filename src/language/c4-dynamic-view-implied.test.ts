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

/** Generates the workspace and returns its dynamic views. */
async function dynamicViews(dsl: string) {
    const services = createC4Services({ connection: undefined as any, ...EmptyFileSystem }).C4;
    const uri = URI.parse('file:///dynamic-view/workspace.dsl');
    const document = services.shared.workspace.LangiumDocumentFactory.fromString(dsl, uri);
    services.shared.workspace.LangiumDocuments.addDocument(document);
    await services.shared.workspace.DocumentBuilder.build([document]);
    const json: any = await new C4JsonGenerator(services).generate((document.parseResult.value as any).workspaces[0], uri.toString());
    return { views: json.views?.dynamicViews ?? [], diagnostics: (document.diagnostics ?? []).map((d: any) => d.message) };
}

const WORKSPACE = (steps: string) => `workspace {
    !identifiers hierarchical
    model {
        s = softwareSystem "S" {
            a = container "A" {
                a1 = component "A1" {
                }
            }
            b = container "B" {
                b1 = component "B1" {
                }
            }
            s.a.a1 -> s.b.b1 "calls"
        }
    }
    views {
        dynamic s "V" "Test" {
${steps}
        }
    }
}
`;

describe('dynamic view steps over implied relationships', () => {
    it('keeps a step between elements related only through their children', async () => {
        const { views, diagnostics } = await dynamicViews(WORKSPACE(`            s.a -> s.b "step through containers"`));

        expect(diagnostics).toEqual([]);
        expect(views).toHaveLength(1);
        // The container pair has no declared relationship: it exists only as the implied
        // relationship derived from the component pair, and the step must still resolve.
        expect(views[0].relationships).toHaveLength(1);
        expect(views[0].relationships[0]).toMatchObject({ order: '1', description: 'step through containers' });
    }, 60000);

    it('keeps a step that walks the implied relationship in the reverse direction', async () => {
        const { views } = await dynamicViews(WORKSPACE(`            s.b -> s.a "response through containers"`));

        expect(views[0].relationships).toHaveLength(1);
        expect(views[0].relationships[0]).toMatchObject({ order: '1', description: 'response through containers', response: true });
    }, 60000);

    it('keeps every step of a sequence, not only the declared ones', async () => {
        const { views } = await dynamicViews(WORKSPACE(`            s.a -> s.b "first"
            s.a.a1 -> s.b.b1 "second"
            s.b -> s.a "third"`));

        expect(views[0].relationships.map((rel: any) => rel.order)).toEqual(['1', '2', '3']);
        expect(views[0].relationships.map((rel: any) => rel.description))
            .toEqual(['first', 'second', 'third']);
    }, 60000);
});

const PARALLEL_WORKSPACE = `workspace {
    !identifiers hierarchical
    model {
        s = softwareSystem "S" {
            a = container "A" {
            }
            b = container "B" {
            }
            c = container "C" {
            }
            s.a -> s.b "ab"
            s.a -> s.c "ac"
            s.b -> s.c "bc"
        }
    }
    views {
        dynamic s "V" "Test" {
            {
                s.a -> s.b "left"
                s.a -> s.c "right"
            }
            s.b -> s.c "after"
        }
    }
}
`;

describe('dynamic view parallel step blocks', () => {
    it('gives every step of a block the same order and continues after it', async () => {
        const { views, diagnostics } = await dynamicViews(PARALLEL_WORKSPACE);

        expect(diagnostics).toEqual([]);
        expect(views[0].relationships.map((rel: any) => rel.order)).toEqual(['1', '1', '2']);
        expect(views[0].relationships.map((rel: any) => rel.description)).toEqual(['left', 'right', 'after']);
    }, 60000);
});

const REFERENCE_WORKSPACE = `workspace {
    !identifiers hierarchical
    model {
        s = softwareSystem "S" {
            a = container "A" {
            }
            b = container "B" {
            }
            link = s.a -> s.b "calls"
        }
    }
    views {
        dynamic s "V" "Test" {
            link
            s.b -> s.a "back"
        }
    }
}
`;

describe('dynamic view steps referencing a relationship by identifier', () => {
    it('resolves the step through the named relationship and keeps the following step', async () => {
        const { views, diagnostics } = await dynamicViews(REFERENCE_WORKSPACE);

        expect(diagnostics).toEqual([]);
        expect(views[0].relationships).toHaveLength(2);
        expect(views[0].relationships[0]).toMatchObject({ order: '1', description: 'calls' });
        expect(views[0].relationships[0].id).toBeTruthy();
        expect(views[0].relationships[1]).toMatchObject({ order: '2', description: 'back' });
    }, 60000);
});
