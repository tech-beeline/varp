import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { EmptyFileSystem } from 'langium';
import { URI } from 'vscode-uri';
import { createC4Services } from './c4-module';
import { C4JsonGenerator } from './c4-json-generator';
import { isWorkspace } from '../generated/ast';

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
    const doc = services.shared.workspace.LangiumDocumentFactory.fromString(content, URI.parse('file:///groups.dsl'));
    services.shared.workspace.LangiumDocuments.addDocument(doc);
    await services.shared.workspace.DocumentBuilder.build([doc]);
    const root: any = doc.parseResult.value;
    const workspace = isWorkspace(root) ? root : root.workspaces[0];
    return new C4JsonGenerator(services).generate(workspace);
}

function loadExporter(structurizr: any): any {
    const code = readFileSync(resolve(__dirname, '../../js/structurizr-drawio.js'), 'utf8');
    return new Function('structurizr', code + '\nreturn structurizr.drawio;')(structurizr);
}

function makeExporter() {
    return loadExporter({
        ui: { isDarkMode: () => false, findElementStyle: () => ({}), findRelationshipStyle: () => ({}), getTitleForView: (v: any) => v.name || v.key },
        workspace: { getTerminologyFor: () => undefined },
        diagram: undefined,
    });
}

function makeWorkspace(json: any) {
    const elements = new Map<string, any>();
    const visit = (el: any, type: string) => {
        if (!el || typeof el !== 'object') return;
        el.type = type;
        if (el.id !== undefined) elements.set(String(el.id), el);
        for (const c of el.children ?? []) visit(c, 'DeploymentNode');
        for (const c of el.softwareSystemInstances ?? []) visit(c, 'SoftwareSystemInstance');
        for (const c of el.containerInstances ?? []) visit(c, 'ContainerInstance');
        for (const c of el.infrastructureNodes ?? []) visit(c, 'InfrastructureNode');
        for (const c of el.containers ?? []) visit(c, 'Container');
        for (const c of el.components ?? []) visit(c, 'Component');
    };
    for (const p of json.model?.people ?? []) visit(p, 'Person');
    for (const s of json.model?.softwareSystems ?? []) visit(s, 'SoftwareSystem');
    for (const d of json.model?.deploymentNodes ?? []) visit(d, 'DeploymentNode');
    for (const c of json.model?.customElements ?? []) visit(c, 'Custom');

    const views: any[] = [];
    for (const [key, type] of Object.entries({
        systemLandscapeViews: 'SystemLandscape', systemContextViews: 'SystemContext',
        containerViews: 'Container', componentViews: 'Component', deploymentViews: 'Deployment',
        dynamicViews: 'Dynamic',
    })) {
        for (const v of json.views?.[key] ?? []) views.push({ ...v, type });
    }
    return {
        model: json.model,
        findElementById: (id: any) => elements.get(String(id)),
        views,
    };
}

function groupRows(json: any, viewType = 'SystemLandscape') {
    const workspace = makeWorkspace(json);
    const drawio = makeExporter();
    const view = workspace.views.find((v: any) => v.type === viewType)!;
    return drawio._collectBoundaries(view, workspace, false)
        .filter((b: any) => b.isGroup)
        .map((b: any) => ({ id: b.id, name: b.name, minX: b.minX, minY: b.minY, maxX: b.maxX, maxY: b.maxY }));
}

describe('group boundaries match the SVG', () => {
    it('nests an inner frame inside its parent with a single margin', async () => {
        const json = await generateDsl(`
workspace {
    model {
        properties {
            "structurizr.groupSeparator" "/"
        }
        group "Outer" {
            group "Inner" {
                a = softwareSystem "A"
                b = softwareSystem "B"
            }
        }
    }
    views {
        systemLandscape "k" {
            include *
        }
    }
}
`);
        const groups = groupRows(json);
        const outer = groups.find((g: any) => g.name === 'Outer');
        const inner = groups.find((g: any) => g.name === 'Inner');
        expect(groups).toHaveLength(2);
        expect([inner.minX, inner.minY, inner.maxX, inner.maxY]).toEqual([475, 475, 1725, 877]);
        expect([outer.minX, outer.minY, outer.maxX, outer.maxY]).toEqual([450, 450, 1750, 954]);
    }, 120_000);

    it('emits each nested group exactly once', async () => {
        const json = await generateFixture('groups-nested');
        const groups = groupRows(json);
        const ids = groups.map((g: any) => g.id);
        expect(ids.length).toBe(new Set(ids).size);
    }, 120_000);

    it('keeps a flat group name whole when no separator is defined', async () => {
        const json = await generateDsl(`
workspace {
    model {
        group "A/B" {
            a = softwareSystem "A"
        }
    }
    views {
        systemLandscape "k" {
            include *
        }
    }
}
`);
        const groups = groupRows(json);
        expect(groups).toHaveLength(1);
        expect(groups[0].name).toBe('A/B');
    }, 120_000);
});
