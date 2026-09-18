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
import { isDeploymentView, isRelationship } from '../generated/ast';

const PROJECT = URI.parse('file:///name-resolution/');

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

/** Returns the resolved target of the first relationship endpoint with the given ref text. */
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

describe('element references resolve by identifier only', () => {
    it('does not resolve a relationship endpoint by the element name', async () => {
        const docs = await buildProject({
            'main.dsl': `workspace {
    model {
        sys = softwareSystem "sysName"
        other = softwareSystem "Other"
        sys -> "sysName" "by name"
        sys -> other "by id"
    }
}
`,
        });
        const main = docs.get('main.dsl')!;

        expect(main.parseResult.parserErrors).toHaveLength(0);
        // The quoted element name is not an identifier, so the reference stays unresolved.
        expect(resolveEndpoint(main, '"sysName"')).toBeUndefined();
        // The identifier still resolves.
        expect(resolveEndpoint(main, 'other')?.$type).toBe('SoftwareSystem');
    });
});

describe('deployment environment references resolve by identifier or name', () => {
    it('resolves an environment referenced by its name', async () => {
        const docs = await buildProject({
            'main.dsl': `workspace {
    model {
        sys = softwareSystem "Sys"
        deploymentEnvironment "Live" {
            deploymentNode "Node"
        }
    }
    views {
        deployment sys "Live" {
            include *
        }
    }
}
`,
        });
        const main = docs.get('main.dsl')!;

        expect(main.parseResult.parserErrors).toHaveLength(0);
        const view = AstUtils.streamAllContents(main.parseResult.value).filter(isDeploymentView).head()!;
        expect((view as any).environment.ref?.$type).toBe('DeploymentEnvironment');
    });

    it('resolves an environment referenced by its identifier', async () => {
        const docs = await buildProject({
            'main.dsl': `workspace {
    model {
        sys = softwareSystem "Sys"
        live = deploymentEnvironment "Live" {
            deploymentNode "Node"
        }
    }
    views {
        deployment sys live {
            include *
        }
    }
}
`,
        });
        const main = docs.get('main.dsl')!;

        expect(main.parseResult.parserErrors).toHaveLength(0);
        const view = AstUtils.streamAllContents(main.parseResult.value).filter(isDeploymentView).head()!;
        expect((view as any).environment.ref?.$type).toBe('DeploymentEnvironment');
    });
});
