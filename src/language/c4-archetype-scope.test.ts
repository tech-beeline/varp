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
import { URI } from 'vscode-uri';
import { createC4Services } from './c4-module';
import { archetypeInstanceTypeByRefText } from './c4-utils';
import { isSystemContextView } from '../generated/ast';

/**
 * Builds a standalone C4 document and runs the DocumentBuilder pipeline.
 */
async function buildDocument(content: string): Promise<LangiumDocument> {
    const services = createC4Services({ connection: undefined as any, ...EmptyFileSystem }).C4;
    const doc = services.shared.workspace.LangiumDocumentFactory.fromString(
        content,
        URI.parse('file:///archetype-scope.dsl')
    );
    services.shared.workspace.LangiumDocuments.addDocument(doc);
    await services.shared.workspace.DocumentBuilder.build([doc]);
    return doc;
}

/**
 * Returns the node the single systemContext view is scoped to.
 */
function systemContextScope(doc: LangiumDocument): any {
    const views = AstUtils.streamAllContents(doc.parseResult.value)
        .filter(isSystemContextView)
        .toArray();
    expect(views).toHaveLength(1);
    return views[0].softwareSystem.ref;
}

describe('archetypeInstanceTypeByRefText', () => {
    const arch = (props: Record<string, unknown>) => ({ $type: 'ArchetypeNamed', ...props }) as any;

    it('follows the baseArchetype chain to a concrete base type', () => {
        const base = arch({ name: 'base', baseType: 'softwaresystem' });
        const derived = arch({ name: 'derived', baseArchetype: { $refText: 'base' } });
        const byName: Record<string, any> = { base, derived };
        const lookup = (name?: string) => (name ? byName[name] : undefined);

        expect(archetypeInstanceTypeByRefText({ archetype: { $refText: 'derived' } }, lookup))
            .toBe('SoftwareSystem');
    });

    it('maps a relationship-arrow archetype to Relationship', () => {
        const rel = arch({ name: 'rel', baseArrow: '->' });
        const lookup = (name?: string) => (name === 'rel' ? rel : undefined);

        expect(archetypeInstanceTypeByRefText({ archetype: { $refText: 'rel' } }, lookup))
            .toBe('Relationship');
    });

    it('returns undefined for an unknown archetype', () => {
        expect(archetypeInstanceTypeByRefText({ archetype: { $refText: 'missing' } }, () => undefined))
            .toBeUndefined();
    });

    it('cuts an inheritance cycle without hanging', () => {
        const a = arch({ name: 'a', baseArchetype: { $refText: 'b' } });
        const b = arch({ name: 'b', baseArchetype: { $refText: 'a' } });
        const byName: Record<string, any> = { a, b };
        const lookup = (name?: string) => (name ? byName[name] : undefined);

        expect(archetypeInstanceTypeByRefText({ archetype: { $refText: 'a' } }, lookup))
            .toBeUndefined();
    });
});

describe('archetype instance reference resolution', () => {
    it('resolves a concrete SoftwareSystem reference to an archetype instance', async () => {
        const doc = await buildDocument(`
workspace {
    model {
        archetypes {
            externalSystem = softwaresystem
        }
        b = externalSystem "B"
    }
    views {
        systemContext b {
            include *
        }
    }
}
`);

        expect(doc.parseResult.parserErrors).toHaveLength(0);
        expect(systemContextScope(doc)?.$type).toBe('ArchetypeInstance');
    });

    it('resolves a concrete reference through a baseArchetype chain', async () => {
        const doc = await buildDocument(`
workspace {
    model {
        archetypes {
            base = softwaresystem
            derived = base
        }
        c = derived "C"
    }
    views {
        systemContext c {
            include *
        }
    }
}
`);

        expect(doc.parseResult.parserErrors).toHaveLength(0);
        expect(systemContextScope(doc)?.$type).toBe('ArchetypeInstance');
    });

    it('rejects an element-based archetype for a SoftwareSystem reference', async () => {
        const doc = await buildDocument(`
workspace {
    model {
        archetypes {
            hardwareSystem = element
        }
        b = hardwareSystem "B"
    }
    views {
        systemContext b {
            include *
        }
    }
}
`);

        expect(doc.parseResult.parserErrors).toHaveLength(0);
        expect(systemContextScope(doc)).toBeUndefined();
    });
});
