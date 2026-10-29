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

/** Parses a DSL string, links it, and runs the JSON generator. */
async function generate(content: string): Promise<any> {
    const services = createC4Services({ connection: undefined as any, ...EmptyFileSystem }).C4;
    const doc = services.shared.workspace.LangiumDocumentFactory.fromString(
        content,
        URI.parse('file:///archetype-nesting.dsl')
    );
    services.shared.workspace.LangiumDocuments.addDocument(doc);
    await services.shared.workspace.DocumentBuilder.build([doc]);
    const root: any = doc.parseResult.value;
    const workspace = isWorkspace(root) ? root : root.workspaces[0];
    return new C4JsonGenerator(services).generate(workspace);
}

describe('nested archetype instances', () => {
    it('emits an instance nested in a softwareSystem as a container of that system', async () => {
        const json = await generate(`
workspace {
    model {
        archetypes {
            externalContainer = container
        }
        sys = softwareSystem "Sys" {
            ext = externalContainer "Ext container"
        }
    }
}
`);

        const sys = json.model.softwareSystems.find((s: any) => s.name === 'Sys');
        expect(sys).toBeDefined();
        expect(sys.containers?.map((c: any) => c.name)).toEqual(['Ext container']);
    });

    it('emits an instance nested in a container as a component of that container', async () => {
        const json = await generate(`
workspace {
    model {
        archetypes {
            externalComponent = component
        }
        sys = softwareSystem "Sys" {
            c = container "C" {
                ec = externalComponent "Ext component"
            }
        }
    }
}
`);

        const sys = json.model.softwareSystems.find((s: any) => s.name === 'Sys');
        const container = sys.containers.find((c: any) => c.name === 'C');
        expect(container).toBeDefined();
        expect(container.components?.map((c: any) => c.name)).toEqual(['Ext component']);
    });

    it('emits an instance nested in an archetype instance as a child of its base type', async () => {
        const json = await generate(`
workspace {
    model {
        archetypes {
            externalSystem = softwaresystem
            externalContainer = container
        }
        b = externalSystem "B" {
            inner = externalContainer "Inner"
        }
    }
}
`);

        const system = json.model.softwareSystems.find((s: any) => s.name === 'B');
        expect(system).toBeDefined();
        expect(system.containers?.map((c: any) => c.name)).toEqual(['Inner']);
    });

    it('keeps a nested instance usable as a relationship endpoint', async () => {
        const json = await generate(`
workspace {
    model {
        archetypes {
            externalContainer = container
        }
        sys = softwareSystem "Sys" {
            ext = externalContainer "Ext container"
        }
        other = softwareSystem "Other"
        other -> ext "Calls"
    }
}
`);

        const other = json.model.softwareSystems.find((s: any) => s.name === 'Other');
        const sys = json.model.softwareSystems.find((s: any) => s.name === 'Sys');
        const ext = sys.containers.find((c: any) => c.name === 'Ext container');
        // Look the edge up by destination; implied edges are also emitted.
        const edge = other.relationships.find((r: any) => r.destinationId === ext.id);
        expect(edge).toBeDefined();
        expect(edge.description).toBe('Calls');
    });
});
