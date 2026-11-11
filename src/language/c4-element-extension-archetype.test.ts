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
import { URI } from 'vscode-uri';
import { createC4Services } from './c4-module';
import { isArchetypeInstance, isElementExtension } from '../generated/ast';

/** Builds a standalone C4 document and runs the DocumentBuilder pipeline. */
async function buildDocument(content: string): Promise<LangiumDocument> {
    const services = createC4Services({ connection: undefined as any, ...EmptyFileSystem }).C4;
    const doc = services.shared.workspace.LangiumDocumentFactory.fromString(
        content,
        URI.parse('file:///element-extension-archetype.dsl')
    );
    services.shared.workspace.LangiumDocuments.addDocument(doc);
    await services.shared.workspace.DocumentBuilder.build([doc], { validation: true });
    return doc;
}

function diagnostics(doc: LangiumDocument): string[] {
    return (doc.diagnostics ?? []).map(d => (typeof d.message === 'string' ? d.message : d.message.value));
}

describe('element extension bodies', () => {
    it('reports an unknown word in !element as an unexpected token', async () => {
        const doc = await buildDocument(`
workspace {
    model {
        sys = softwareSystem "System"
        !element sys {
            1
        }
    }
}
`);

        const errors = diagnostics(doc);
        expect(errors).toHaveLength(1);
        expect(errors[0]).toContain("Unexpected token '1' (expected: ");
        expect(errors[0]).toContain('tags');
        expect(errors[0]).toContain('archetype instance');
        expect(errors[0]).toContain("No archetype named '1' is defined.");
    });

    it('lists the keywords of the enclosing block for an unknown archetype name', async () => {
        const doc = await buildDocument(`
workspace {
    model {
        sys = softwareSystem "System"
        zz
    }
}
`);

        const errors = diagnostics(doc);
        expect(errors).toHaveLength(1);
        expect(errors[0]).toContain("Unexpected token 'zz' (expected: ");
        expect(errors[0]).toContain('softwaresystem');
        expect(errors[0]).toContain('archetype instance');
    });

    it('accepts an archetype instance with a name inside !element', async () => {
        const doc = await buildDocument(`
workspace {
    model {
        archetypes {
            database = container
        }
        sys = softwareSystem "System"
        !element sys {
            catalogue = database "Catalogue" {
                description "Reference data"
            }
        }
    }
}
`);

        expect(doc.parseResult.parserErrors).toHaveLength(0);
        expect(diagnostics(doc)).toEqual([]);
        const instances = AstUtils.streamAllContents(doc.parseResult.value)
            .filter(isArchetypeInstance)
            .toArray();
        expect(instances.map(instance => instance.name)).toEqual(['"Catalogue"']);
    });

    it('accepts a body-less !element inside a group', async () => {
        const doc = await buildDocument(`
workspace {
    model {
        a = softwareSystem "A"
        b = softwareSystem "B"
        group "Shared" {
            !element a
            !element b
        }
    }
}
`);

        expect(doc.parseResult.parserErrors).toHaveLength(0);
        expect(diagnostics(doc)).toEqual([]);
        const extensions = AstUtils.streamAllContents(doc.parseResult.value)
            .filter(isElementExtension)
            .toArray();
        expect(extensions.map(extension => extension.id)).toEqual(['a', 'b']);
    });

    it('keeps the body of a bare !element extension', async () => {
        const doc = await buildDocument(`
workspace {
    model {
        sys = softwareSystem "System"
        !element sys {
            description "Overlay"
        }
    }
}
`);

        expect(doc.parseResult.parserErrors).toHaveLength(0);
        expect(diagnostics(doc)).toEqual([]);
        const extension: any = AstUtils.streamAllContents(doc.parseResult.value)
            .filter(isElementExtension)
            .head();
        expect(extension.descriptionProps?.[0]?.value).toBe('"Overlay"');
    });

    it('emits an archetype instance declared in !element as a model element', async () => {
        const services = createC4Services({ connection: undefined as any, ...EmptyFileSystem }).C4;
        const uri = URI.parse('file:///element-extension-archetype-json.dsl');
        const doc = services.shared.workspace.LangiumDocumentFactory.fromString(`
workspace {
    model {
        archetypes {
            database = container
        }
        sys = softwareSystem "System"
        !element sys {
            catalogue = database "Catalogue" {
                description "Reference data"
            }
        }
    }
}
`, uri);
        services.shared.workspace.LangiumDocuments.addDocument(doc);
        await services.shared.workspace.DocumentBuilder.build([doc], { validation: true });

        const entry = await services.generation.C4GeneratorHandler.ensureContentForUri(uri.toString());
        expect(entry).not.toBeNull();
        const system = entry!.json.model.softwareSystems.find((candidate: any) => candidate.name === 'System');
        expect(system.containers.map((container: any) => container.name)).toEqual(['Catalogue']);
    });

    it('places every archetype base type declared in !element', async () => {
        const services = createC4Services({ connection: undefined as any, ...EmptyFileSystem }).C4;
        const uri = URI.parse('file:///element-extension-archetype-types.dsl');
        const doc = services.shared.workspace.LangiumDocumentFactory.fromString(`
workspace {
    model {
        archetypes {
            database = container
            appComponent = component
            externalSystem = softwaresystem
            hardware = element
            staff = person
            host = deploymentNode
            agent = infrastructureNode
            domain = group
        }
        target = softwareSystem "Target" {
            cont = container "Container"
        }
        !element target {
            store = database "Store"
            backend = externalSystem "Backend"
            employee = staff "Employee"
            device = hardware "Device"
            domainGroup = domain "Domain" {
                cache = database "Cache"
            }
        }
        !element cont {
            service = appComponent "Service"
        }
        env = deploymentEnvironment "Env" {
            node = deploymentNode "Node" {
                infra = infrastructureNode "Infra"
                ci = containerInstance cont
                ssi = softwareSystemInstance target
            }
        }
        !element env {
            host2 = host "Host" {
                agent2 = agent "Agent"
            }
        }
    }
}
`, uri);
        services.shared.workspace.LangiumDocuments.addDocument(doc);
        await services.shared.workspace.DocumentBuilder.build([doc], { validation: true });
        expect(doc.parseResult.parserErrors).toHaveLength(0);
        expect(diagnostics(doc)).toEqual([]);

        const entry = await services.generation.C4GeneratorHandler.ensureContentForUri(uri.toString());
        const model = entry!.json.model;
        const byName = (list: any[], name: string) => list.find(item => item.name === name);

        const target = byName(model.softwareSystems, 'Target');
        expect(target.containers.map((container: any) => container.name)).toEqual(['Container', 'Store', 'Cache']);
        expect(byName(target.containers, 'Cache').group).toBe('Domain');
        expect(target.containers.find((container: any) => container.name === 'Container').components
            .map((component: any) => component.name)).toEqual(['Service']);

        // Types that cannot be nested in the C4 schema land at the model top level.
        expect(model.softwareSystems.map((system: any) => system.name)).toContain('Backend');
        expect(model.people.map((person: any) => person.name)).toContain('Employee');
        expect(model.customElements.map((element: any) => element.name)).toContain('Device');

        const envNode = byName(model.deploymentNodes, 'Node');
        expect(envNode.infrastructureNodes.map((node: any) => node.name)).toEqual(['Infra']);
        expect(envNode.containerInstances.map((instance: any) => instance.containerId)).toHaveLength(1);
        expect(envNode.softwareSystemInstances.map((instance: any) => instance.softwareSystemId)).toHaveLength(1);

        const hostNode = byName(model.deploymentNodes, 'Host');
        expect(hostNode.infrastructureNodes.map((node: any) => node.name)).toEqual(['Agent']);
    });
});
