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
import { isWorkspace } from '../generated/ast';

function services() {
    return createC4Services({ connection: undefined as any, ...EmptyFileSystem }).C4;
}

async function build(dsl: string) {
    const c4 = services();
    const doc = c4.shared.workspace.LangiumDocumentFactory.fromString(dsl, URI.parse('file:///relationship-directives.dsl'));
    c4.shared.workspace.LangiumDocuments.addDocument(doc);
    await c4.shared.workspace.DocumentBuilder.build([doc]);
    return { c4, doc };
}

async function generate(dsl: string): Promise<any> {
    const { c4, doc } = await build(dsl);
    const root = doc.parseResult.value;
    if (isWorkspace(root)) {
        return new C4JsonGenerator(c4).generate(root);
    }
    const anyRoot = root as any;
    if (anyRoot.$type === 'C4Document' && anyRoot.workspaces?.length > 0) {
        return new C4JsonGenerator(c4).generate(anyRoot.workspaces[0]);
    }
    throw new Error('No workspace found');
}

describe('!relationship directive', () => {
    it('applies tags, url, properties and perspectives to the targeted relationship', async () => {
        const json = await generate(`workspace {
    model {
        a = softwareSystem "A"
        b = softwareSystem "B"
        rel = a -> b "Uses"

        !relationship rel {
            tags "FromRelationship"
            url "https://example.com/rel"
            properties {
                "k" "v"
            }
            perspectives {
                "Owner" "Team"
            }
        }
    }
}
`);
        const systemA = json.model.softwareSystems.find((s: any) => s.name === 'A');
        const relationship = systemA.relationships[0];
        expect(relationship.tags).toContain('FromRelationship');
        expect(relationship.url).toBe('https://example.com/rel');
        expect(relationship.properties).toEqual({ k: 'v' });
        expect(relationship.perspectives).toBeDefined();
    });

    it('works inside a container body', async () => {
        const json = await generate(`workspace {
    model {
        sys = softwareSystem "Sys" {
            c1 = container "C1"
            c2 = container "C2"
            rel = c1 -> c2 "Uses"

            !relationship rel {
                tags "FromContainer"
            }
        }
    }
}
`);
        const system = json.model.softwareSystems.find((s: any) => s.name === 'Sys');
        expect(system.containers[0].relationships[0].tags).toContain('FromContainer');
    });
});

describe('!relationship directive in element contexts', () => {
    it('works inside a component body', async () => {
        const json = await generate(`workspace {
    model {
        sys = softwareSystem "Sys" {
            c = container "C" {
                comp1 = component "Comp1"
                comp2 = component "Comp2"
                rel = comp1 -> comp2 "Uses"

                !relationship rel {
                    tags "FromComponent"
                }
            }
        }
    }
}
`);
        const system = json.model.softwareSystems.find((s: any) => s.name === 'Sys');
        const component = system.containers[0].components[0];
        expect(component.relationships[0].tags).toContain('FromComponent');
    });

    it('works inside a deployment node body', async () => {
        const json = await generate(`workspace {
    model {
        deploymentEnvironment "Live" {
            dn = deploymentNode "DN" {
                i1 = infrastructureNode "I1"
                i2 = infrastructureNode "I2"
                rel = i1 -> i2 "Uses"

                !relationship rel {
                    tags "FromDeploymentNode"
                }
            }
        }
    }
}
`);
        const node = json.model.deploymentNodes[0];
        expect(node.infrastructureNodes[0].relationships[0].tags).toContain('FromDeploymentNode');
    });
});

describe('!relationships directive', () => {
    it('applies technology and perspectives to the matched relationships', async () => {
        const json = await generate(`workspace {
    model {
        a = softwareSystem "A"
        b = softwareSystem "B"
        a -> b "Uses"

        !relationships "*->*" {
            technology "Bulk technology"
            perspectives {
                "Owner" "Team"
            }
        }
    }
}
`);
        const systemA = json.model.softwareSystems.find((s: any) => s.name === 'A');
        const relationship = systemA.relationships[0];
        expect(relationship.technology).toBe('Bulk technology');
        expect(relationship.perspectives).toBeDefined();
    });
});

describe('relationship directive grammar', () => {
    it('rejects description, technology and !include inside !relationship', async () => {
        for (const body of ['description "x"', 'technology "x"', '!include "frag.dsl"']) {
            const { doc } = await build(`workspace {
    model {
        a = softwareSystem "A"
        b = softwareSystem "B"
        rel = a -> b "Uses"
        !relationship rel {
            ${body}
        }
    }
}
`);
            expect(doc.parseResult.parserErrors.length).toBeGreaterThan(0);
        }
    });

    it('rejects !include inside !relationships', async () => {
        const { doc } = await build(`workspace {
    model {
        a = softwareSystem "A"
        b = softwareSystem "B"
        a -> b "Uses"
        !relationships "*->*" {
            !include "frag.dsl"
        }
    }
}
`);
        expect(doc.parseResult.parserErrors.length).toBeGreaterThan(0);
    });
});
