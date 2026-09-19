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
import { AstUtils, EmptyFileSystem } from 'langium';
import { URI } from 'vscode-uri';
import { createC4Services } from './c4-module';
import { C4JsonGenerator } from './c4-json-generator';
import { isRelationship, isWorkspace } from '../generated/ast';

async function build(dsl: string) {
    const services = createC4Services({ connection: undefined as any, ...EmptyFileSystem }).C4;
    const doc = services.shared.workspace.LangiumDocumentFactory.fromString(dsl, URI.parse('file:///archetypes.dsl'));
    services.shared.workspace.LangiumDocuments.addDocument(doc);
    await services.shared.workspace.DocumentBuilder.build([doc]);
    const root = doc.parseResult.value;
    const workspace = isWorkspace(root) ? root : (root as any).workspaces?.[0];
    if (!workspace) throw new Error('No workspace found');
    return { services, workspace, json: await new C4JsonGenerator(services).generate(workspace) };
}

const dsl = `workspace {
    model {
        archetypes {
            https = -> {
                technology "HTTPS"
                description "Secure"
                tag "SecureTag"
            }
        }
        a = softwareSystem "A"
        b = softwareSystem "B"
        a --https-> b
    }
}
`;

describe('relationship archetypes', () => {
    it('keeps the archetype reference on the explicit relationship', async () => {
        const { workspace } = await build(dsl);
        const relationship: any = AstUtils.streamAllContents(workspace).filter(isRelationship).head()!;
        expect(relationship.$type).toBe('RelationshipArrow');
        expect(relationship.archetype?.ref).toBeDefined();
    });

    it('applies archetype description, technology and tags to the relationship', async () => {
        const { json } = await build(dsl);
        const systemA = json.model.softwareSystems.find((s: any) => s.name === 'A');
        const relationship = systemA.relationships[0];
        expect(relationship.description).toBe('Secure');
        expect(relationship.technology).toBe('HTTPS');
        expect(relationship.tags).toContain('SecureTag');
    });

    it('applies archetype defaults to an implicit relationship', async () => {
        const { json } = await build(`workspace {
    model {
        archetypes {
            https = -> {
                technology "HTTPS"
            }
        }
        a = softwareSystem "A" {
            comp = container "Comp" {
                --https-> b
            }
        }
        b = softwareSystem "B"
    }
}
`);
        const systemA = json.model.softwareSystems.find((s: any) => s.name === 'A');
        const systemB = json.model.softwareSystems.find((s: any) => s.name === 'B');
        const relationship = systemA.containers[0].relationships[0];
        expect(relationship.technology).toBe('HTTPS');

        // The implied SoftwareSystem -> SoftwareSystem relationship inherits the technology too.
        const implied = systemA.relationships.find((r: any) => r.destinationId === systemB.id);
        expect(implied.technology).toBe('HTTPS');
    });
});
