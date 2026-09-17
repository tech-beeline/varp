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
import { AstUtils, EmptyFileSystem, type LangiumDocument } from 'langium';
import { URI, Utils } from 'vscode-uri';
import { createC4Services } from './c4-module';
import { isRelationship } from '../generated/ast';

const PROJECT = URI.parse('file:///identifiers-regions/');

/** Builds a fresh service container with the given virtual .dsl files. */
async function buildProject(files: Record<string, string>): Promise<Map<string, LangiumDocument>> {
    const services = createC4Services({ connection: undefined as any, ...EmptyFileSystem }).C4;
    const docs = new Map<string, LangiumDocument>();
    for (const [name, content] of Object.entries(files)) {
        const uri = Utils.resolvePath(PROJECT, name);
        const doc = services.shared.workspace.LangiumDocumentFactory.fromString(content, uri);
        services.shared.workspace.LangiumDocuments.addDocument(doc);
        docs.set(name, doc);
    }
    await services.shared.workspace.DocumentBuilder.build([...docs.values()]);
    return docs;
}

/** Resolves a relationship endpoint reference by its source text. */
function resolveEndpoint(doc: LangiumDocument, refText: string): any {
    const relationships = AstUtils.streamAllContents(doc.parseResult.value).filter(isRelationship).toArray();
    for (const relationship of relationships) {
        for (const endpoint of [(relationship as any).source, (relationship as any).target]) {
            if (endpoint?.$refText === refText) {
                return endpoint.ref;
            }
        }
    }
    throw new Error(`reference '${refText}' not found`);
}

const FRAGMENT = `!identifiers hierarchical
sys = softwareSystem "Sys" {
    comp = container "Comp"
}
!identifiers flat
other = softwareSystem "Other" {
    inner = container "Inner"
}
`;

const MAIN = `workspace {
    model {
        !include "frag.dsl"
        sys.comp -> other "uses"
        inner -> sys.comp "flat"
    }
}
`;

describe('!identifiers regions in included fragments', () => {
    it('applies the style of each element region, not the last directive', async () => {
        const docs = await buildProject({ 'main.dsl': MAIN, 'frag.dsl': FRAGMENT });
        const main = docs.get('main.dsl')!;
        const fragment = docs.get('frag.dsl')!;

        expect(main.parseResult.parserErrors).toHaveLength(0);
        expect(fragment.parseResult.parserErrors).toHaveLength(0);

        // First region is hierarchical, so the FQN resolves.
        expect(resolveEndpoint(main, 'sys.comp')?.$type).toBe('Container');
        // Second region is flat, so the bare id resolves.
        expect(resolveEndpoint(main, 'inner')?.$type).toBe('Container');
        expect(resolveEndpoint(main, 'other')?.$type).toBe('SoftwareSystem');
    });
});

const PARENT = `workspace {
    model {
        !identifiers hierarchical
        psys = softwareSystem "PSys" {
            pcomp = container "PComp"
        }
        !identifiers flat
        pflat = softwareSystem "PFlat" {
            pinner = container "PInner"
        }
    }
}
`;

const CHILD = `workspace extends "parent.dsl" {
    model {
        psys.pcomp -> pflat "uses"
        pinner -> psys.pcomp "flat"
    }
}
`;

const TRANSITIVE_MAIN = `!identifiers hierarchical
workspace {
    model {
        !include "mid.dsl"
        mainSys = softwareSystem "MainSys"
        fragSys.fragComp -> mainSys "uses"
    }
}
`;

const TRANSITIVE_MID = `!include "frag.dsl"
`;

const TRANSITIVE_FRAG = `fragSys = softwareSystem "FragSys" {
    fragComp = container "FragComp"
}
`;

describe('!identifiers inheritance through nested includes', () => {
    it('inherits the including region across an intermediate fragment', async () => {
        const docs = await buildProject({
            'main.dsl': TRANSITIVE_MAIN,
            'mid.dsl': TRANSITIVE_MID,
            'frag.dsl': TRANSITIVE_FRAG,
        });
        const main = docs.get('main.dsl')!;

        expect(main.parseResult.parserErrors).toHaveLength(0);
        // main is hierarchical, mid has no directive, so frag inherits it transitively.
        expect(resolveEndpoint(main, 'fragSys.fragComp')?.$type).toBe('Container');
    });
});

const BASE_MAIN = `!identifiers hierarchical
workspace {
    model {
        !include "frag.dsl"
        mainSys = softwareSystem "MainSys"
        before.beforeComp -> mainSys "before"
        afterComp -> mainSys "after"
    }
}
`;

const BASE_FRAG = `before = softwareSystem "Before" {
    beforeComp = container "BeforeComp"
}
!identifiers flat
after = softwareSystem "After" {
    afterComp = container "AfterComp"
}
`;

describe('!identifiers base region of a fragment with its own directive', () => {
    it('inherits the including region before the fragment first directive', async () => {
        const docs = await buildProject({ 'main.dsl': BASE_MAIN, 'frag.dsl': BASE_FRAG });
        const main = docs.get('main.dsl')!;

        expect(main.parseResult.parserErrors).toHaveLength(0);
        // Region before the fragment's first directive inherits the include parent.
        expect(resolveEndpoint(main, 'before.beforeComp')?.$type).toBe('Container');
        // Region after it keeps the directive's flat style.
        expect(resolveEndpoint(main, 'afterComp')?.$type).toBe('Container');
    });
});

describe('!identifiers with a cyclic include chain', () => {
    it('terminates when two documents include each other', async () => {
        const docs = await buildProject({
            'a.dsl': `!include "b.dsl"
!identifiers flat
A = softwareSystem "A"
A -> B "uses"
`,
            'b.dsl': `!include "a.dsl"
!identifiers hierarchical
B = softwareSystem "B"
B -> A "uses"
`,
        });
        const a = docs.get('a.dsl')!;
        const b = docs.get('b.dsl')!;

        expect(a.parseResult.parserErrors).toHaveLength(0);
        expect(b.parseResult.parserErrors).toHaveLength(0);
        // Both references resolve: a cyclic walk must terminate, not fail linking.
        expect(resolveEndpoint(a, 'B')?.$type).toBe('SoftwareSystem');
        expect(resolveEndpoint(b, 'A')?.$type).toBe('SoftwareSystem');
    });
});

describe('!identifiers regions in extended workspaces', () => {
    it('applies the style of each element region in the parent workspace', async () => {
        const docs = await buildProject({ 'parent.dsl': PARENT, 'child.dsl': CHILD });
        const child = docs.get('child.dsl')!;
        const parent = docs.get('parent.dsl')!;

        expect(child.parseResult.parserErrors).toHaveLength(0);
        expect(parent.parseResult.parserErrors).toHaveLength(0);

        expect(resolveEndpoint(child, 'psys.pcomp')?.$type).toBe('Container');
        expect(resolveEndpoint(child, 'pinner')?.$type).toBe('Container');
        expect(resolveEndpoint(child, 'pflat')?.$type).toBe('SoftwareSystem');
    });
});
