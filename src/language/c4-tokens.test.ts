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
import { isTypeAllowedInBlock } from './c4-tokens';

const ERROR_SEVERITY = 1;
const PROJECT = URI.parse('file:///tokens-project/');

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

/** Errors raised by checkIncludeElements, which reports through formatIncludeError. */
function includeErrors(doc: LangiumDocument): string[] {
    return messages(doc, ERROR_SEVERITY).filter(m => m.includes('Unexpected tokens'));
}

describe('allowed tokens per block', () => {
    it('allows archetype instances in a model block', () => {
        expect(isTypeAllowedInBlock('ArchetypeInstance', 'ModelBlock')).toBe(true);
    });

    it('allows nested archetype instances', () => {
        expect(isTypeAllowedInBlock('ArchetypeInstance', 'ArchetypeInstance')).toBe(true);
    });

    it('allows the identifiers directive in a model block', () => {
        expect(isTypeAllowedInBlock('IdentifiersProperty', 'ModelBlock')).toBe(true);
    });

    it('allows instanceof in groups, element extensions and deployment nodes', () => {
        expect(isTypeAllowedInBlock('GenericInstance', 'Group')).toBe(true);
        expect(isTypeAllowedInBlock('GenericInstance', 'ElementExtension')).toBe(true);
        expect(isTypeAllowedInBlock('GenericInstance', 'DeploymentNode')).toBe(true);
    });

    it('allows remove-relationship only in a deployment environment', () => {
        expect(isTypeAllowedInBlock('NoRelationship', 'DeploymentEnvironment')).toBe(true);
        expect(isTypeAllowedInBlock('NoRelationship', 'DeploymentNode')).toBe(false);
    });

    it('allows implied-relationship directives in every block that accepts them', () => {
        for (const block of ['ModelBlock', 'Group', 'DeploymentEnvironment', 'DeploymentNode',
            'InfrastructureNode', 'ContainerInstance', 'SoftwareSystemInstance', 'GenericInstance']) {
            expect(isTypeAllowedInBlock('ImpliedRelationshipsProperty', block)).toBe(true);
        }
    });

    it('rejects views inside a model block', () => {
        expect(isTypeAllowedInBlock('CustomView', 'ModelBlock')).toBe(false);
    });
});

describe('!include content checked against the parent block', () => {
    it('accepts an archetype instance in an included model block', async () => {
        const docs = await buildProject({
            'main.dsl': `workspace {
    model {
        !include "frag.dsl"
    }
}
`,
            'frag.dsl': `archetypes {
    dev = person
}
dev "Alice"
`,
        });
        const main = docs.get('main.dsl')!;

        expect(main.parseResult.parserErrors).toHaveLength(0);
        expect(includeErrors(main)).toHaveLength(0);
    });

    it('accepts the identifiers directive in an included model block', async () => {
        const docs = await buildProject({
            'main.dsl': `workspace {
    model {
        !include "frag.dsl"
    }
}
`,
            'frag.dsl': `!identifiers flat
person "Someone"
`,
        });
        const main = docs.get('main.dsl')!;

        expect(includeErrors(main)).toHaveLength(0);
    });

    it('still rejects a view inside an included model block', async () => {
        const docs = await buildProject({
            'main.dsl': `workspace {
    model {
        !include "frag.dsl"
    }
}
`,
            'frag.dsl': `views {
    systemLandscape "land" {
        include *
    }
}
`,
        });
        const main = docs.get('main.dsl')!;

        expect(includeErrors(main).length).toBeGreaterThan(0);
    });
});

describe('directive placement', () => {
    it('accepts documentation directives on documentable elements', async () => {
        const docs = await buildProject({
            'docs.dsl': `workspace {
    !docs "docs/workspace"
    model {
        sys = softwareSystem "Sys" {
            !docs "docs/system" {
                exclude "README.md"
            }
            c = container "C" {
                !decisions "docs/decisions"
            }
        }
    }
}
`,
        });

        expect(docs.get('docs.dsl')!.parseResult.parserErrors).toHaveLength(0);
    });

    it('rejects documentation directives on a person', async () => {
        const docs = await buildProject({
            'person.dsl': `workspace {
    model {
        person "User" {
            !docs "docs/user"
        }
    }
}
`,
        });

        expect(docs.get('person.dsl')!.parseResult.parserErrors.length).toBeGreaterThan(0);
    });

    it('rejects documentation directives inside a model block', async () => {
        const docs = await buildProject({
            'model.dsl': `workspace {
    model {
        !docs "docs"
    }
}
`,
        });

        expect(docs.get('model.dsl')!.parseResult.parserErrors.length).toBeGreaterThan(0);
    });

    it('accepts element and relationship directives on elements', async () => {
        const docs = await buildProject({
            'elements.dsl': `workspace {
    model {
        person "User" {
            !elements "element.tag==abc" {
                tags "abc"
            }
        }
    }
}
`,
        });

        expect(docs.get('elements.dsl')!.parseResult.parserErrors).toHaveLength(0);
    });

    it('accepts the identifiers directive inside a group', async () => {
        const docs = await buildProject({
            'group.dsl': `workspace {
    model {
        group "Outer" {
            !identifiers flat
            person "User"
        }
    }
}
`,
        });

        expect(docs.get('group.dsl')!.parseResult.parserErrors).toHaveLength(0);
    });

    it('accepts context-free directives in an element extension', async () => {
        const docs = await buildProject({
            'extension.dsl': `workspace {
    model {
        sys = softwareSystem "Sys" {
            !element sys {
                !impliedRelationships false
                !const "X" "1"
                !script "print('hi')"
            }
        }
    }
}
`,
        });

        expect(docs.get('extension.dsl')!.parseResult.parserErrors).toHaveLength(0);
    });

    it('accepts context-free directives in an archetype instance', async () => {
        const docs = await buildProject({
            'instance.dsl': `workspace {
    model {
        archetypes {
            dev = person
        }
        dev "Alice" {
            !impliedRelationships false
            !const "X" "1"
        }
    }
}
`,
        });

        expect(docs.get('instance.dsl')!.parseResult.parserErrors).toHaveLength(0);
    });
});

describe('style and terminology properties', () => {
    it('accepts unquoted perspective values that are keywords', async () => {
        const docs = await buildProject({
            'perspectives.dsl': `workspace {
    model {
        person "User" {
            perspectives {
                name value
            }
        }
    }
}
`,
        });

        expect(docs.get('perspectives.dsl')!.parseResult.parserErrors).toHaveLength(0);
    });

    it('accepts border and icon position in an element style', async () => {
        const docs = await buildProject({
            'element-style.dsl': `workspace {
    views {
        styles {
            element "Element" {
                border solid
                iconPosition left
            }
        }
    }
}
`,
        });

        expect(docs.get('element-style.dsl')!.parseResult.parserErrors).toHaveLength(0);
    });

    it('accepts metadata and description in a relationship style', async () => {
        const docs = await buildProject({
            'relationship-style.dsl': `workspace {
    views {
        styles {
            relationship "Relationship" {
                metadata false
                description false
            }
        }
    }
}
`,
        });

        expect(docs.get('relationship-style.dsl')!.parseResult.parserErrors).toHaveLength(0);
    });

    it('accepts quoted terminology values', async () => {
        const docs = await buildProject({
            'terminology.dsl': `workspace {
    views {
        terminology {
            person "Person"
            softwareSystem "Software System"
            container "Container"
            component "Component"
            deploymentNode "Deployment Node"
            infrastructureNode "Infrastructure Node"
            relationship "Relationship"
            metadata angle
        }
    }
}
`,
        });

        expect(docs.get('terminology.dsl')!.parseResult.parserErrors).toHaveLength(0);
    });
});

describe('removed directives', () => {
    it('rejects !constant', async () => {
        const docs = await buildProject({
            'constant.dsl': `workspace {
    !constant NAME VALUE
}
`,
        });
        const errors = docs.get('constant.dsl')!.parseResult.parserErrors;

        expect(errors.length).toBeGreaterThan(0);
        expect(errors[0].message).toContain('Unexpected tokens');
        expect(errors[0].message).toContain('!const');
    });

    it('accepts !const and !var', async () => {
        const docs = await buildProject({
            'constants.dsl': `!const NAME "value"
!var OTHER "value"

workspace {
}
`,
        });

        expect(docs.get('constants.dsl')!.parseResult.parserErrors).toHaveLength(0);
    });
});

describe('remove-relationship placement', () => {
    it('parses inside a deployment environment', async () => {
        const docs = await buildProject({
            'env.dsl': `workspace {
    model {
        sys = softwareSystem "Sys" {
            c = container "C"
        }
        env = deploymentEnvironment "Live" {
            sys.c -/> sys.c {
                sys.c -> sys.c "self"
            }
        }
    }
}
`,
        });

        expect(docs.get('env.dsl')!.parseResult.parserErrors).toHaveLength(0);
    });

    it('nests inside its own body', async () => {
        const docs = await buildProject({
            'nested.dsl': `workspace {
    model {
        sys = softwareSystem "Sys" {
            c = container "C"
        }
        env = deploymentEnvironment "Live" {
            sys.c -/> sys.c {
                sys.c -/> sys.c {
                    sys.c -> sys.c "self"
                }
            }
        }
    }
}
`,
        });

        expect(docs.get('nested.dsl')!.parseResult.parserErrors).toHaveLength(0);
    });

    it('requires a body', async () => {        const docs = await buildProject({
            'body.dsl': `workspace {
    model {
        sys = softwareSystem "Sys" {
            c = container "C"
        }
        env = deploymentEnvironment "Live" {
            sys.c -/> sys.c
        }
    }
}
`,
        });

        expect(docs.get('body.dsl')!.parseResult.parserErrors.length).toBeGreaterThan(0);
    });

    it('is rejected inside a deployment node', async () => {
        const docs = await buildProject({
            'node.dsl': `workspace {
    model {
        sys = softwareSystem "Sys" {
            c = container "C"
        }
        env = deploymentEnvironment "Live" {
            node = deploymentNode "Node" {
                sys.c -/> sys.c {
                    sys.c -> sys.c "self"
                }
            }
        }
    }
}
`,
        });

        expect(docs.get('node.dsl')!.parseResult.parserErrors.length).toBeGreaterThan(0);
    });
});
