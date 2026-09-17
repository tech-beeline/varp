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
        URI.parse('file:///archetype-views.dsl')
    );
    services.shared.workspace.LangiumDocuments.addDocument(doc);
    await services.shared.workspace.DocumentBuilder.build([doc]);
    expect(doc.parseResult.parserErrors).toHaveLength(0);
    const root: any = doc.parseResult.value;
    const workspace = isWorkspace(root) ? root : root.workspaces[0];
    return new C4JsonGenerator(services).generate(workspace);
}

const elementIds = (view: any): string[] => (view.elements ?? []).map((e: any) => e.id);

describe('views referencing archetype instances', () => {
    it('resolves a systemContext view scoped to an archetype instance', async () => {
        const json = await generate(`
workspace {
    model {
        archetypes {
            externalSystem = softwaresystem
        }
        m = externalSystem "M"
        other = softwareSystem "Other"
        other -> m "Calls"
    }
    views {
        systemContext m {
            include *
        }
    }
}
`);

        const view = json.views.systemContextViews[0];
        const m = json.model.softwareSystems.find((s: any) => s.name === 'M');
        const other = json.model.softwareSystems.find((s: any) => s.name === 'Other');
        expect(view.softwareSystemId).toBe(m.id);
        expect(elementIds(view)).toEqual(expect.arrayContaining([m.id, other.id]));
        // View relationship entries are id references; compare against the model edge.
        const modelEdge = other.relationships.find((r: any) => r.destinationId === m.id);
        expect(view.relationships).toHaveLength(1);
        expect(view.relationships[0].id).toBe(modelEdge.id);
    });

    it('resolves a container view scoped to an archetype instance', async () => {
        const json = await generate(`
workspace {
    model {
        archetypes {
            externalSystem = softwaresystem
        }
        m = externalSystem "M" {
            c = container "C"
        }
    }
    views {
        container m {
            include *
        }
    }
}
`);

        const view = json.views.containerViews[0];
        const m = json.model.softwareSystems.find((s: any) => s.name === 'M');
        const c = m.containers.find((x: any) => x.name === 'C');
        expect(view.softwareSystemId).toBe(m.id);
        expect(elementIds(view)).toContain(c.id);
    });

    it('includes an archetype instance referenced by name in a view expression', async () => {
        const json = await generate(`
workspace {
    model {
        archetypes {
            externalSystem = softwaresystem
        }
        m = externalSystem "M"
        o = externalSystem "O"
    }
    views {
        systemContext m {
            include o
        }
    }
}
`);

        const view = json.views.systemContextViews[0];
        const o = json.model.softwareSystems.find((s: any) => s.name === 'O');
        expect(elementIds(view)).toContain(o.id);
    });

    it('resolves dynamic view steps between archetype instances', async () => {
        const json = await generate(`
workspace {
    model {
        archetypes {
            externalSystem = softwaresystem
        }
        m = externalSystem "M"
        o = externalSystem "O"
        o -> m "Calls"
    }
    views {
        dynamic * "seq" {
            o -> m "Message"
        }
    }
}
`);

        const view = json.views.dynamicViews[0];
        const m = json.model.softwareSystems.find((s: any) => s.name === 'M');
        const o = json.model.softwareSystems.find((s: any) => s.name === 'O');
        expect(elementIds(view)).toEqual(expect.arrayContaining([m.id, o.id]));
        expect(view.relationships).toHaveLength(1);
    });
});
