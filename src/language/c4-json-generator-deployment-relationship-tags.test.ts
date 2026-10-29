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

/**
 * A relationship declared inside a deployment node with an implicit source and a
 * body `tags` property. The body tags must survive the instance projection, so a
 * `relationship.tag` filter sees them.
 */
function dsl(excludeFilter: string): string {
    return `workspace {
    !identifiers hierarchical
    model {
        sys = softwareSystem "S" {
            c1 = container "C1"
            c2 = container "C2"
        }
        env = deploymentEnvironment "E" {
            n1 = deploymentNode "N1" {
                i1 = containerInstance sys.c1
                -> env.n2 "uses" "TLS" {
                    tags internal
                }
            }
            n2 = deploymentNode "N2" {
                i2 = containerInstance sys.c2
            }
        }
    }
    views {
        deployment sys "E" {
            include *
            exclude ${excludeFilter}
        }
    }
}
`;
}

async function generate(excludeFilter: string) {
    const services = createC4Services({ connection: undefined as any, ...EmptyFileSystem }).C4;
    const doc = services.shared.workspace.LangiumDocumentFactory.fromString(dsl(excludeFilter), URI.parse('file:///deployment-relationship-tags.dsl'));
    services.shared.workspace.LangiumDocuments.addDocument(doc);
    await services.shared.workspace.DocumentBuilder.build([doc]);
    const root = doc.parseResult.value;
    const workspace = isWorkspace(root) ? root : (root as any).workspaces?.[0];
    return new C4JsonGenerator(services).generate(workspace);
}

describe('deployment relationship body tags', () => {
    it('keeps the body tag on the projected relationship', async () => {
        const json: any = await generate('"relationship.tag!=internal"');
        const n1 = json.model.deploymentNodes.find((n: any) => n.name === 'N1');
        expect(n1.relationships[0].tags).toContain('internal');
    });

    it('keeps the tagged relationship when filtering out other tags', async () => {
        const json: any = await generate('"relationship.tag!=internal"');
        expect(json.views.deploymentViews[0].relationships).toHaveLength(1);
    });

    it('removes the tagged relationship when filtering for that tag', async () => {
        const json: any = await generate('"relationship.tag==internal"');
        expect(json.views.deploymentViews[0].relationships ?? []).toHaveLength(0);
    });
});
