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
import { DiagnosticSeverity, type Diagnostic } from 'vscode-languageserver';
import { URI } from 'vscode-uri';
import { createC4Services } from './c4-module';

const SAMPLE_WITH_REJECTED_CONSTRUCTS = `workspace {
    model {
        first = softwareSystem "First" {
            component "Widget"
        }
        second = softwareSystem "Second" {
            component "Gadget"
        }
    }
}
`;

async function buildDocument(content: string): Promise<LangiumDocument> {
    const services = createC4Services({ connection: undefined as any, ...EmptyFileSystem }).C4;
    const doc = services.shared.workspace.LangiumDocumentFactory.fromString(content, URI.parse('file:///diagnostics.dsl'));
    services.shared.workspace.LangiumDocuments.addDocument(doc);
    await services.shared.workspace.DocumentBuilder.build([doc], { validation: true });
    return doc;
}

function diagnostics(doc: LangiumDocument): string[] {
    return (doc.diagnostics ?? []).map(d => (typeof d.message === 'string' ? d.message : d.message.value));
}

/** Builds a project of several documents and returns their diagnostics by file name. */
async function buildProject(files: Record<string, string>): Promise<Map<string, Diagnostic[]>> {
    const services = createC4Services({ connection: undefined as any, ...EmptyFileSystem }).C4;
    const entries = Object.entries(files).map(([name, content]) => {
        const doc = services.shared.workspace.LangiumDocumentFactory.fromString(content, URI.parse(`file:///${name}`));
        services.shared.workspace.LangiumDocuments.addDocument(doc);
        return [name, doc] as const;
    });
    await services.shared.workspace.DocumentBuilder.build(entries.map(([, doc]) => doc), { validation: true });
    return new Map(entries.map(([name, doc]) => [name, doc.diagnostics ?? []]));
}

describe('parser diagnostics', () => {
    it('reports an unknown word in a view once, with the keywords of the view', async () => {
        const doc = await buildDocument(`workspace {
    !identifiers hierarchical
    model {
        a = softwareSystem "A" {
            s = container "S"
        }
        !element a {
            tags "ExtraOne,ExtraTwo"
        }
    }
    views {
        systemContext a {
            zzz
            include *
        }
    }
}
`);

        const errors = diagnostics(doc);
        expect(errors).toEqual([
            'Unexpected tokens (expected: include, exclude, autoLayout, default, animation, '
            + 'title, description, properties, !include, !script, !plugin, !const).'
        ]);
    });

    it('reports a closing brace after the document as an unexpected token', async () => {
        const doc = await buildDocument(`workspace {
    model {
        a = softwareSystem "A"
    }
}
}
`);

        expect(diagnostics(doc)).toEqual(["Unexpected token '}'"]);
    });

    it('reports only the first closing brace of a trailing run', async () => {
        const doc = await buildDocument(`workspace {
    model {
        a = softwareSystem "A"
    }
}
}
}
`);

        expect(diagnostics(doc)).toEqual(["Unexpected token '}'"]);
    });

    it('reports a view error once when the document has no trailing newline', async () => {
        const doc = await buildDocument(`workspace {
    model {
        a = softwareSystem "A"
    }
    views {
        systemContext a {
            zzz
            include *
        }
    }
}`);

        expect(diagnostics(doc)).toEqual([
            'Unexpected tokens (expected: include, exclude, autoLayout, default, animation, '
            + 'title, description, properties, !include, !script, !plugin, !const).'
        ]);
    });

    it('reports a closing brace after a document without a trailing newline', async () => {
        const doc = await buildDocument(`workspace {
    model {
        a = softwareSystem "A"
    }
}
}`);

        expect(diagnostics(doc)).toEqual(["Unexpected token '}'"]);
    });

    it('points at the missing closing brace when the input ends inside a block', async () => {
        const doc = await buildDocument(`workspace {
    model {
        a = softwareSystem "A"
`);

        const errors = diagnostics(doc);
        expect(errors).toHaveLength(1);
        expect(errors[0]).toContain('Unexpected end of DSL content');
        expect(errors[0]).toContain('closing curly braces missing?');
        expect(errors[0]).toContain('softwaresystem');
    });

    it('reports an unknown word in a deployment environment once, without the recovered cascade', async () => {
        const doc = await buildDocument(`workspace {
    model {
        system = softwareSystem "System"
        live = deploymentEnvironment "Live" {
            zzz
            deploymentNode "Node" {
                infrastructureNode "Proxy"
            }
            proxy -> proxy "calls"
        }
    }
}
`);

        expect(diagnostics(doc)).toEqual([
            'Unexpected tokens (expected: group, deploymentGroup, deploymentNode, -/>, ->, '
            + '!impliedRelationships, !elements, !relationships, !script, !plugin, !const, !include).'
        ]);
    });

    it('keeps a diagnostic that precedes the failure and drops the ones that follow it', async () => {
        const doc = await buildDocument(`workspace {
    model {
        a = softwareSystem "A"
        a -> missing "calls"
    }
    views {
        systemContext a {
            zzz
            include *
        }
    }
}
`);

        expect(diagnostics(doc)).toEqual([
            'Unexpected tokens (expected: include, exclude, autoLayout, default, animation, '
            + 'title, description, properties, !include, !script, !plugin, !const).',
            'The destination element "missing" does not exist'
        ]);
    });

    it('reports a group declaration without a body as a group with a name and a brace', async () => {
        const doc = await buildDocument(`workspace {

    model {
        group "Name"
    }

}
`);

        expect(doc.diagnostics?.map(d => d.message)).toEqual(['Expected: group <name> {']);
        expect(doc.diagnostics?.[0].range).toEqual({
            start: { line: 3, character: 8 },
            end: { line: 3, character: 20 }
        });
    });

    it('reports a keyword as what the block accepts, not as a relationship source', async () => {
        const doc = await buildDocument(`workspace {
    model {
        a = softwareSystem "A" {
            component "C"
        }
    }
}
`);

        const errors = diagnostics(doc);
        expect(errors).toHaveLength(1);
        expect(errors[0]).toContain('Unexpected tokens (expected: group, container');
        expect(doc.diagnostics?.[0].range.start.line).toBe(3);
        expect(doc.diagnostics?.[0].range.start.character).toBe(12);
    });

    it('keeps reading after a construct a block rejects', async () => {
        const doc = await buildDocument(SAMPLE_WITH_REJECTED_CONSTRUCTS);

        const errors = diagnostics(doc);
        expect(errors).toHaveLength(2);
        expect(errors[0]).toContain('Unexpected tokens (expected: group, container');
        expect(errors[1]).toEqual(errors[0]);
        expect(doc.diagnostics?.map(diagnostic => diagnostic.range.start.line)).toEqual([3, 6]);

        const systems = AstUtils.streamAst(doc.parseResult.value).toArray()
            .filter(node => node.$type === 'SoftwareSystem') as Array<{ name?: string }>;
        expect(systems).toHaveLength(2);
        expect(systems[1].name).toContain('Second');
    });

    it('offers inlay hints for a declaration that follows a rejected construct', async () => {
        const services = createC4Services({ connection: undefined as any, ...EmptyFileSystem }).C4;
        const uri = URI.parse('file:///diagnostics-hints.dsl');
        const doc = services.shared.workspace.LangiumDocumentFactory.fromString(SAMPLE_WITH_REJECTED_CONSTRUCTS, uri);
        services.shared.workspace.LangiumDocuments.addDocument(doc);
        await services.shared.workspace.DocumentBuilder.build([doc], { validation: true });

        const hints = (await services.lsp.InlayHintProvider!.getInlayHints(doc, {
            textDocument: { uri: uri.toString() },
            range: { start: { line: 0, character: 0 }, end: { line: 20, character: 0 } }
        } as any)) ?? [];
        const names = hints
            .filter(hint => hint.label === 'name:')
            .map(hint => hint.position.line);
        expect(names).toEqual([2, 5]);
    });

    it('reports a property without a value as a name-value pair', async () => {
        const doc = await buildDocument(`workspace {
    model {
        a = softwareSystem "A" {
            properties {
                "key"
            }
        }
    }
}
`);

        expect(diagnostics(doc)).toEqual(['Expected: <name> <value>']);
    });

    it('covers the whole word of a rejected directive', async () => {
        const doc = await buildDocument(`workspace {
    !contstant NAME VALUE
}
`);

        const text = doc.textDocument.getText();
        const [start, end] = [doc.diagnostics![0].range.start, doc.diagnostics![0].range.end];
        expect(text.slice(doc.textDocument.offsetAt(start), doc.textDocument.offsetAt(end))).toBe('!contstant');
    });

    it('reports a rejected directive with the tokens of the block', async () => {
        const doc = await buildDocument(`workspace {
    !contstant NAME VALUE
}
`);

        expect(diagnostics(doc)).toEqual([
            'Unexpected tokens (expected: name, description, properties, !docs, !decisions, !identifiers, '
            + '!impliedRelationships, model, views, configuration, !script, !plugin, !const, !include).'
        ]);
    });
});

describe('workspace diagnostics', () => {
    it('reports an !include target that could not be found', async () => {
        const doc = await buildDocument(`workspace {
    !include "nope.dsl"
    model {
        a = softwareSystem "A"
    }
}
`);

        const errors = diagnostics(doc);
        expect(errors).toHaveLength(1);
        expect(errors[0]).toContain('nope.dsl could not be found');
    });

    it('reports an empty file as missing a workspace definition', async () => {
        const doc = await buildDocument('');

        expect(diagnostics(doc)).toEqual(['No workspace definition was found - please check your DSL']);
    });

    it('reports a file of comments as missing a workspace definition', async () => {
        const doc = await buildDocument('// nothing here\n');

        expect(diagnostics(doc)).toEqual(['No workspace definition was found - please check your DSL']);
    });

    it('accepts declarations that a workspace file includes as a fragment', async () => {
        const doc = await buildDocument(`model {
    a = softwareSystem "A"
}
`);

        expect(diagnostics(doc)).toEqual([]);
    });
});

describe('standalone document diagnostics', () => {
    const FRAGMENT = `model {
    a = softwareSystem "A"
    !include "\${BASE}/b.dsl"
}
`;
    const REASON = 'File is not included by any workspace, so constants declared in other files are '
        + 'not visible here: ${BASE}.';

    it('explains a constant that a file cannot see because no workspace includes it', async () => {
        const warning = (await buildProject({ 'fragment.dsl': FRAGMENT }))
            .get('fragment.dsl')!
            .find(diagnostic => diagnostic.severity === DiagnosticSeverity.Warning);

        expect(warning?.message).toBe(REASON);
        expect(warning?.range).toEqual({
            start: { line: 0, character: 0 },
            end: { line: 4, character: 0 }
        });
    });

    it('reports the include that the constant leaves unresolved next to the reason', async () => {
        const result = (await buildProject({ 'fragment.dsl': FRAGMENT })).get('fragment.dsl')!;

        expect(result).toHaveLength(2);
        expect(typeof result[0].message === 'string' ? result[0].message : '').toContain('could not be found');
        expect(result[1].message).toBe(REASON);
    });

    it('does not warn when a workspace includes the file', async () => {
        const result = (await buildProject({
            'main.dsl': '!const BASE "model"\nworkspace {\n    model {\n        !include "fragment.dsl"\n    }\n}\n',
            'fragment.dsl': FRAGMENT,
        })).get('fragment.dsl')!;

        expect(result.map(diagnostic => diagnostic.severity)).not.toContain(DiagnosticSeverity.Warning);
    });

    it('does not warn about a constant the file declares itself', async () => {
        const result = (await buildProject({
            'fragment.dsl': `!const BASE "model"\n${FRAGMENT}`,
        })).get('fragment.dsl')!;

        expect(result.map(diagnostic => diagnostic.severity)).not.toContain(DiagnosticSeverity.Warning);
    });

    it('does not warn about a file that needs no constants from other files', async () => {
        const result = (await buildProject({ 'fragment.dsl': 'model {\n    a = softwareSystem "A"\n}\n' }))
            .get('fragment.dsl')!;

        expect(result).toEqual([]);
    });
});
