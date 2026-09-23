import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { EmptyFileSystem } from 'langium';
import { URI } from 'vscode-uri';
import { DOMParser } from '@xmldom/xmldom';
import { createC4Services } from './c4-module';
import { C4JsonGenerator } from './c4-json-generator';
import { isWorkspace } from '../generated/ast';

const VIEW_ARRAYS: Record<string, string> = {
    systemLandscapeViews: 'SystemLandscape', systemContextViews: 'SystemContext',
    containerViews: 'Container', componentViews: 'Component', deploymentViews: 'Deployment',
    dynamicViews: 'Dynamic', filteredViews: 'Filtered', imageViews: 'Image',
};

function collectDsl(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        if (entry.startsWith('.')) continue;
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) collectDsl(full, out);
        else if (entry.endsWith('.dsl')) out.push(full);
    }
    return out;
}

async function generateFixture(dirName: string): Promise<any> {
    const dir = resolve(__dirname, '../../test/fixtures', dirName);
    const services = createC4Services({ connection: undefined as any, ...EmptyFileSystem }).C4;
    const docs = collectDsl(dir).map(file =>
        services.shared.workspace.LangiumDocumentFactory.fromString(readFileSync(file, 'utf8'), URI.file(file))
    );
    for (const d of docs) services.shared.workspace.LangiumDocuments.addDocument(d);
    await services.shared.workspace.DocumentBuilder.build(docs);
    const main = docs.find(d => d.uri.fsPath.endsWith('input.dsl')) ?? docs[0];
    const root: any = main.parseResult.value;
    const workspace = isWorkspace(root) ? root : root.workspaces[0];
    return new C4JsonGenerator(services).generate(workspace);
}

async function generateDsl(content: string): Promise<any> {
    const services = createC4Services({ connection: undefined as any, ...EmptyFileSystem }).C4;
    const doc = services.shared.workspace.LangiumDocumentFactory.fromString(content, URI.parse('file:///drawio.dsl'));
    services.shared.workspace.LangiumDocuments.addDocument(doc);
    await services.shared.workspace.DocumentBuilder.build([doc]);
    const root: any = doc.parseResult.value;
    const workspace = isWorkspace(root) ? root : root.workspaces[0];
    return new C4JsonGenerator(services).generate(workspace);
}

/** Mirrors structurizr-workspace.js getTerminologyFor. */
function terminologyFor(item: any): string {
    if (item.type === 'Person') return 'Person';
    if (item.type === 'SoftwareSystem' || item.type === 'SoftwareSystemInstance') return 'Software System';
    if (item.type === 'Container' || item.type === 'ContainerInstance') return 'Container';
    if (item.type === 'Component') return 'Component';
    if (item.type === 'DeploymentNode') return 'Deployment Node';
    if (item.type === 'InfrastructureNode') return 'Infrastructure Node';
    return '';
}

/** Mirrors structurizr-ui.js getTitleForView: explicit title, then name, then key. */
function titleForView(v: any): string {
    if (v && v.title && String(v.title).trim().length > 0) return v.title;
    return v.name || v.key;
}

/** Decodes the XML entities the exporter writes into attribute values. */
function decodeXml(text: string): string {
    return text
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
        .replace(/&amp;/g, '&');
}

function loadExporter(structurizr: any): any {
    const code = readFileSync(resolve(__dirname, '../../js/structurizr-drawio.js'), 'utf8');
    return new Function('structurizr', code + '\nreturn structurizr.drawio;')(structurizr);
}

/** Builds a workspace the way structurizr-workspace.js does: types plus instance enrichment. */
function makeWorkspace(json: any) {
    const elements = new Map<string, any>();
    const relationships = new Map<string, any>();

    // The loader links nested elements with parentId (structurizr-workspace.js #initModel),
    // which the JSON itself does not carry.
    const visit = (el: any, type: string, parent?: any) => {
        if (!el || typeof el !== 'object') return;
        el.type = type;
        el.parentId = parent ? parent.id : undefined;
        if (el.id !== undefined) elements.set(String(el.id), el);
        for (const r of el.relationships ?? []) relationships.set(String(r.id), r);
        for (const c of el.children ?? []) visit(c, 'DeploymentNode', el);
        for (const c of el.softwareSystemInstances ?? []) {
            const base = elements.get(String(c.softwareSystemId));
            if (base) { c.name = base.name; if (c.description === undefined) c.description = base.description; }
            visit(c, 'SoftwareSystemInstance', el);
        }
        for (const c of el.containerInstances ?? []) {
            const base = elements.get(String(c.containerId));
            if (base) { c.name = base.name; if (c.description === undefined) c.description = base.description; c.technology = base.technology; }
            visit(c, 'ContainerInstance', el);
        }
        for (const c of el.infrastructureNodes ?? []) visit(c, 'InfrastructureNode', el);
        for (const c of el.containers ?? []) visit(c, 'Container', el);
        for (const c of el.components ?? []) visit(c, 'Component', el);
    };
    for (const p of json.model?.people ?? []) visit(p, 'Person');
    for (const s of json.model?.softwareSystems ?? []) visit(s, 'SoftwareSystem');
    for (const d of json.model?.deploymentNodes ?? []) visit(d, 'DeploymentNode');
    for (const c of json.model?.customElements ?? []) visit(c, 'Custom');
    for (const r of json.model?.relationships ?? []) relationships.set(String(r.id), r);

    const views: any[] = [];
    for (const [key, type] of Object.entries(VIEW_ARRAYS)) {
        for (const v of json.views?.[key] ?? []) views.push({ ...v, type });
    }
    // The loader exposes the views object itself (structurizr-workspace.js this.views),
    // so keep configuration reachable while the array methods stay usable.
    (views as any).configuration = json.views?.configuration;
    return {
        model: json.model,
        findViewByKey: (key: string) => views.find(v => v.key === key),
        findElementById: (id: any) => elements.get(String(id)),
        findRelationshipById: (id: any) => relationships.get(String(id)),
        views,
    };
}

function makeExporter(workspace: any) {
    return loadExporter({
        ui: { isDarkMode: () => false, findElementStyle: () => ({}), findRelationshipStyle: () => ({}), getTitleForView: titleForView },
        workspace: { getTerminologyFor: terminologyFor },
        diagram: undefined,
    });
}

interface XmlReport { parserErrors: string[]; duplicateIds: string[]; danglingEdges: string[]; }

function validateXml(xml: string): XmlReport {
    const parserErrors: string[] = [];
    const doc = new DOMParser({ onError: (level: string, msg: string) => { if (level === 'error' || level === 'fatalError') parserErrors.push(msg); } } as any)
        .parseFromString(xml, 'text/xml');
    if (!doc.documentElement || doc.documentElement.nodeName === 'parsererror') parserErrors.push('root is parsererror');

    const ids = new Map<string, number>();
    const objects = doc.getElementsByTagName('object');
    for (let i = 0; i < objects.length; i++) {
        const id = objects[i].getAttribute('id') ?? '';
        ids.set(id, (ids.get(id) ?? 0) + 1);
    }
    const cells = doc.getElementsByTagName('mxCell');
    for (let i = 0; i < cells.length; i++) {
        const id = cells[i].getAttribute('id') ?? '';
        if (id) ids.set(id, (ids.get(id) ?? 0) + 1);
    }
    const duplicateIds = [...ids.entries()].filter(([, n]) => n > 1).map(([id]) => id);

    const danglingEdges: string[] = [];
    for (let i = 0; i < cells.length; i++) {
        if (cells[i].getAttribute('edge') !== '1') continue;
        for (const attr of ['source', 'target']) {
            const ref = cells[i].getAttribute(attr);
            if (ref && !ids.has(ref)) danglingEdges.push(`${attr}=${ref}`);
        }
    }
    return { parserErrors, duplicateIds, danglingEdges };
}

function exportView(json: any, viewKey: string): string {
    const workspace = makeWorkspace(json);
    const drawio = makeExporter(workspace);
    const view = workspace.views.find((v: any) => v.key === viewKey)!;
    let xml: string | undefined;
    let error: string | undefined;
    drawio.exportView(view, workspace, false, (result: any, err: string) => { if (err) error = err; else xml = result; });
    if (error || !xml) throw new Error(error ?? 'no xml');
    return xml;
}

describe('drawio export', () => {
    for (const fixture of ['no-relationship', 'big-bank-plc', 'groups-nested']) {
        it(`emits well-formed xml with resolvable edges for ${fixture}`, async () => {
            const json = await generateFixture(fixture);
            const workspace = makeWorkspace(json);
            const drawio = makeExporter(workspace);
            for (const view of workspace.views) {
                if (view.type === 'Filtered') continue;
                let xml: string | undefined;
                drawio.exportView(view, workspace, false, (result: any) => { xml = result; });
                if (!xml) continue;
                expect(validateXml(xml)).toEqual({ parserErrors: [], duplicateIds: [], danglingEdges: [] });
            }
        }, 180_000);
    }

    it('escapes view keys, names, descriptions and properties', async () => {
        const json = await generateDsl(`
workspace {
    model {
        a = softwareSystem "A & B" "desc with & and <angle>"
        !elements a {
            properties {
                custom "a & b < c"
            }
        }
        b = softwareSystem "B"
        a -> b "uses & <it>"
    }
    views {
        systemContext a "ctx & <t>" {
            include *
        }
    }
}
`);
        const xml = exportView(json, 'ctx & <t>');
        expect(validateXml(xml)).toEqual({ parserErrors: [], duplicateIds: [], danglingEdges: [] });
        expect(xml).toContain("custom='a &amp; b &lt; c'");
    }, 120_000);

    it('draws boundaries behind elements', async () => {
        const json = await generateFixture('big-bank-plc');
        const xml = exportView(json, 'Containers');
        expect(xml.indexOf('ScopeBoundary')).toBeGreaterThan(-1);
        expect(xml.indexOf('ScopeBoundary')).toBeLessThan(xml.indexOf('c4Type="Container"'));
    }, 120_000);

    it('maps every shape to a drawio style that exists', async () => {
        const shapes = [
            'Box', 'RoundedBox', 'Circle', 'Ellipse', 'Hexagon', 'Diamond', 'Cylinder', 'Bucket',
            'Pipe', 'Person', 'Robot', 'Folder', 'WebBrowser', 'Window', 'Terminal', 'Shell',
            'MobileDevicePortrait', 'MobileDeviceLandscape', 'Component'
        ];
        const elements = shapes.map((_, i) => `        s${i} = softwareSystem "S${i}" {\n            tags "T${i}"\n        }`).join('\n');
        const json = await generateDsl(`
workspace {
    model {
${elements}
    }
    views {
        systemLandscape "shapes" {
            include *
        }
    }
}
`);
        const workspace = makeWorkspace(json);
        const drawio = loadExporter({
            ui: {
                isDarkMode: () => false,
                findElementStyle: (el: any) => {
                    const tag = String(el.tags ?? '').split(',').map((t: string) => t.trim()).find((t: string) => /^T\d+$/.test(t));
                    return tag ? { shape: shapes[Number(tag.slice(1))] } : {};
                },
                findRelationshipStyle: () => ({}),
                getTitleForView: titleForView,
            },
            workspace: { getTerminologyFor: terminologyFor },
            diagram: undefined,
        });
        let xml: string | undefined;
        drawio.exportView(workspace.views[0], workspace, false, (result: any) => { xml = result; });
        const out = xml ?? '';
        const lines = out.split('\n');
        const lineFor = (name: string) => {
            const i = lines.findIndex(l => l.includes(`c4Name="${name}"`));
            return i >= 0 ? lines[i + 1] : '';
        };

        expect(lineFor('S0')).toContain('rounded=0;');
        expect(lineFor('S2')).toContain('ellipse;aspect=fixed;');
        expect(lineFor('S3')).toContain('ellipse;rounded=0;');
        expect(lineFor('S4')).toContain('shape=hexagon;');
        expect(lineFor('S5')).toContain('shape=rhombus;');
        expect(lineFor('S6')).toContain('shape=cylinder3;size=15;boundedLbl=1;rounded=0;');
        expect(lineFor('S8')).toContain('shape=cylinder3;size=15;direction=south;');
        expect(lineFor('S9')).toContain('shape=mxgraph.c4.person2;');
        expect(lineFor('S11')).toContain('shape=folder;');
        expect(lineFor('S12')).toContain('shape=mxgraph.c4.webBrowserContainer2;');

        // Shapes drawio does not ship fall back to a rounded box.
        for (const name of ['S1', 'S7', 'S10', 'S13', 'S14', 'S15', 'S16', 'S17', 'S18']) {
            expect(lineFor(name)).toContain('rounded=1;');
            expect(lineFor(name)).not.toContain('shape=');
        }

        // The only C4 stencil shapes referenced are the ones drawio actually defines.
        const c4refs = new Set([...out.matchAll(/mxgraph\.c4\.[a-zA-Z0-9]+/g)].map(m => m[0]));
        expect(c4refs).toEqual(new Set(['mxgraph.c4.person2', 'mxgraph.c4.webBrowserContainer2']));
    }, 120_000);

    it('honours the metadata and description style flags', async () => {
        const json = await generateDsl(`
workspace {
    model {
        a = softwareSystem "A" "Description A" {
            tags "NoMeta"
        }
        b = softwareSystem "B" "Description B" {
            tags "NoDesc"
        }
        c = softwareSystem "C" "Description C"
        a -> b "uses A to B" "Tech A" {
            tags "NoMeta"
        }
        b -> c "uses B to C" "Tech B" {
            tags "NoDesc"
        }
    }
    views {
        systemLandscape "flags" {
            include *
        }
    }
}
`);
        const workspace = makeWorkspace(json);
        const has = (el: any, tag: string) =>
            String(el.tags ?? '').split(',').map((t: string) => t.trim()).includes(tag);
        const drawio = loadExporter({
            ui: {
                isDarkMode: () => false,
                findElementStyle: (el: any) => ({ metadata: !has(el, 'NoMeta'), description: !has(el, 'NoDesc') }),
                findRelationshipStyle: (rel: any) => ({ metadata: !has(rel, 'NoMeta'), description: !has(rel, 'NoDesc') }),
                getTitleForView: titleForView,
            },
            workspace: { getTerminologyFor: terminologyFor },
            diagram: undefined,
        });
        let xml: string | undefined;
        drawio.exportView(workspace.views[0], workspace, false, (result: any) => { xml = result; });
        const out = xml ?? '';
        const labelOf = (match: string) => {
            const line = out.split('\n').find(l => l.includes(match)) ?? '';
            const m = line.match(/label="([^"]*)"/);
            return m ? m[1] : '';
        };

        // metadata false hides the type line, description stays
        expect(labelOf('c4Name="A"')).not.toContain('[Software System]');
        expect(labelOf('c4Name="A"')).toContain('Description A');
        // description false hides the description, type line stays
        expect(labelOf('c4Name="B"')).toContain('[Software System]');
        expect(labelOf('c4Name="B"')).not.toContain('Description B');
        // no flags: both shown
        expect(labelOf('c4Name="C"')).toContain('[Software System]');
        expect(labelOf('c4Name="C"')).toContain('Description C');

        // relationships: metadata false hides the technology, description stays
        const relA = labelOf('c4Description="uses A to B"');
        expect(relA).not.toContain('Tech A');
        expect(relA).toContain('uses A to B');
        // description false hides the description, technology stays
        const relB = labelOf('c4Description="uses B to C"');
        expect(relB).toContain('Tech B');
        expect(relB).not.toContain('uses B to C');
    }, 120_000);

    it('hides groups when a view sets structurizr.groups to false', async () => {
        const json = await generateDsl(`
workspace {
    model {
        properties {
            "structurizr.groupSeparator" "/"
        }
        group "Outer" {
            group "Inner" {
                a = softwareSystem "A"
            }
        }
    }
    views {
        systemLandscape "withGroups" {
            include *
        }
        systemLandscape "noGroups" {
            include *
            properties {
                "structurizr.groups" "false"
            }
        }
    }
}
`);
        const landscape = json.views.systemLandscapeViews;
        expect(landscape[0].properties).toBeUndefined();
        expect(landscape[1].properties).toEqual({ 'structurizr.groups': 'false' });

        const workspace = makeWorkspace(json);
        const drawio = makeExporter(workspace);
        const groupsFor = (key: string) => {
            const view = workspace.views.find((v: any) => v.key === key)!;
            return drawio._collectBoundaries(view, workspace, false).filter((b: any) => b.isGroup);
        };
        expect(groupsFor('withGroups').length).toBeGreaterThan(0);
        expect(groupsFor('noGroups')).toEqual([]);
    }, 120_000);

    it('applies element border styles as dash patterns', async () => {
        const json = await generateDsl(`
workspace {
    model {
        a = softwareSystem "A" {
            tags "Dashed"
        }
        b = softwareSystem "B" {
            tags "Dotted"
        }
        c = softwareSystem "C" {
            tags "Solid"
        }
    }
    views {
        systemLandscape "borders" {
            include *
        }
    }
}
`);
        const workspace = makeWorkspace(json);
        const has = (el: any, tag: string) =>
            String(el.tags ?? '').split(',').map((t: string) => t.trim()).includes(tag);
        const drawio = loadExporter({
            ui: {
                isDarkMode: () => false,
                findElementStyle: (el: any) => has(el, 'Dashed') ? { border: 'Dashed', strokeWidth: 2 }
                    : has(el, 'Dotted') ? { border: 'Dotted', strokeWidth: 2 }
                    : { border: 'Solid', strokeWidth: 2 },
                findRelationshipStyle: () => ({}),
                getTitleForView: titleForView,
            },
            workspace: { getTerminologyFor: terminologyFor },
            diagram: undefined,
        });
        let xml: string | undefined;
        drawio.exportView(workspace.views[0], workspace, false, (result: any) => { xml = result; });
        const lines = (xml ?? '').split('\n');
        const lineFor = (name: string) => {
            const i = lines.findIndex(l => l.includes(`c4Name="${name}"`));
            return i >= 0 ? lines[i + 1] : '';
        };

        // dashed: strokeWidth * 4; dotted: strokeWidth, strokeWidth * 2
        expect(lineFor('A')).toContain('dashed=1;dashPattern=8 8;');
        expect(lineFor('B')).toContain('dashed=1;dashPattern=2 4;');
        expect(lineFor('C')).toContain('dashed=0;');
    }, 120_000);

    it('derives boundary and relationship dashes from styles', async () => {
        const json = await generateDsl(`
workspace {
    model {
        properties {
            "structurizr.groupSeparator" "/"
        }
        s = softwareSystem "S" {
            group "G" {
                c = container "C"
            }
            d = container "D"
            c -> d "uses"
        }
    }
    views {
        container s "containers" {
            include *
        }
    }
}
`);
        const workspace = makeWorkspace(json);
        const drawio = loadExporter({
            ui: {
                isDarkMode: () => false,
                // Mirrors the structurizr-ui.js defaults: Group borders are Dotted,
                // everything else defaults to Solid.
                findElementStyle: (el: any) => (el && el.type === 'Group')
                    ? { border: 'Dotted', strokeWidth: 2 }
                    : { border: 'Solid', strokeWidth: 2 },
                findRelationshipStyle: () => ({ style: 'Dashed', thickness: 2 }),
                getTitleForView: titleForView,
            },
            workspace: { getTerminologyFor: terminologyFor },
            diagram: undefined,
        });
        let xml: string | undefined;
        drawio.exportView(workspace.views[0], workspace, false, (result: any) => { xml = result; });
        const lines = (xml ?? '').split('\n');
        const lineAfter = (match: string) => {
            const i = lines.findIndex(l => l.includes(match));
            return i >= 0 ? lines[i + 1] : '';
        };

        // scope boundaries follow the element style border: Solid by default
        expect(lineAfter('c4Type="SystemScopeBoundary"')).toContain('dashed=0;');
        // groups are Dotted: strokeWidth, strokeWidth * 2
        const group = lineAfter('c4Type="GroupScopeBoundary"');
        expect(group).toContain('dashed=1;');
        expect(group).toContain('dashPattern=2 4;');
        // relationships are dashed by default: thickness * 4
        expect(lineAfter('c4Type="Relationship"')).toContain('dashed=1;dashPattern=8 8;');
    }, 120_000);

    it('pins the renderer font family on every cell', async () => {
        const json = await generateDsl(`
workspace {
    model {
        properties {
            "structurizr.groupSeparator" "/"
        }
        s = softwareSystem "S" {
            group "G" {
                c = container "C"
            }
            d = container "D"
            c -> d "uses"
        }
    }
    views {
        container s "containers" {
            include *
        }
    }
}
`);
        const cellsOf = (xml: string) => xml.split('\n').filter(l => l.includes('<mxCell style='));
        const workspace = makeWorkspace(json);

        // the family comes from the renderer, not from a style
        const custom = loadExporter({
            ui: {
                isDarkMode: () => false,
                findElementStyle: () => ({}),
                findRelationshipStyle: () => ({}),
                getTitleForView: titleForView,
                DEFAULT_FONT_NAME: 'Custom Stack, Sans Serif',
            },
            workspace: { getTerminologyFor: terminologyFor },
            diagram: undefined,
        });
        let customXml: string | undefined;
        custom.exportView(workspace.views[0], workspace, false, (result: any) => { customXml = result; });
        const customCells = cellsOf(customXml!);
        expect(customCells.length).toBeGreaterThan(0);
        for (const cell of customCells) expect(cell).toContain('fontFamily=Custom Stack, Sans Serif;');

        // without the renderer constant the documented default is used
        const drawio = makeExporter(workspace);
        let xml: string | undefined;
        drawio.exportView(workspace.views[0], workspace, false, (result: any) => { xml = result; });
        const cells = cellsOf(xml!);
        expect(cells.length).toBeGreaterThan(0);
        for (const cell of cells) expect(cell).toContain('fontFamily=Tahoma, Verdana, Helvetica, Arial;');
    }, 120_000);

    it('carries element and relationship urls into the export', async () => {
        const json = await generateDsl(`
workspace {
    model {
        a = softwareSystem "A" {
            url "https://example.com/a"
            properties {
                "docs" "https://example.com/a/docs"
            }
        }
        b = softwareSystem "B"
        c = softwareSystem "C"
        a -> b "uses" {
            url "https://example.com/uses"
        }
        b -> c "links"

        !elements b {
            properties {
                "docs" "https://example.com/b"
            }
        }
    }
    views {
        systemLandscape "urls" {
            include *
        }
        dynamic * "Dynamic" {
            a -> b "step" {
                url "https://example.com/step"
            }
        }
    }
}
`);
        // a step url belongs to the relationship view, as in the reference parser
        expect(json.views.dynamicViews[0].relationships[0].url).toBe('https://example.com/step');
        // the generator keeps urls declared in element and relationship blocks
        const systems = json.model.softwareSystems;
        const byName = (n: string) => systems.find((s: any) => s.name === n);
        expect(byName('A').url).toBe('https://example.com/a');
        expect(byName('C').url).toBeUndefined();
        expect(byName('A').relationships.find((r: any) => r.description === 'uses').url).toBe('https://example.com/uses');
        expect(byName('B').relationships.find((r: any) => r.description === 'links').url).toBeUndefined();

        const workspace = makeWorkspace(json);
        const drawio = makeExporter(workspace);
        let xml: string | undefined;
        drawio.exportView(workspace.views[0], workspace, false, (result: any) => { xml = result; });
        const lines = (xml ?? '').split('\n');
        const objectFor = (match: string) => lines.find(l => l.includes(match)) ?? '';

        expect(objectFor('c4Name="A"')).toContain('link="https://example.com/a"');
        // a property whose value is an HTTP URL counts as a link too
        expect(objectFor('c4Name="B"')).toContain('link="https://example.com/b"');
        expect(objectFor('c4Name="C"')).not.toContain('link=');
        expect(objectFor('c4Description="uses"')).toContain('link="https://example.com/uses"');
        expect(objectFor('c4Description="links"')).not.toContain('link=');
        expect(validateXml(xml!)).toEqual({ parserErrors: [], duplicateIds: [], danglingEdges: [] });
    }, 120_000);

    it('marks container instances that come from another software system', async () => {
        const json = await generateDsl(`
workspace {
    model {
        s = softwareSystem "S" {
            c = container "C"
        }
        o = softwareSystem "Other" {
            odb = container "Other DB" "Other database" "Database"
        }
        c -> odb "reads"
        deploymentEnvironment "Production" {
            node = deploymentNode "Node" {
                cInstance = containerInstance c
                odbInstance = containerInstance odb
            }
        }
    }
    views {
        deployment s "Production" "deployment" {
            include *
        }
    }
}
`);
        const workspace = makeWorkspace(json);
        const drawio = makeExporter(workspace);
        let xml: string | undefined;
        drawio.exportView(workspace.views[0], workspace, false, (result: any) => { xml = result; });
        const lines = (xml ?? '').split('\n');
        const labelOf = (name: string) => {
            const line = lines.find(l => l.includes(`c4Name="${name}"`)) ?? '';
            const m = line.match(/label="([^"]*)"/);
            return m ? decodeXml(decodeXml(m[1])) : '';
        };

        // the instance of the scoped system stays unmarked
        expect(labelOf('C')).not.toContain('from ');
        // the foreign instance names the system it comes from
        expect(labelOf('Other DB')).toContain('from Other');
        expect(labelOf('Other DB')).toContain('[Container: Database]');
    }, 120_000);

    it('applies relationship jump, label position and label width', async () => {
        const json = await generateDsl(`
workspace {
    model {
        a = softwareSystem "A"
        b = softwareSystem "B"
        c = softwareSystem "C"
        d = softwareSystem "D"
        a -> b "plain"
        b -> c "jumping" {
            tags "Jumps"
        }
        c -> d "positioned" {
            tags "Positioned"
        }
    }
    views {
        styles {
            relationship "Jumps" {
                jump true
            }
            relationship "Positioned" {
                position 0
                width 300
            }
        }
        systemLandscape "relationships" {
            include *
        }
    }
}
`);
        const workspace = makeWorkspace(json);
        const tagsOf = (rel: any) => String(rel.tags ?? '').split(',').map((t: string) => t.trim());
        const drawio = loadExporter({
            ui: {
                isDarkMode: () => false,
                findElementStyle: () => ({}),
                findRelationshipStyle: (rel: any) => {
                    const tags = tagsOf(rel);
                    if (tags.includes('Jumps')) return { thickness: 2, jump: true };
                    if (tags.includes('Positioned')) return { thickness: 2, position: 0, width: 300 };
                    return { thickness: 2 };
                },
                getTitleForView: titleForView,
            },
            workspace: { getTerminologyFor: terminologyFor },
            diagram: undefined,
        });
        let xml: string | undefined;
        drawio.exportView(workspace.views[0], workspace, false, (result: any) => { xml = result; });
        const lines = (xml ?? '').split('\n');
        const indexOf = (desc: string) => lines.findIndex(l => l.includes(`c4Description="${desc}"`));
        const cellOf = (desc: string) => lines[indexOf(desc)] === undefined ? '' : lines[indexOf(desc) + 1];
        const geometryOf = (desc: string) => lines[indexOf(desc)] === undefined ? '' : lines[indexOf(desc) + 2];

        // no jump unless the style asks for it, and the jump size follows the thickness
        expect(cellOf('plain')).toContain('jumpStyle=none;');
        expect(cellOf('jumping')).toContain('jumpStyle=arc;jumpSize=10;');
        // width constrains where the label wraps
        expect(cellOf('positioned')).toContain('labelWidth=300;');
        // position 0 places the label at the source end: geometry.x = 2 * (0 / 100) - 1
        expect(geometryOf('positioned')).toContain('x="-1"');
        expect(geometryOf('plain')).toContain('x="0"');
    }, 120_000);

    it('uses the configured metadata symbols and custom element metadata', async () => {
        const json = await generateDsl(`
workspace {
    model {
        archetypes {
            hardware = element {
                metadata "Hardware System"
                tag "Hardware System"
            }
            blank = element {
                tag "Blank"
            }
        }
        a = softwareSystem "A"
        b = hardware "B"
        d = blank "D"
        a -> b "uses" "Tech A"
    }
    views {
        terminology {
            metadata angle
        }
        systemLandscape "symbols" {
            include *
        }
    }
}
`);
        const workspace = makeWorkspace(json);
        const drawio = makeExporter(workspace);
        let xml: string | undefined;
        drawio.exportView(workspace.views[0], workspace, false, (result: any) => { xml = result; });
        const lines = (xml ?? '').split('\n');
        // label attributes are escaped twice: once for the HTML label, once for XML
        const labelOf = (match: string) => {
            const line = lines.find(l => l.includes(match)) ?? '';
            const m = line.match(/label="([^"]*)"/);
            return m ? decodeXml(decodeXml(m[1])) : '';
        };

        // the configured symbols wrap the element type
        expect(labelOf('c4Name="A"')).toContain('<Software System>');
        // a custom element shows its own metadata instead of a type
        expect(labelOf('c4Name="B"')).toContain('<Hardware System>');
        expect(labelOf('c4Name="B"')).not.toContain('Custom');
        // a custom element without metadata has no metadata line
        expect(labelOf('c4Name="D"')).not.toContain('<');
        // relationship technology uses the same symbols
        expect(labelOf('c4Description="uses"')).toContain('<Tech A>');
    }, 120_000);

    it('squares boundary corners unless the style asks for a rounded box', async () => {
        const json = await generateDsl(`
workspace {
    model {
        properties {
            "structurizr.groupSeparator" "/"
        }
        s = softwareSystem "S" {
            group "G" {
                c = container "C"
            }
            d = container "D"
        }
    }
    views {
        container s "containers" {
            include *
        }
    }
}
`);
        const workspace = makeWorkspace(json);
        const exportWith = (findElementStyle: (el: any) => any) => {
            const drawio = loadExporter({
                ui: { isDarkMode: () => false, findElementStyle, findRelationshipStyle: () => ({}), getTitleForView: titleForView },
                workspace: { getTerminologyFor: terminologyFor },
                diagram: undefined,
            });
            let xml: string | undefined;
            drawio.exportView(workspace.views[0], workspace, false, (result: any) => { xml = result; });
            const lines = (xml ?? '').split('\n');
            return (match: string) => {
                const i = lines.findIndex(l => l.includes(match));
                return i >= 0 ? lines[i + 1] : '';
            };
        };

        // plain boxes stay square
        const plain = exportWith(() => ({ shape: 'Box' }));
        expect(plain('c4Type="SystemScopeBoundary"')).toContain('rounded=0;');
        expect(plain('c4Type="GroupScopeBoundary"')).toContain('rounded=0;');

        // a Group style with a rounded box keeps its corners
        const rounded = exportWith((el: any) => (el && el.type === 'Group') ? { shape: 'RoundedBox' } : { shape: 'Box' });
        expect(rounded('c4Type="GroupScopeBoundary"')).toContain('rounded=1;');
        expect(rounded('c4Type="SystemScopeBoundary"')).toContain('rounded=0;');

        // a Boundary-tag style overrides the shape of the element it wraps
        const override = exportWith((el: any) => (el && el.type === 'Boundary') ? { shape: 'Component' } : { shape: 'Box' });
        expect(override('c4Type="SystemScopeBoundary"')).toContain('rounded=1;');
        expect(override('c4Type="GroupScopeBoundary"')).toContain('rounded=0;');
    }, 120_000);

    it('washes colours according to opacity', async () => {
        const json = await generateDsl(`
workspace {
    model {
        a = softwareSystem "A" {
            tags "Faded"
        }
        b = softwareSystem "B"
        a -> b "uses" {
            tags "Faded"
        }
    }
    views {
        systemLandscape "opacity" {
            include *
        }
    }
}
`);
        const workspace = makeWorkspace(json);
        const has = (el: any, tag: string) =>
            String(el.tags ?? '').split(',').map((t: string) => t.trim()).includes(tag);
        const drawio = loadExporter({
            ui: {
                isDarkMode: () => false,
                findElementStyle: (el: any) => has(el, 'Faded')
                    ? { opacity: 25, background: '#000000', color: '#000000', stroke: '#000000' }
                    : {},
                findRelationshipStyle: (rel: any) => has(rel, 'Faded')
                    ? { opacity: 25, color: '#000000' }
                    : {},
                getTitleForView: titleForView,
            },
            workspace: { getTerminologyFor: terminologyFor },
            diagram: undefined,
        });
        let xml: string | undefined;
        drawio.exportView(workspace.views[0], workspace, false, (result: any) => { xml = result; });
        const lines = (xml ?? '').split('\n');
        const lineFor = (match: string) => {
            const i = lines.findIndex(l => l.includes(match));
            return i >= 0 ? lines[i + 1] : '';
        };

        // opacity 25 blends 75% towards the light-mode canvas: #000000 -> #bfbfbf
        const faded = lineFor('c4Name="A"');
        expect(faded).toContain('fillColor=#bfbfbf');
        expect(faded).toContain('strokeColor=#bfbfbf');
        expect(faded).toContain('fontColor=#bfbfbf');
        // opacity 100 leaves the default colours untouched
        expect(lineFor('c4Name="B"')).toContain('fillColor=#ffffff');
        // relationships are washed the same way
        expect(lineFor('c4Description="uses"')).toContain('strokeColor=#bfbfbf');
    }, 120_000);

    it('draws the diagram title, description and metadata', async () => {
        const json = await generateDsl(`
workspace {
    model {
        a = softwareSystem "A"
    }
    views {
        systemLandscape "landscape" {
            title "Landscape title"
            description "Landscape description"
            include *
        }
        systemLandscape "plain" {
            include *
        }
        systemLandscape "hidden" {
            include *
            properties {
                "structurizr.title" "false"
                "structurizr.description" "false"
                "structurizr.metadata" "false"
            }
        }
    }
}
`);
        const workspace = makeWorkspace(json);
        const drawio = makeExporter(workspace);
        const metadataLabel = (key: string) => {
            const view = workspace.views.find((v: any) => v.key === key)!;
            let xml: string | undefined;
            drawio.exportView(view, workspace, false, (result: any) => { xml = result; });
            const line = (xml ?? '').split('\n').find(l => l.includes('strokeColor=none;fillColor=none')) ?? '';
            const m = line.match(/value="([^"]*)"/);
            return m ? decodeXml(m[1]) : '';
        };

        // the view title and description render in the bottom-left text cell
        const landscape = metadataLabel('landscape');
        expect(landscape).toContain('Landscape title');
        expect(landscape).toContain('Landscape description');

        // without an explicit title the view name is used
        expect(metadataLabel('plain')).toContain(json.views.systemLandscapeViews[1].name);

        // all three blocks can be switched off, leaving no text cell
        expect(metadataLabel('hidden')).toBe('');
    }, 120_000);

    it('names the group boundary type', async () => {
        const json = await generateFixture('groups-nested');
        const workspace = makeWorkspace(json);
        const drawio = makeExporter(workspace);
        const view = workspace.views.find((v: any) => v.type === 'SystemLandscape')!;
        const groups = drawio._collectBoundaries(view, workspace, false).filter((b: any) => b.isGroup);
        expect(groups.length).toBeGreaterThan(0);
        expect(groups.every((g: any) => g.c4Type === 'GroupScopeBoundary')).toBe(true);
    }, 120_000);
});
