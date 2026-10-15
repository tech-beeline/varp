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

async function generate(dsl: string): Promise<any> {
    const services = createC4Services({ connection: undefined as any, ...EmptyFileSystem }).C4;
    const doc = services.shared.workspace.LangiumDocumentFactory.fromString(dsl, URI.parse('file:///element-properties.dsl'));
    services.shared.workspace.LangiumDocuments.addDocument(doc);
    await services.shared.workspace.DocumentBuilder.build([doc]);
    const root = doc.parseResult.value;
    if (isWorkspace(root)) {
        return new C4JsonGenerator(services).generate(root);
    }
    const anyRoot = root as any;
    if (anyRoot.$type === 'C4Document' && anyRoot.workspaces?.length > 0) {
        return new C4JsonGenerator(services).generate(anyRoot.workspaces[0]);
    }
    throw new Error('No workspace found');
}

const dsl = `workspace {
model {
    user = person "User" {
        properties {
            "role" "admin"
        }
    }
    sys = softwareSystem "Sys" {
        properties {
            "HostName" "host-a"
        }
        web = container "Web" {
            properties {
                "port" "8080"
            }
            comp = component "Comp" {
                properties {
                    "lang" "ts"
                }
            }
        }
    }
    live = deploymentEnvironment "Live" {
        node = deploymentNode "Prod" {
            properties {
                "zone" "z1"
            }
            infra = infrastructureNode "Nginx" {
                properties {
                    "version" "1.2"
                }
            }
        }
    }
}
}
`;

describe('element properties in the render JSON', () => {
    it('emits the properties declared directly on each element type', async () => {
        const json = await generate(dsl);
        expect(json.model.people[0].properties).toEqual({ role: 'admin' });
        expect(json.model.softwareSystems[0].properties).toEqual({ HostName: 'host-a' });
        expect(json.model.softwareSystems[0].containers[0].properties).toEqual({ port: '8080' });
        expect(json.model.softwareSystems[0].containers[0].components[0].properties).toEqual({ lang: 'ts' });
        const node = json.model.deploymentNodes[0];
        expect(node.properties).toEqual({ zone: 'z1' });
        expect(node.infrastructureNodes[0].properties).toEqual({ version: '1.2' });
    });

    it('omits properties when the element declares none', async () => {
        const json = await generate(`workspace {
model {
    sys = softwareSystem "Sys"
}
}
`);
        expect(json.model.softwareSystems[0].properties).toBeUndefined();
    });

    it('lets a !elements overlay win over the element own properties', async () => {
        const json = await generate(`workspace {
model {
    sys = softwareSystem "Sys" {
        properties {
            "a" "own"
            "keep" "own-keep"
        }
        !elements element.type==SoftwareSystem {
            properties {
                "a" "overlay"
            }
        }
    }
}
}
`);
        expect(json.model.softwareSystems[0].properties).toEqual({ a: 'overlay', keep: 'own-keep' });
    });

    it('emits the properties declared on a relationship', async () => {
        const json = await generate(`workspace {
model {
    a = softwareSystem "A"
    b = softwareSystem "B"
    a -> b "Uses" {
        properties {
            "protocol" "HTTP"
        }
    }
}
}
`);
        expect(json.model.softwareSystems[0].relationships[0].properties).toEqual({ protocol: 'HTTP' });
    });
});
