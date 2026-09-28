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
import { fitViewToContent } from './c4-json-generator';

const workspaceDsl = (systemName: string): string => `
workspace {
    model {
        a = softwareSystem "${systemName}"
    }
}
`;

/**
 * Builds a document and resolves once the handler has generated and cached JSON
 * for it, returning the generation reported by onJsonGenerated.
 */
async function buildAndGenerate(services: any, uri: string, content: string): Promise<{ json: any; generation: number }> {
    const handler = services.generation.C4GeneratorHandler;
    const generated = new Promise<{ json: any; generation: number }>((resolve) => {
        handler.onJsonGenerated = (generatedUri: string, json: any, generation: number) => {
            if (generatedUri === uri) {
                resolve({ json, generation });
            }
        };
    });

    const doc = services.shared.workspace.LangiumDocumentFactory.fromString(content, URI.parse(uri));
    services.shared.workspace.LangiumDocuments.addDocument(doc);
    // Explicit options: the build only reaches the Validated phase (and thus
    // triggers generation) when validation is requested.
    await services.shared.workspace.DocumentBuilder.build([doc], { validation: true });
    return generated;
}

const newServices = () => createC4Services({ connection: undefined as any, ...EmptyFileSystem }).C4;

describe('generation contract', () => {
    it('keeps the generation stable across deliveries of the same build', async () => {
        const services = newServices();
        const handler = services.generation.C4GeneratorHandler;
        const uri = 'file:///generation-a.dsl';
        const built = await buildAndGenerate(services, uri, workspaceDsl('A'));

        const first = handler.getContentForUri(uri);
        const second = handler.getContentForUri(uri);

        expect(first).not.toBeNull();
        expect(second?.generation).toBe(first?.generation);
        expect(second?.generation).toBe(built.generation);
        expect(second?.json).toBe(first?.json);
    });

    it('increments the generation for a new build', async () => {
        const services = newServices();
        const handler = services.generation.C4GeneratorHandler;
        const uriA = 'file:///generation-b1.dsl';
        const uriB = 'file:///generation-b2.dsl';

        const builtA = await buildAndGenerate(services, uriA, workspaceDsl('B1'));
        const builtB = await buildAndGenerate(services, uriB, workspaceDsl('B2'));

        expect(builtB.generation).toBeGreaterThan(builtA.generation);
        // Reading the cached build again does not advance the generation.
        const reread = handler.getContentForUri(uriB);
        expect(reread?.generation).toBe(builtB.generation);
        expect(handler.getContentForUri(uriB)?.generation).toBe(reread?.generation);
    });

    it('reports the cached generation through onJsonGenerated', async () => {
        const services = newServices();
        const handler = services.generation.C4GeneratorHandler;
        const uri = 'file:///generation-c.dsl';
        const built = await buildAndGenerate(services, uri, workspaceDsl('C'));

        expect(handler.getContentForUri(uri)?.generation).toBe(built.generation);
    });
});

describe('generation coalescing', () => {
    it('regenerates when a newer workspace arrives during an in-flight generation', async () => {
        const services = newServices();
        const handler: any = services.generation.C4GeneratorHandler;

        const order: string[] = [];
        let release!: () => void;
        const gate = new Promise<void>(resolve => { release = resolve; });
        handler.doGenerateAndCache = async (_uri: string, workspace: any) => {
            order.push(workspace.name);
            await gate;
        };

        const uri = 'file:///coalesce.dsl';
        const first = handler.generateAndCache(uri, { name: 'first' });
        const second = handler.generateAndCache(uri, { name: 'second' });
        release();
        await Promise.all([first, second]);

        expect(order).toEqual(['first', 'second']);
    });
});

describe('drawio layout import', () => {
    const viewDsl = `
workspace {
    model {
        user = person "User"
        a = softwareSystem "A"
        user -> a "uses"
    }
    views {
        systemlandscape "landscape" {
            include *
        }
    }
}
`;

    it('changes the cached view coordinates and bumps the generation', async () => {
        const services = newServices();
        const handler = services.generation.C4GeneratorHandler;
        const uri = 'file:///drawio-import.dsl';
        const built = await buildAndGenerate(services, uri, viewDsl);

        const view = built.json.views.systemLandscapeViews[0];
        const [first, second] = view.elements;
        const relationship = view.relationships[0];
        const xml = `<?xml version="1.0" encoding="UTF-8"?>
<mxfile><diagram>
  <mxGraphModel pageWidth="1000" pageHeight="800"><root>
    <object id="${first.id}"><mxCell vertex="1"><mxGeometry x="100" y="200" width="450" height="300" as="geometry"/></mxCell></object>
    <object id="${second.id}"><mxCell vertex="1"><mxGeometry x="700" y="200" width="450" height="300" as="geometry"/></mxCell></object>
    <object id="${relationship.id}-${relationship.order ?? '0'}"><mxCell edge="1"><mxGeometry relative="1" as="geometry"><Array as="points"><mxPoint x="500" y="400"/></Array></mxGeometry></mxCell></object>
  </root></mxGraphModel>
</diagram></mxfile>`;

        const result = handler.applyDrawioLayout(uri, 'landscape', xml);

        expect(result?.view).toBe(view);
        // The cached JSON holds the imported coordinates, fitted like the auto-layout:
        // the content is shifted so the 400px margin is equal on every side.
        expect(first).toMatchObject({ x: 400, y: 400, width: 450, height: 300 });
        expect(second).toMatchObject({ x: 1000, y: 400, width: 450, height: 300 });
        expect(relationship.vertices).toEqual([{ x: 800, y: 600 }]);
        expect(view.dimensions).toEqual({ width: 1850, height: 1100 });
        expect(handler.getContentForUri(uri)?.generation).toBeGreaterThan(built.generation);
    });

    it('returns undefined for an unknown view or an uncached document', async () => {
        const services = newServices();
        const handler = services.generation.C4GeneratorHandler;
        const uri = 'file:///drawio-import-missing.dsl';
        await buildAndGenerate(services, uri, viewDsl);

        expect(handler.applyDrawioLayout(uri, 'missing', '<mxfile/>')).toBeUndefined();
        expect(handler.applyDrawioLayout('file:///never-built.dsl', 'landscape', '<mxfile/>')).toBeUndefined();
    });
});

describe('deployment view frames', () => {
    it('omits coordinates for deployment-node frames', async () => {
        const services = newServices();
        const uri = 'file:///deployment-frames.dsl';
        const built = await buildAndGenerate(services, uri, `
workspace {
    model {
        ss = softwareSystem "SS" {
            webapp = container "Webapp"
        }
        live = deploymentEnvironment "Live" {
            dn = deploymentNode "Node" {
                webappInstance = containerInstance webapp
            }
        }
    }
    views {
        deployment ss "Live" {
            include *
        }
    }
}
`);
        const view = built.json.views.deploymentViews[0];
        const deploymentNodeId = built.json.model.deploymentNodes[0].id;
        const frame = view.elements.find((e: any) => e.id === deploymentNodeId);

        expect(frame).toBeDefined();
        // The renderer derives the frame box from its children.
        expect(frame).not.toHaveProperty('x');
        expect(frame).not.toHaveProperty('y');
    });

    it('fits the paper to imported coordinates including the deployment-node frame', async () => {
        const services = newServices();
        const handler = services.generation.C4GeneratorHandler;
        const uri = 'file:///deployment-import.dsl';
        const built = await buildAndGenerate(services, uri, `
workspace {
    model {
        ss = softwareSystem "SS" {
            webapp = container "Webapp"
        }
        live = deploymentEnvironment "Live" {
            dn = deploymentNode "Node" {
                webappInstance = containerInstance webapp
            }
        }
    }
    views {
        deployment ss "Live" {
            include *
        }
    }
}
`);
        const view = built.json.views.deploymentViews[0];
        const instanceId = built.json.model.deploymentNodes[0].containerInstances[0].id;
        const instance = view.elements.find((e: any) => e.id === instanceId);
        const xml = `<?xml version="1.0" encoding="UTF-8"?>
<mxfile><diagram>
  <mxGraphModel pageWidth="1000" pageHeight="800"><root>
    <object id="${instanceId}"><mxCell vertex="1"><mxGeometry x="1000" y="500" width="450" height="300" as="geometry"/></mxCell></object>
  </root></mxGraphModel>
</diagram></mxfile>`;

        const result = handler.applyDrawioLayout(uri, view.key, xml);

        expect(result?.view).toBe(view);
        // The instance sits at the 400 margin; the frame (instance + 50/50/50/129
        // padding) drives the paper: span 550x479 + 800 = 1350x1279.
        expect(instance).toMatchObject({ x: 450, y: 450, width: 450, height: 300 });
        expect(view.dimensions).toEqual({ width: 1350, height: 1279 });
    });
});

describe('imported paper includes frames', () => {
    const importXml = (boxes: { id: string; x: number; y: number }[]): string =>
        `<?xml version="1.0" encoding="UTF-8"?>
<mxfile><diagram>
  <mxGraphModel pageWidth="1000" pageHeight="800"><root>
    ${boxes.map(b => `<object id="${b.id}"><mxCell vertex="1"><mxGeometry x="${b.x}" y="${b.y}" width="450" height="300" as="geometry"/></mxCell></object>`).join('\n    ')}
  </root></mxGraphModel>
</diagram></mxfile>`;

    it('includes the software-system scope frame of a container view', async () => {
        const services = newServices();
        const handler = services.generation.C4GeneratorHandler;
        const uri = 'file:///container-import.dsl';
        const built = await buildAndGenerate(services, uri, `
workspace {
    model {
        ss = softwareSystem "SS" {
            a = container "A"
            b = container "B"
        }
    }
    views {
        container ss "containers" {
            include *
        }
    }
}
`);
        const view = built.json.views.containerViews[0];
        const [a, b] = built.json.model.softwareSystems[0].containers;

        handler.applyDrawioLayout(uri, view.key, importXml([{ id: a.id, x: 1000, y: 500 }, { id: b.id, x: 2000, y: 500 }]));

        // Containers (1000,500)-(2450,800); the software-system frame adds 50/50/50/129
        // → (950,450,1550,479); paper = 1550x479 + 800 = 2350x1279.
        expect(view.elements.find((e: any) => e.id === a.id)).toMatchObject({ x: 450, y: 450 });
        expect(view.elements.find((e: any) => e.id === b.id)).toMatchObject({ x: 1450, y: 450 });
        expect(view.dimensions).toEqual({ width: 2350, height: 1279 });
    });

    it('includes group frames', async () => {
        const services = newServices();
        const handler = services.generation.C4GeneratorHandler;
        const uri = 'file:///group-import.dsl';
        const built = await buildAndGenerate(services, uri, `
workspace {
    model {
        group "G" {
            a = softwareSystem "A"
            b = softwareSystem "B"
        }
    }
    views {
        systemlandscape "landscape" {
            include *
        }
    }
}
`);
        const view = built.json.views.systemLandscapeViews[0];
        const [a, b] = built.json.model.softwareSystems;

        handler.applyDrawioLayout(uri, view.key, importXml([{ id: a.id, x: 1000, y: 500 }, { id: b.id, x: 2000, y: 500 }]));

        // Group frame adds 50/50/50/113 (a group shows no metadata line).
        expect(view.elements.find((e: any) => e.id === a.id)).toMatchObject({ x: 450, y: 450 });
        expect(view.dimensions).toEqual({ width: 2350, height: 1263 });
    });
});

describe('fitViewToContent', () => {
    it('ignores size-less frames and keeps an equal margin around the sized content', () => {
        const view: any = {
            elements: [
                { id: 'frame', x: 0, y: 0 },
                { id: 'a', x: 1000, y: 500, width: 450, height: 300 },
            ],
            relationships: [{ id: 'r', vertices: [{ x: 1200, y: 700 }] }],
        };

        fitViewToContent(view);

        // The frame is auto-drawn and has no size: it is neither measured nor moved.
        expect(view.elements[0]).toMatchObject({ id: 'frame', x: 0, y: 0 });
        // The sized element sits at the 400px margin, the vertex shifts with it.
        expect(view.elements[1]).toMatchObject({ id: 'a', x: 400, y: 400 });
        expect(view.relationships[0].vertices).toEqual([{ x: 600, y: 600 }]);
        expect(view.dimensions).toEqual({ width: 1250, height: 1100 });
    });
});

describe('text measurement relayout', () => {
    it('reports no change and keeps the generation when no layout applies', async () => {
        const services = newServices();
        const handler = services.generation.C4GeneratorHandler;
        const uri = 'file:///text-measure.dsl';
        const built = await buildAndGenerate(services, uri, workspaceDsl('T'));

        const result = await handler.applyTextMeasurements(uri, built.generation, {});

        expect(result).toEqual({ changed: false });
        // Nothing changed, so the cached generation must stay put (no rebuild).
        expect(handler.getContentForUri(uri)?.generation).toBe(built.generation);
    });

    it('returns undefined for a stale generation', async () => {
        const services = newServices();
        const handler = services.generation.C4GeneratorHandler;
        const uri = 'file:///text-measure-stale.dsl';
        const built = await buildAndGenerate(services, uri, workspaceDsl('S'));

        expect(await handler.applyTextMeasurements(uri, built.generation + 999, {})).toBeUndefined();
    });
});
