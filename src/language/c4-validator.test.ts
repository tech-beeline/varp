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
import { EmptyFileSystem, type LangiumDocument } from 'langium';
import { URI, Utils } from 'vscode-uri';
import { createC4Services } from './c4-module';

const ERROR_SEVERITY = 1;
const WARNING_SEVERITY = 2;

const PROJECT = URI.parse('file:///validator-project/');

/** Parses a DSL string with validation enabled. */
async function build(content: string): Promise<LangiumDocument> {
    const services = createC4Services({ connection: undefined as any, ...EmptyFileSystem }).C4;
    const doc = services.shared.workspace.LangiumDocumentFactory.fromString(
        content,
        URI.parse('file:///validator.dsl')
    );
    services.shared.workspace.LangiumDocuments.addDocument(doc);
    await services.shared.workspace.DocumentBuilder.build([doc], { validation: true });
    return doc;
}

/** Builds a set of related .dsl documents so that !include directives resolve. */
async function buildProject(files: Record<string, string>): Promise<Map<string, LangiumDocument>> {
    const services = createC4Services({ connection: undefined as any, ...EmptyFileSystem }).C4;
    const docs = new Map<string, LangiumDocument>();
    for (const [name, content] of Object.entries(files)) {
        const doc = services.shared.workspace.LangiumDocumentFactory.fromString(
            content,
            Utils.resolvePath(PROJECT, name)
        );
        services.shared.workspace.LangiumDocuments.addDocument(doc);
        docs.set(name, doc);
    }
    await services.shared.workspace.DocumentBuilder.build([...docs.values()], { validation: true });
    return docs;
}

function messages(doc: LangiumDocument, severity: number): string[] {
    return (doc.diagnostics ?? [])
        .filter(d => d.severity === severity)
        .map(d => typeof d.message === 'string' ? d.message : d.message.value);
}

describe('view property validation', () => {
    it('accepts repeated title and properties, which the original overwrites and merges', async () => {
        const doc = await build(`
workspace {
    model {
        a = softwareSystem "A" {
            c = container "C"
        }
    }
    views {
        container a "cv" {
            title "First"
            title "Second"
            properties {
                first one
            }
            properties {
                second two
            }
        }
    }
}
`);

        expect(doc.parseResult.parserErrors).toHaveLength(0);
        expect(messages(doc, ERROR_SEVERITY)).toHaveLength(0);
    });

    it('warns when a views block declares both theme and themes', async () => {
        const doc = await build(`
workspace {
    views {
        theme "https://example.com/theme.json"
        themes "https://example.com/theme.json"
        systemLandscape "land" {
            include *
        }
    }
}
`);

        expect(doc.parseResult.parserErrors).toHaveLength(0);
        expect(messages(doc, WARNING_SEVERITY)).toContain(
            "It's recommended to use either 'theme' or 'themes', but not both."
        );
    });

    it('anchors the theme/themes warning to the declarations, not the whole views block', async () => {
        const doc = await build(`
workspace {
    views {
        theme "https://example.com/theme.json"
        themes "https://example.com/theme.json"
        systemLandscape "land" {
            include *
        }
    }
}
`);

        const warnings = (doc.diagnostics ?? []).filter(d => d.severity === WARNING_SEVERITY
            && String(d.message).includes("either 'theme' or 'themes'"));
        expect(warnings).toHaveLength(2);
        // One warning on the `theme` line and one on the `themes` line.
        expect(warnings.map(d => d.range.start.line).sort((a, b) => a - b)).toEqual([3, 4]);
        for (const warning of warnings) {
            expect(warning.range.start.line).toBe(warning.range.end.line);
        }
    });
});

describe('view key uniqueness', () => {
    it('reports a duplicate key once, on the later view', async () => {
        const doc = await build(`
views {
    systemLandscape "shared" {
        include *
    }
    systemLandscape "shared" {
        include *
    }
}
`);

        expect(doc.parseResult.parserErrors).toHaveLength(0);
        const errors = messages(doc, ERROR_SEVERITY).filter(m => m.includes('already exists'));
        expect(errors).toEqual(["A view with the key 'shared' already exists."]);
    });

    it('detects duplicates declared in a root views block next to a workspace', async () => {
        const doc = await build(`
views {
    systemLandscape "shared" {
        include *
    }
}
workspace {
    views {
        systemLandscape "shared" {
            include *
        }
    }
}
`);

        expect(doc.parseResult.parserErrors).toHaveLength(0);
        expect(messages(doc, ERROR_SEVERITY)).toContain("A view with the key 'shared' already exists.");
    });

    it('treats a quoted and an unquoted key as the same key', async () => {
        const doc = await build(`
views {
    systemLandscape "shared" {
        include *
    }
    systemLandscape shared {
        include *
    }
}
`);

        expect(doc.parseResult.parserErrors).toHaveLength(0);
        expect(messages(doc, ERROR_SEVERITY)).toContain("A view with the key 'shared' already exists.");
    });

    it('accepts distinct keys in a root views block', async () => {
        const doc = await build(`
views {
    systemLandscape "land" {
        include *
    }
    systemLandscape "other" {
        include *
    }
}
`);

        expect(doc.parseResult.parserErrors).toHaveLength(0);
        expect(messages(doc, ERROR_SEVERITY)).toHaveLength(0);
    });
});

describe('default view uniqueness', () => {
    it('warns about the default markers the last one overrides', async () => {
        const doc = await build(`
views {
    systemLandscape "one" {
        include *
        default
    }
    systemLandscape "two" {
        include *
        default
    }
}
`);

        expect(doc.parseResult.parserErrors).toHaveLength(0);
        expect(messages(doc, ERROR_SEVERITY).filter(m => m.includes("marked as 'default'"))).toHaveLength(0);
        const warnings = messages(doc, WARNING_SEVERITY).filter(m => m.includes("marked as 'default'"));
        expect(warnings).toHaveLength(1);
    });

    it('accepts a single default marker', async () => {
        const doc = await build(`
views {
    systemLandscape "one" {
        include *
        default
    }
}
`);

        expect(doc.parseResult.parserErrors).toHaveLength(0);
        expect(messages(doc, ERROR_SEVERITY)).toHaveLength(0);
    });
});

describe('nested groups', () => {
    it('warns about a missing group separator for nested groups', async () => {
        const doc = await build(`
workspace {
    model {
        group "Outer" {
            group "Inner" {
                person "User"
            }
        }
    }
}
`);

        expect(doc.parseResult.parserErrors).toHaveLength(0);
        expect(messages(doc, ERROR_SEVERITY)).toHaveLength(0);
        expect(messages(doc, WARNING_SEVERITY)).toContain(
            "To use nested groups, please define a model property named 'structurizr.groupSeparator'."
        );
    });

    it('accepts nested groups when the model defines a separator', async () => {
        const doc = await build(`
workspace {
    model {
        properties {
            structurizr.groupSeparator "/"
        }
        group "Outer" {
            group "Inner" {
                person "User"
            }
        }
    }
}
`);

        expect(doc.parseResult.parserErrors).toHaveLength(0);
        expect(messages(doc, ERROR_SEVERITY)).toHaveLength(0);
    });

    it('accepts a group inside a deployment node that sits in a group', async () => {
        const doc = await build(`
workspace {
    model {
        live = deploymentEnvironment "Live" {
            group "Servers" {
                deploymentNode "Server 1" {
                    group "Service 1" {
                    }
                }
            }
        }
    }
}
`);

        expect(doc.parseResult.parserErrors).toHaveLength(0);
        expect(messages(doc, ERROR_SEVERITY)).toHaveLength(0);
    });

    it('accepts a single group without a separator', async () => {
        const doc = await build(`
workspace {
    model {
        group "Outer" {
            person "User"
        }
    }
}
`);

        expect(doc.parseResult.parserErrors).toHaveLength(0);
        expect(messages(doc, ERROR_SEVERITY)).toHaveLength(0);
    });

    it('rejects a multi-character group separator', async () => {
        const doc = await build(`
workspace {
    model {
        properties {
            structurizr.groupSeparator "//"
        }
    }
}
`);

        expect(doc.parseResult.parserErrors).toHaveLength(0);
        expect(messages(doc, ERROR_SEVERITY)).toContain('Group separator must be a single character');
    });
});

describe('icon position', () => {
    it('accepts the positions the model supports', async () => {
        const doc = await build(`
workspace {
    views {
        styles {
            element "Element" {
                iconPosition bottom
            }
        }
    }
}
`);

        expect(doc.parseResult.parserErrors).toHaveLength(0);
        expect(messages(doc, ERROR_SEVERITY)).toHaveLength(0);
    });

    it('rejects an unsupported position', async () => {
        const doc = await build(`
workspace {
    views {
        styles {
            element "Element" {
                iconPosition middle
            }
        }
    }
}
`);

        expect(doc.parseResult.parserErrors).toHaveLength(0);
        expect(messages(doc, ERROR_SEVERITY)).toContain('The icon position "middle" is not valid');
    });
});

describe('boolean style properties', () => {
    it('rejects a dashed value that is not true or false', async () => {
        const doc = await build(`
workspace {
    views {
        styles {
            relationship "Uses" {
                dashed "sometimes"
            }
        }
    }
}
`);

        expect(doc.parseResult.parserErrors).toHaveLength(0);
        expect(messages(doc, ERROR_SEVERITY)).toContain('Dashed must be true or false.');
    });
});

describe('duplicate relationships', () => {
    it('rejects a repeated relationship', async () => {
        const doc = await build(`
workspace {
    model {
        a = softwareSystem "A"
        b = softwareSystem "B"
        a -> b "uses"
        a -> b "uses"
    }
}
`);

        expect(doc.parseResult.parserErrors).toHaveLength(0);
        expect(messages(doc, ERROR_SEVERITY)).toContain(
            'A relationship between "SoftwareSystem://A" and "SoftwareSystem://B" already exists'
        );
    });

    it('rejects a relationship that repeats an implied one', async () => {
        const doc = await build(`
workspace {
    model {
        a = softwareSystem "A"
        b = softwareSystem "B" {
            c = container "C"
        }
        c -> a
        b -> a
    }
}
`);

        expect(doc.parseResult.parserErrors).toHaveLength(0);
        expect(messages(doc, ERROR_SEVERITY)).toContain(
            'A relationship between "SoftwareSystem://B" and "SoftwareSystem://A" already exists'
        );
    });

    it('accepts the same pair with a different description', async () => {
        const doc = await build(`
workspace {
    model {
        a = softwareSystem "A"
        b = softwareSystem "B"
        a -> b "uses"
        a -> b "creates"
    }
}
`);

        expect(doc.parseResult.parserErrors).toHaveLength(0);
        expect(messages(doc, ERROR_SEVERITY)).toHaveLength(0);
    });

    it('accepts an implied conflict when implied relationships are disabled', async () => {
        const doc = await build(`
workspace {
    model {
        !impliedRelationships false
        a = softwareSystem "A"
        b = softwareSystem "B" {
            c = container "C"
        }
        c -> a
        b -> a
    }
}
`);

        expect(doc.parseResult.parserErrors).toHaveLength(0);
        expect(messages(doc, ERROR_SEVERITY)).toHaveLength(0);
    });

    it('rejects a repeated implicit relationship', async () => {
        const doc = await build(`
workspace {
    model {
        a = softwareSystem "A" {
            c = container "C" {
                -> c "uses"
                -> c "uses"
            }
        }
    }
}
`);

        expect(doc.parseResult.parserErrors).toHaveLength(0);
        expect(messages(doc, ERROR_SEVERITY)).toContain(
            'A relationship between "Container://A.C" and "Container://A.C" already exists'
        );
    });
});

describe('top-level element uniqueness', () => {
    it('shares one name namespace between people and software systems', async () => {
        const doc = await build(`
workspace {
    model {
        softwareSystem "Shared"
        person "Shared"
    }
}
`);

        expect(doc.parseResult.parserErrors).toHaveLength(0);
        expect(messages(doc, ERROR_SEVERITY)).toContain(
            "A person or software system named 'Shared' already exists."
        );
    });

    it('detects duplicates declared at the document root', async () => {
        const doc = await build(`
softwareSystem "Shared"
person "Shared"
`);

        expect(doc.parseResult.parserErrors).toHaveLength(0);
        expect(messages(doc, ERROR_SEVERITY)).toContain(
            "A person or software system named 'Shared' already exists."
        );
    });

    it('detects duplicates between a root element and a model block', async () => {
        const doc = await build(`
softwareSystem "Shared"
workspace {
    model {
        softwareSystem "Shared"
    }
}
`);

        expect(doc.parseResult.parserErrors).toHaveLength(0);
        expect(messages(doc, ERROR_SEVERITY)).toContain(
            "A person or software system named 'Shared' already exists."
        );
    });

    it('detects duplicates nested in groups', async () => {
        const doc = await build(`
workspace {
    model {
        group "G" {
            softwareSystem "Shared"
        }
        group "H" {
            softwareSystem "Shared"
        }
    }
}
`);

        expect(doc.parseResult.parserErrors).toHaveLength(0);
        expect(messages(doc, ERROR_SEVERITY)).toContain(
            "A person or software system named 'Shared' already exists."
        );
    });

    it('detects duplicate custom element names', async () => {
        const doc = await build(`
workspace {
    model {
        element "Shared"
        element "Shared"
    }
}
`);

        expect(doc.parseResult.parserErrors).toHaveLength(0);
        expect(messages(doc, ERROR_SEVERITY)).toContain(
            "A top-level element named 'Shared' already exists."
        );
    });

    it('keeps custom elements and people in separate namespaces', async () => {
        const doc = await build(`
workspace {
    model {
        person "Shared"
        element "Shared"
    }
}
`);

        expect(doc.parseResult.parserErrors).toHaveLength(0);
        expect(messages(doc, ERROR_SEVERITY)).toHaveLength(0);
    });

    it('detects duplicates pulled in through !include fragments', async () => {
        const docs = await buildProject({
            'main.dsl': `workspace {
    model {
        !include "frag.dsl"
        softwareSystem "Shared"
    }
}
`,
            'frag.dsl': `softwareSystem "Shared"
`,
        });
        const main = docs.get('main.dsl')!;

        expect(main.parseResult.parserErrors).toHaveLength(0);
        expect(messages(main, ERROR_SEVERITY)).toContain(
            "A person or software system named 'Shared' already exists."
        );
    });

    it('detects duplicates declared in an included fragment model block', async () => {
        const docs = await buildProject({
            'main.dsl': `workspace {
    model {
        !include "frag.dsl"
        softwareSystem "Shared"
    }
}
`,
            'frag.dsl': `model {
    softwareSystem "Shared"
}
`,
        });
        const main = docs.get('main.dsl')!;

        expect(messages(main, ERROR_SEVERITY)).toContain(
            "A person or software system named 'Shared' already exists."
        );
    });

    it('leaves duplicates inside an included fragment to that fragment', async () => {
        const docs = await buildProject({
            'main.dsl': `workspace {
    model {
        !include "frag.dsl"
    }
}
`,
            'frag.dsl': `softwareSystem "Shared"
softwareSystem "Shared"
`,
        });
        const main = docs.get('main.dsl')!;
        const fragment = docs.get('frag.dsl')!;

        expect(messages(main, ERROR_SEVERITY)).toHaveLength(0);
        expect(messages(fragment, ERROR_SEVERITY)).toContain(
            "A person or software system named 'Shared' already exists."
        );
    });

    it('anchors a cross-file duplicate inside the including document', async () => {
        const docs = await buildProject({
            'main.dsl': `workspace {
    model {
        softwareSystem "Shared"
        !include "frag.dsl"
    }
}
`,
            'frag.dsl': `softwareSystem "Shared"
`,
        });
        const main = docs.get('main.dsl')!;
        const reported = (main.diagnostics ?? []).filter(d => d.severity === ERROR_SEVERITY);

        expect(reported).toHaveLength(1);
        const offset = main.textDocument.offsetAt(reported[0].range.start);
        expect(main.textDocument.getText().slice(offset, offset + 20)).toContain('!include');
    });

    it('reports a collision between two different included fragments once', async () => {
        const docs = await buildProject({
            'main.dsl': `workspace {
    model {
        !include "first.dsl"
        !include "second.dsl"
    }
}
`,
            'first.dsl': `softwareSystem "Shared"
`,
            'second.dsl': `person "Shared"
`,
        });
        const main = docs.get('main.dsl')!;

        expect(messages(main, ERROR_SEVERITY).filter(m => m.includes('already exists'))).toEqual([
            "A person or software system named 'Shared' already exists."
        ]);
    });

    it('does not double-report an element reachable through a cyclic include', async () => {
        const docs = await buildProject({
            'a.dsl': `!include "b.dsl"
softwareSystem "Only"
`,
            'b.dsl': `!include "a.dsl"
`,
        });
        const a = docs.get('a.dsl')!;

        expect(a.parseResult.parserErrors).toHaveLength(0);
        expect(messages(a, ERROR_SEVERITY)).toHaveLength(0);
    });
});

describe('workspace metadata', () => {
    it('accepts a name and description given both in the header and as properties', async () => {
        const doc = await build(`
workspace "Name" "Description" {
    name "Other name"
    description "Other description"
}
`);

        expect(doc.parseResult.parserErrors).toHaveLength(0);
        expect(messages(doc, ERROR_SEVERITY)).toHaveLength(0);
    });
});

describe('relationship endpoints', () => {
    it('accepts an instanceOf instance as an endpoint', async () => {
        const doc = await build(`
workspace {
    !identifiers hierarchical
    model {
        ss = softwareSystem "System" {
            ui = container "UI"
            backend = container "Backend"
        }
        live = deploymentEnvironment "Live" {
            computer = deploymentNode "Computer" {
                browser = deploymentNode "Browser" {
                    uiInstance = instanceOf ss.ui
                }
            }
            datacenter = deploymentNode "Data Center" {
                server = deploymentNode "Server" {
                    backendInstance = instanceOf ss.backend
                }
            }
            computer.browser.uiInstance -> datacenter.server.backendInstance "Calls"
        }
    }
}
`);

        expect(doc.parseResult.parserErrors).toHaveLength(0);
        expect(messages(doc, ERROR_SEVERITY)).toHaveLength(0);
    });
});

describe('group content context', () => {
    it('rejects a container in a group inside the model', async () => {
        const doc = await build(`
workspace {
    model {
        group "G" {
            c = container "C"
        }
    }
}
`);

        expect(messages(doc, ERROR_SEVERITY).some(m => m.includes('Unexpected tokens'))).toBe(true);
    });

    it('rejects a deployment node in a group inside the model', async () => {
        const doc = await build(`
workspace {
    model {
        group "G" {
            dn = deploymentNode "DN"
        }
    }
}
`);

        expect(messages(doc, ERROR_SEVERITY).some(m => m.includes('Unexpected tokens'))).toBe(true);
    });

    it('accepts a person and a software system in a group inside the model', async () => {
        const doc = await build(`
workspace {
    model {
        group "G" {
            u = person "User"
            s = softwareSystem "System"
        }
    }
}
`);

        expect(messages(doc, ERROR_SEVERITY)).toHaveLength(0);
    });

    it('accepts a container in a group inside a software system', async () => {
        const doc = await build(`
workspace {
    model {
        s = softwareSystem "System" {
            group "G" {
                c = container "C"
            }
        }
    }
}
`);

        expect(messages(doc, ERROR_SEVERITY)).toHaveLength(0);
    });

    it('accepts a component in a group inside a container', async () => {
        const doc = await build(`
workspace {
    model {
        s = softwareSystem "System" {
            c = container "Container" {
                group "G" {
                    comp = component "Component"
                }
            }
        }
    }
}
`);

        expect(messages(doc, ERROR_SEVERITY)).toHaveLength(0);
    });

    it('accepts a deployment node in a group inside a deployment environment', async () => {
        const doc = await build(`
workspace {
    model {
        deploymentEnvironment "Live" {
            group "G" {
                dn = deploymentNode "DN"
            }
        }
    }
}
`);

        expect(messages(doc, ERROR_SEVERITY)).toHaveLength(0);
    });
});

describe('autolayout rank direction', () => {
    it('rejects an invalid rank direction', async () => {
        const doc = await build(`
workspace {
    model {
        s = softwareSystem "S"
    }
    views {
        systemContext s {
            autoLayout sideways
        }
    }
}
`);

        expect(messages(doc, ERROR_SEVERITY)).toContain('Valid rank directions are: tb|bt|lr|rl');
    });

    it('accepts every valid rank direction', async () => {
        for (const direction of ['tb', 'bt', 'lr', 'rl']) {
            const doc = await build(`
workspace {
    model {
        s = softwareSystem "S"
    }
    views {
        systemContext s {
            autoLayout ${direction}
        }
    }
}
`);

            expect(messages(doc, ERROR_SEVERITY)).toHaveLength(0);
        }
    });

    it('accepts tb/bt/lr/rl as identifiers, references and names', async () => {
        const doc = await build(`
workspace {
    model {
        lr = person "LR"
        rl = softwareSystem "RL" {
            tb = container "TB" "Tech" {
                bt = component "BT" "Tech"
            }
        }
        lr -> rl "Uses"
        rl -> tb "Uses"
        tb -> bt "Uses"
        p = person lr
    }
    views {
        systemContext rl {
            include *
        }
    }
}
`);

        expect(messages(doc, ERROR_SEVERITY)).toHaveLength(0);
    });
});

describe('terminology metadata symbols', () => {
    it('rejects an invalid metadata symbol', async () => {
        const doc = await build(`
workspace {
    views {
        terminology {
            metadata sideways
        }
    }
}
`);

        expect(messages(doc, ERROR_SEVERITY)).toContain('Expected: metadata <square|round|curly|angle|double-angle|none>');
    });

    it('accepts every valid metadata symbol', async () => {
        for (const symbol of ['square', 'round', 'curly', 'angle', 'double-angle', 'none']) {
            const doc = await build(`
workspace {
    views {
        terminology {
            metadata ${symbol}
        }
    }
}
`);

            expect(messages(doc, ERROR_SEVERITY)).toHaveLength(0);
        }
    });

    it('accepts square/round/curly/angle/double-angle as identifiers, references and names', async () => {
        const doc = await build(`
workspace {
    model {
        square = person "Square"
        round = softwareSystem "Round" {
            curly = container "Curly" "Tech" {
                angle = component "Angle" "Tech"
                double-angle = component "Double Angle" "Tech"
            }
        }
        square -> round "Uses"
        round -> curly "Uses"
        curly -> angle "Uses"
        angle -> double-angle "Uses"
        p = person square
    }
    views {
        container round {
            include *
        }
    }
}
`);

        expect(messages(doc, ERROR_SEVERITY)).toHaveLength(0);
    });
});

describe('!element target validation', () => {
    it('rejects a relationship target, pointing to !relationship', async () => {
        const doc = await build(`
workspace {
    model {
        a = softwareSystem "A" {
            b = container "B"
            c = container "C"
            r1 = b -> c "uses"
            ext1 = !element r1 {
                tags "X"
            }
        }
    }
}
`);

        expect(doc.parseResult.parserErrors).toHaveLength(0);
        expect(messages(doc, ERROR_SEVERITY)).toContain(
            '!element cannot target a relationship. Use the !relationship directive instead.'
        );
    });

    it('rejects a group target', async () => {
        const doc = await build(`
workspace {
    model {
        a = softwareSystem "A" {
            g1 = group "G" {
                b = container "B"
            }
            ext1 = !element g1 {
                tags "X"
            }
        }
    }
}
`);

        expect(doc.parseResult.parserErrors).toHaveLength(0);
        expect(messages(doc, ERROR_SEVERITY)).toContain(
            '!element cannot target a group.'
        );
    });

    it('rejects a deployment group target', async () => {
        const doc = await build(`
workspace {
    model {
        a = softwareSystem "A" {
            b = container "B"
        }
        prod = deploymentEnvironment "Prod" {
            g1 = deploymentGroup "Group"
        }
        ext1 = !element g1 {
            tags "X"
        }
    }
}
`);

        expect(doc.parseResult.parserErrors).toHaveLength(0);
        expect(messages(doc, ERROR_SEVERITY)).toContain(
            '!element cannot target a deployment group.'
        );
    });

    it('accepts an element target', async () => {
        const doc = await build(`
workspace {
    model {
        a = softwareSystem "A" {
            b = container "B"
            ext1 = !element b {
                tags "X"
            }
        }
    }
}
`);

        expect(doc.parseResult.parserErrors).toHaveLength(0);
        expect(messages(doc, ERROR_SEVERITY)).toHaveLength(0);
    });

    // Form 2 (`!element <id>`, no `<x> =` prefix): the identifier is resolved
    // against the document's declared ids, matching the vendor's "could not be
    // found" behaviour for non-element targets.

    it('form 2: rejects a relationship target as not found', async () => {
        const doc = await build(`
workspace {
    model {
        a = softwareSystem "A" {
            b = container "B"
            c = container "C"
            r1 = b -> c "uses"
            !element r1 {
                tags "X"
            }
        }
    }
}
`);

        expect(doc.parseResult.parserErrors).toHaveLength(0);
        expect(messages(doc, ERROR_SEVERITY)).toContain(
            '!element target "r1" could not be found.'
        );
    });

    it('form 2: rejects a group target', async () => {
        const doc = await build(`
workspace {
    model {
        a = softwareSystem "A" {
            g1 = group "G" {
                b = container "B"
            }
            !element g1 {
                tags "X"
            }
        }
    }
}
`);

        expect(doc.parseResult.parserErrors).toHaveLength(0);
        expect(messages(doc, ERROR_SEVERITY)).toContain(
            '!element cannot target a group.'
        );
    });

    it('form 2: rejects a deployment group target', async () => {
        const doc = await build(`
workspace {
    model {
        a = softwareSystem "A" {
            b = container "B"
        }
        prod = deploymentEnvironment "Prod" {
            g1 = deploymentGroup "Group"
        }
        !element g1 {
            tags "X"
        }
    }
}
`);

        expect(doc.parseResult.parserErrors).toHaveLength(0);
        expect(messages(doc, ERROR_SEVERITY)).toContain(
            '!element cannot target a deployment group.'
        );
    });

    it('form 2: rejects an unknown target', async () => {
        const doc = await build(`
workspace {
    model {
        a = softwareSystem "A" {
            b = container "B"
            !element zzz {
                tags "X"
            }
        }
    }
}
`);

        expect(doc.parseResult.parserErrors).toHaveLength(0);
        expect(messages(doc, ERROR_SEVERITY)).toContain(
            '!element target "zzz" could not be found.'
        );
    });

    it('form 2: accepts an element target', async () => {
        const doc = await build(`
workspace {
    model {
        a = softwareSystem "A" {
            b = container "B"
            !element b {
                tags "X"
            }
        }
    }
}
`);

        expect(doc.parseResult.parserErrors).toHaveLength(0);
        expect(messages(doc, ERROR_SEVERITY)).toHaveLength(0);
    });

    it('form 2: accepts an instanceof (generic instance) target', async () => {
        const doc = await build(`
workspace {
    model {
        a = softwareSystem "A"
        prod = deploymentEnvironment "Prod" {
            node1 = deploymentNode "Node 1" {
                gi = instanceof a
                !element gi {
                    tags "X"
                }
            }
        }
    }
}
`);

        expect(doc.parseResult.parserErrors).toHaveLength(0);
        expect(messages(doc, ERROR_SEVERITY)).toHaveLength(0);
    });

    it('form 1: a dangling reference is not misreported with the assignment id', async () => {
        const doc = await build(`
workspace {
    model {
        a = softwareSystem "A" {
            b = container "B"
            ext1 = !element zzz {
                tags "X"
            }
        }
    }
}
`);

        expect(doc.parseResult.parserErrors).toHaveLength(0);
        // A dangling form-1 reference must not be reported as a form-2 lookup of the
        // left-hand assignment id; Langium reports the unresolved reference itself.
        expect(messages(doc, ERROR_SEVERITY)).not.toContain(
            '!element target "ext1" could not be found.'
        );
    });
});
