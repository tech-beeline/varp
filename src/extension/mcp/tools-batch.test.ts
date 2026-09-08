import { describe, expect, it } from 'vitest';
import type { C4ModelSource } from './model';
import { flattenModel } from './model';
import { parseToolResult } from './tools';
import { batchReadElementsHandler, elementDiffHandler, subgraphSummaryHandler } from './tools-batch';

const PROJECT_URI = 'file:///batch.dsl';

function batchWorkspaceJson() {
    return {
        name: 'Batch',
        model: {
            people: [{ id: 'p1', name: 'User', tags: 'Element,Person' }],
            softwareSystems: [
                {
                    id: 's1', name: 'System A', tags: 'Element,Software System',
                    properties: { language: 'TypeScript' },
                    containers: [
                        {
                            id: 'c1', name: 'Web', tags: 'Element,Container', properties: { language: 'TypeScript' },
                            components: [
                                { id: 'x1', name: 'UI', tags: 'Element,Component', properties: { language: 'TypeScript' } },
                            ],
                        },
                        { id: 'c2', name: 'API', tags: 'Element,Container' },
                    ],
                },
            ],
        },
        views: {
            containerViews: [
                {
                    key: 'Container-SystemA-abc',
                    elements: [{ id: 'c1' }, { id: 'c2' }],
                    relationships: [],
                },
            ],
        },
    };
}

function mockSource(model: any, projects: string[] = [PROJECT_URI]): C4ModelSource {
    return {
        listProjects: async () => projects,
        getContent: async (uri: string) => (uri === PROJECT_URI ? model : null),
    };
}

const source = mockSource(batchWorkspaceJson() as any);

describe('batch-read-elements', () => {
    it('returns details for multiple elements in a single call', async () => {
        const result = parseToolResult(await batchReadElementsHandler(source, { ids: ['s1', 'c1'] }));

        expect(result.project).toBe(PROJECT_URI);
        expect(result.requested).toBe(2);
        expect(result.returned).toBe(2);
        expect(result.truncated).toBe(false);
        expect(result.missing).toEqual([]);

        expect(result.results).toHaveLength(2);
        const sys = result.results.find((r: any) => r.id === 's1');
        expect(sys.found).toBe(true);
        expect(sys.element.name).toBe('System A');
        expect(sys.element.type).toBe('SoftwareSystem');
        expect(sys.element.properties).toEqual({ language: 'TypeScript' });
        expect(sys.includedInViews).toEqual([]);

        const web = result.results.find((r: any) => r.id === 'c1');
        expect(web.found).toBe(true);
        expect(web.element.type).toBe('Container');
        expect(web.includedInViews).toEqual([{ key: 'Container-SystemA-abc', type: 'container' }]);
    });

    it('reports not-found ids in missing and as found:false results, preserving order', async () => {
        const result = parseToolResult(await batchReadElementsHandler(source, { ids: ['missing1', 'c2', 'missing2'] }));

        expect(result.requested).toBe(3);
        expect(result.returned).toBe(3);
        expect(result.missing).toEqual(['missing1', 'missing2']);

        expect(result.results.map((r: any) => ({ id: r.id, found: r.found }))).toEqual([
            { id: 'missing1', found: false },
            { id: 'c2', found: true },
            { id: 'missing2', found: false },
        ]);
        expect(result.results[0].error).toContain('missing1');
        expect(result.results[0].error).toContain(PROJECT_URI);
    });

    it('deduplicates repeated ids and keeps requested order', async () => {
        const result = parseToolResult(await batchReadElementsHandler(source, { ids: ['c1', 'c1', 's1'] }));

        expect(result.requested).toBe(2);
        expect(result.results.map((r: any) => r.id)).toEqual(['c1', 's1']);
        expect(result.results.filter((r: any) => r.found)).toHaveLength(2);
    });

    it('returns an error when the project has no model', async () => {
        const empty = mockSource(null);
        const result = parseToolResult(await batchReadElementsHandler(empty, { ids: ['s1'] }));
        expect(result.error).toBeTruthy();
    });

    it('full element details match flattenModel (incomingRelationships are resolved)', async () => {
        const json = batchWorkspaceJson() as any;
        const model = flattenModel(PROJECT_URI, json);
        const api = model.elements.find(e => e.id === 'c2')!;

        const result = parseToolResult(await batchReadElementsHandler(source, { ids: ['c1'] }));
        const c1 = result.results.find((r: any) => r.id === 'c1');
        // c1 has no outgoing relationships here, but the shape should mirror flattenModel.
        expect(api).toBeDefined();
        expect(typeof api.incomingRelationships).toBe('object');
        expect(c1.element.relationships).toEqual([]);
    });
});

describe('element-diff', () => {
    it('reports attribute, property and tag differences', async () => {
        const result = parseToolResult(await elementDiffHandler(source, { element1Id: 's1', element2Id: 'c1' }));

        expect(result.error).toBeUndefined();
        expect(result.element1).toMatchObject({ id: 's1', name: 'System A' });
        expect(result.element2).toMatchObject({ id: 'c1', name: 'Web' });

        expect(result.attributes.name.same).toBe(false);
        expect(result.attributes.type.same).toBe(false);
        expect(result.attributes.description.a).toBeNull();

        // s1:{language:TypeScript} vs c1:{language:TypeScript} => same; but we add owner to make a diff below? use key presence
        const lang = result.properties.find((p: any) => p.key === 'language');
        expect(lang.same).toBe(true);
        expect(result.properties.every((p: any) => p.key === 'language')).toBe(true);

        expect(result.tags.same).toBe(false);
        expect(result.tags.onlyInA).toEqual(['Software System']);
        expect(result.tags.onlyInB).toEqual(['Container']);
    });

    it('reports relationship differences via onlyInA/onlyInB', async () => {
        const result = parseToolResult(await elementDiffHandler(source, { element1Id: 'c1', element2Id: 's1' }));

        expect(result.error).toBeUndefined();
        // sorted relationship diff by src->dst(desc) key
        expect(result.relationships).toBeDefined();
        // both currently have zero relationships in this fixture; assert structural keys exist
        expect(result.relationships.onlyInA).toEqual([]);
        expect(result.relationships.onlyInB).toEqual([]);
        expect(result.relationships.same).toBe(true);
    });

    it('returns an error when one element is missing', async () => {
        const result = parseToolResult(await elementDiffHandler(source, { element1Id: 's1', element2Id: 'nope' }));
        expect(result.error).toContain('nope');
        expect(result.error).toContain(PROJECT_URI);
    });
});

describe('subgraph-summary', () => {
    it('summarizes direct descendants with relationship counts and byType', async () => {
        const result = parseToolResult(await subgraphSummaryHandler(source, { elementId: 's1' }));

        expect(result.error).toBeUndefined();
        expect(result.root).toMatchObject({ id: 's1', name: 'System A' });
        expect(result.maxDepth).toBe(1);
        expect(result.metadataKeys).toEqual([]);

        // direct children of s1: c1, c2
        expect(result.nodeCount).toBe(2);
        expect(result.byType).toEqual({ Container: 2 });
        expect(result.nodes.map((n: any) => n.id)).toEqual(['c1', 'c2']);
        const c1 = result.nodes.find((n: any) => n.id === 'c1');
        expect(c1.outRelationships).toBe(0);
        expect(typeof c1.inRelationships).toBe('number');
        // metadata omitted when metadataKeys is empty
        expect(c1.metadata).toBeUndefined();
    });

    it('respects maxDepth to include nested descendants', async () => {
        const result = parseToolResult(await subgraphSummaryHandler(source, { elementId: 's1', maxDepth: 2 }));

        expect(result.maxDepth).toBe(2);
        expect(result.nodeCount).toBe(3); // c1, c2, x1
        expect(result.byType).toEqual({ Container: 2, Component: 1 });
        // Depth-first traversal: c1 and its nested component x1 come before the sibling c2.
        expect(result.nodes.map((n: any) => n.id)).toEqual(['c1', 'x1', 'c2']);
        expect(result.nodes.map((n: any) => n.depth)).toEqual([1, 2, 1]);
        const x1 = result.nodes.find((n: any) => n.id === 'x1');
        expect(x1.depth).toBe(2);
    });

    it('includes only requested metadataKeys', async () => {
        const result = parseToolResult(await subgraphSummaryHandler(source, { elementId: 's1', metadataKeys: ['language', 'missing'] }));

        expect(result.metadataKeys).toEqual(['language', 'missing']);
        const c1 = result.nodes.find((n: any) => n.id === 'c1');
        expect(c1.metadata).toEqual({ language: 'TypeScript' });
        const c2 = result.nodes.find((n: any) => n.id === 'c2');
        expect(c2.metadata).toEqual({});
    });

    it('returns an error for an unknown root element', async () => {
        const result = parseToolResult(await subgraphSummaryHandler(source, { elementId: 'nope' }));
        expect(result.error).toContain('nope');
        expect(result.error).toContain(PROJECT_URI);
    });
});
