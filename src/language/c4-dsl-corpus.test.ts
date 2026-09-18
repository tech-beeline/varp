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
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { NodeFileSystem } from 'langium/node';
import { URI } from 'vscode-uri';
import { createC4Services } from './c4-module';

/**
 * A corpus of DSL files kept from the reference implementation
 * (structurizr-dsl/src/test/resources/dsl, Apache-2.0), limited to the ones its own parser
 * accepts, so that anything valid there keeps parsing here.
 *
 * The files its parser rejects are not part of the corpus; the constructs they exercise are
 * covered by the inline cases below, which check that this parser rejects them as well.
 *
 * Fixtures whose !include/extends points at a resource the corpus does not contain (remote
 * URLs, JSON workspaces) are excluded as well: they cannot be resolved from the corpus.
 */
const FIXTURES = resolve(__dirname, '../../test/fixtures/dsl');

function collectFixtures(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) collectFixtures(full, out);
        else if (entry.endsWith('.dsl')) out.push(full);
    }
    return out;
}

describe('DSL corpus fixtures', () => {
    it('parses every fixture the reference parser accepts', async () => {
        // A real file system lets the builder load local !include/extends targets from the
        // corpus, so those fixtures exercise inheritance instead of being parsed in isolation.
        const services = createC4Services({ connection: undefined as any, ...NodeFileSystem }).C4;
        const failures: string[] = [];
        for (const file of collectFixtures(FIXTURES)) {
            const uri = URI.file(file);
            // A fixture may already be loaded as another fixture's extends/include target.
            let doc = services.shared.workspace.LangiumDocuments.getDocument(uri);
            if (!doc) {
                doc = services.shared.workspace.LangiumDocumentFactory.fromString(readFileSync(file, 'utf8'), uri);
                services.shared.workspace.LangiumDocuments.addDocument(doc);
            }
            await services.shared.workspace.DocumentBuilder.build([doc], { validation: true });
            const errors = doc.parseResult.parserErrors;
            if (errors.length > 0) {
                failures.push(`${file.replace(/\\/g, '/')} :: ${errors[0].message.split('\n')[0].slice(0, 110)}`);
                continue;
            }
            for (const diagnostic of doc.diagnostics ?? []) {
                if (diagnostic.severity !== 1) continue;
                const message = typeof diagnostic.message === 'string' ? diagnostic.message : diagnostic.message.value;
                failures.push(`${file.replace(/\\/g, '/')} :: ${message.slice(0, 110)}`);
            }
        }
        expect(failures).toEqual([]);
    }, 180_000);
});

/** Rejections the reference parser raises at parse time that are reported as diagnostics here. */
describe('constructs the reference parser rejects', () => {
    const cases: Record<string, string> = {
        'multiple workspaces': `workspace {
    model {
        person "A"
    }
}

workspace {
    model {
        person "B"
    }
}
`,
        'multiple models': `workspace {
    model {
        person "A"
    }
    model {
        person "B"
    }
}
`,
        'multiple view sets': `workspace {
    model {
        person "A"
    }
    views {
        systemLandscape {
            include *
        }
    }
    views {
        systemLandscape {
            include *
        }
    }
}
`,
        'model content before the workspace': `hello world

workspace {
}
`,
        'model content after the workspace': `workspace {
}

hello world
`,
        'a relationship that repeats an implied one': `workspace {
    model {
        a = softwareSystem "A"
        b = softwareSystem "B" {
            c = container "C"
        }
        c -> a
        b -> a
    }
}
`,
    };

    for (const [name, dsl] of Object.entries(cases)) {
        it(`rejects ${name}`, async () => {
            const services = createC4Services({ connection: undefined as any, ...NodeFileSystem }).C4;
            const doc = services.shared.workspace.LangiumDocumentFactory.fromString(dsl, URI.parse('file:///rejected.dsl'));
            services.shared.workspace.LangiumDocuments.addDocument(doc);
            await services.shared.workspace.DocumentBuilder.build([doc], { validation: true });
            const rejected = doc.parseResult.parserErrors.length > 0
                || (doc.diagnostics ?? []).some(d => d.severity === 1);
            expect(rejected).toBe(true);
        });
    }
});
