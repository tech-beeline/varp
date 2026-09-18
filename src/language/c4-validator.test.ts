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
    it('requires a group separator for nested groups', async () => {
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
        expect(messages(doc, ERROR_SEVERITY)).toContain(
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
