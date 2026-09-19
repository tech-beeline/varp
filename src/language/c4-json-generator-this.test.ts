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
    const doc = services.shared.workspace.LangiumDocumentFactory.fromString(dsl, URI.parse('file:///this.dsl'));
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

function collect(node: any, predicate: (node: any) => boolean, result: any[] = []): any[] {
    if (!node || typeof node !== 'object') return result;
    if (Array.isArray(node)) {
        node.forEach(item => collect(item, predicate, result));
        return result;
    }
    if (predicate(node)) result.push(node);
    Object.values(node).forEach(value => collect(value, predicate, result));
    return result;
}

function relationships(json: any): any[] {
    return collect(json.model, node => typeof node.sourceId === 'string');
}

describe('this keyword', () => {
    it('resolves this to the enclosing container', async () => {
        const json = await generate(`workspace {
    model {
        ss = softwareSystem "SS" {
            c = container "C" {
                this -> ss "Uses"
            }
        }
    }
}
`);
        const container = json.model.softwareSystems[0].containers[0];
        const softwareSystem = json.model.softwareSystems[0];
        const rel = relationships(json).find(r => r.description === 'Uses');
        expect(rel?.sourceId).toBe(container.id);
        expect(rel?.destinationId).toBe(softwareSystem.id);
    });

    it('resolves this to the enclosing person', async () => {
        const json = await generate(`workspace {
    model {
        u = person "User" {
            this -> ss "Uses"
        }
        ss = softwareSystem "SS"
    }
}
`);
        const person = json.model.people[0];
        const softwareSystem = json.model.softwareSystems[0];
        const rel = relationships(json).find(r => r.description === 'Uses');
        expect(rel?.sourceId).toBe(person.id);
        expect(rel?.destinationId).toBe(softwareSystem.id);
    });

    it('resolves this as a target to the enclosing container', async () => {
        const json = await generate(`workspace {
    model {
        ss = softwareSystem "SS" {
            c = container "C" {
                ss -> this "Targets self"
            }
        }
    }
}
`);
        const container = json.model.softwareSystems[0].containers[0];
        const softwareSystem = json.model.softwareSystems[0];
        const rel = relationships(json).find(r => r.description === 'Targets self');
        expect(rel?.sourceId).toBe(softwareSystem.id);
        expect(rel?.destinationId).toBe(container.id);
    });

    it('does not treat an unresolved reference as this', async () => {
        const json = await generate(`workspace {
    model {
        ss = softwareSystem "SS" {
            c = container "C" {
                typo -> ss "X"
            }
        }
    }
}
`);
        expect(relationships(json).some(r => r.description === 'X')).toBe(false);
    });
});
