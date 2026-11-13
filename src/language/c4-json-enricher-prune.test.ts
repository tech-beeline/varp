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
import { C4JsonEnricher, type EnrichOptions } from './c4-json-enricher';

const URI_ROOT = 'file:///prune/workspace.dsl';

/** Builds the workspace JSON and enriches it with the given options. */
async function enrich(dsl: string, options?: EnrichOptions): Promise<any> {
    const services = createC4Services({ connection: undefined as any, ...EmptyFileSystem }).C4;
    const uri = URI.parse(URI_ROOT);
    const doc = services.shared.workspace.LangiumDocumentFactory.fromString(dsl, uri);
    services.shared.workspace.LangiumDocuments.addDocument(doc);
    await services.shared.workspace.DocumentBuilder.build([doc], { validation: true });

    const root: any = doc.parseResult.value;
    const json = await services.generation.C4JsonGenerator.generate(root.workspaces?.[0] ?? root, URI_ROOT);
    await new C4JsonEnricher(services.shared).enrich(URI_ROOT, json, options);
    return json;
}

const names = (items: any[] | undefined): string[] => (items ?? []).map(item => item.name);

const prune: EnrichOptions = { pruneUnusedElements: true };

describe('element pruning', () => {
    const connectedAndIsolated = `workspace {
    model {
        a = softwareSystem "Alpha"
        b = softwareSystem "Beta"
        isolated = softwareSystem "Isolated"
        a -> b "Calls"
    }
    views {
        systemContext a "ctx" {
            include *
        }
    }
}
`;

    it('keeps the elements of a relationship and removes the isolated one', async () => {
        const json = await enrich(connectedAndIsolated, prune);

        expect(names(json.model.softwareSystems)).toEqual(['Alpha', 'Beta']);
    });

    it('keeps every element until the option is set', async () => {
        const json = await enrich(connectedAndIsolated);

        expect(names(json.model.softwareSystems)).toEqual(['Alpha', 'Beta', 'Isolated']);
    });

    it('keeps an element that a view draws without a relationship', async () => {
        const json = await enrich(`workspace {
    model {
        a = softwareSystem "Alpha"
    }
    views {
        systemContext a "ctx" {
            include *
        }
    }
}
`, prune);

        expect(names(json.model.softwareSystems)).toEqual(['Alpha']);
    });

    it('keeps the parent of a kept element and removes the unrelated sibling', async () => {
        const json = await enrich(`workspace {
    model {
        s = softwareSystem "System" {
            keep = container "Keep"
            drop = container "Drop"
        }
        other = softwareSystem "Other"
        keep -> other "Uses"
    }
}
`, prune);

        expect(names(json.model.softwareSystems)).toEqual(['System', 'Other']);
        expect(names(json.model.softwareSystems[0].containers)).toEqual(['Keep']);
    });

    it('keeps the elements a displayed instance refers to', async () => {
        const json = await enrich(`workspace {
    model {
        s = softwareSystem "System" {
            c = container "Container"
        }
        live = deploymentEnvironment "Live" {
            deploymentNode "Node" {
                containerInstance c
            }
        }
    }
    views {
        deployment s "Live" "deploy" {
            include *
        }
    }
}
`, prune);

        expect(names(json.model.softwareSystems)).toEqual(['System']);
        expect(names(json.model.softwareSystems[0].containers)).toEqual(['Container']);
        expect(json.model.deploymentNodes).toHaveLength(1);
    });

    it('leaves a model without elements untouched', async () => {
        const json = await enrich(`workspace {
    model {
    }
}
`, prune);

        expect(json.model.softwareSystems).toBeUndefined();
    });
});
