import { describe, expect, it } from 'vitest';
import type { C4ModelSource } from './model';
import { parseToolResult } from './tools';
import {
    findRelationshipPathsHandler, findRelationshipsHandler, queryByMetadataHandler,
    queryByTagPatternHandler, queryByTagsHandler, queryGraphHandler,
    queryIncomersGraphHandler, queryOutgoersGraphHandler,
} from './tools-graph';

const PROJECT_URI = 'file:///graph.dsl';

/** Small model with a clear hierarchy and a few relationships/tags/properties. */
function graphWorkspaceJson() {
    return {
        name: 'Graph',
        description: 'Graph fixture',
        model: {
            people: [{ id: 'p1', name: 'User', tags: 'Element,Person,external' }],
            softwareSystems: [
                {
                    id: 's1', name: 'System A', tags: 'Element,Software System,backend',
                    properties: { language: 'TypeScript', owner: 'Team A' },
                    relationships: [{ id: 'r-s1-c1', sourceId: 's1', destinationId: 'c1', description: 'Contains', tags: 'structural' }],
                    containers: [
                        {
                            id: 'c1', name: 'Web', tags: 'Element,Container',
                            properties: { language: 'TypeScript' },
                            relationships: [{ id: 'r-c1-c2', sourceId: 'c1', destinationId: 'c2', description: 'Calls', tags: 'HTTP' }],
                            components: [{ id: 'x1', name: 'UI', tags: 'Element,Component' }],
                        },
                        { id: 'c2', name: 'API', tags: 'Element,Container', properties: { language: 'Go', owner: 'Team B' } },
                    ],
                },
                { id: 's2', name: 'System B', tags: 'Element,Software System,frontend' },
            ],
        },
        views: {},
    };
}

function mockSource(model: any, projects: string[] = [PROJECT_URI]): C4ModelSource {
    return {
        listProjects: async () => projects,
        getContent: async (uri: string) => (uri === PROJECT_URI ? model : null),
    };
}

const source = mockSource(graphWorkspaceJson() as any);

describe('query-graph', () => {
    it('returns children, parent and siblings', async () => {
        const result = parseToolResult(await queryGraphHandler(source, { id: 'c1', mode: 'all' }));
        expect(result.error).toBeUndefined();
        expect(result.parent).toMatchObject({ id: 's1', name: 'System A' });
        expect(result.children.map((e: any) => e.id)).toEqual(['x1']);
        expect(result.siblings.map((e: any) => e.id)).toEqual(['c2']);
        expect(result.ancestors.map((e: any) => e.id)).toEqual(['s1']);
        expect(result.descendants.map((e: any) => e.id)).toEqual(['x1']);
    });

    it('returns incomers and outgoers', async () => {
        const result = parseToolResult(await queryGraphHandler(source, { id: 'c1', mode: 'incomers' }));
        expect(result.incomers.map((r: any) => r.relationship.sourceId)).toEqual(['s1']);
        const out = parseToolResult(await queryGraphHandler(source, { id: 'c1', mode: 'outgoers' }));
        expect(out.outgoers.map((r: any) => r.relationship.destinationId)).toEqual(['c2']);
        expect(out.outgoers[0].relationship.destinationName).toBe('API');
    });

    it('returns an error for an unknown element', async () => {
        const result = parseToolResult(await queryGraphHandler(source, { id: 'nope' }));
        expect(result.error).toBeTruthy();
    });
});

describe('query-incomers-graph / query-outgoers-graph', () => {
    it('traverses outgoing edges with names', async () => {
        const result = parseToolResult(await queryOutgoersGraphHandler(source, { id: 's1' }));
        expect(result.direction).toBe('out');
        const nodeIds = result.nodes.map((n: any) => n.id);
        expect(nodeIds).toContain('c1');
        expect(nodeIds).toContain('c2');
        expect(result.edges.some((e: any) => e.destinationId === 'c2' && e.destinationName === 'API')).toBe(true);
    });

    it('respects maxDepth', async () => {
        const result = parseToolResult(await queryOutgoersGraphHandler(source, { id: 's1', maxDepth: 1 }));
        const nodeIds = result.nodes.map((n: any) => n.id);
        expect(nodeIds).toContain('c1');
        expect(nodeIds).not.toContain('c2'); // c2 is two hops away
    });

    it('traverses incoming edges', async () => {
        const result = parseToolResult(await queryIncomersGraphHandler(source, { id: 'c2' }));
        const nodeIds = result.nodes.map((n: any) => n.id);
        expect(nodeIds).toContain('c1');
        expect(nodeIds).toContain('s1');
    });
});

describe('find-relationships', () => {
    it('returns all relationships', async () => {
        const result = parseToolResult(await findRelationshipsHandler(source, {}));
        expect(result.results).toHaveLength(2);
    });

    it('filters by source, destination and tag', async () => {
        const byDest = parseToolResult(await findRelationshipsHandler(source, { destinationId: 'c2' }));
        expect(byDest.results).toHaveLength(1);
        expect(byDest.results[0].sourceId).toBe('c1');

        const byTag = parseToolResult(await findRelationshipsHandler(source, { tag: 'http' }));
        expect(byTag.results).toHaveLength(1);
        expect(byTag.results[0].description).toBe('Calls');
    });
});

describe('find-relationship-paths', () => {
    it('finds a multi-hop path with includeIndirect', async () => {
        const result = parseToolResult(await findRelationshipPathsHandler(source, { sourceId: 's1', destinationId: 'c2' }));
        expect(result.paths).toHaveLength(1);
        expect(result.paths[0].map((r: any) => r.id)).toEqual(['r-s1-c1', 'r-c1-c2']);
    });

    it('returns no path for includeIndirect=false when not directly connected', async () => {
        const result = parseToolResult(await findRelationshipPathsHandler(source, { sourceId: 's1', destinationId: 'c2', includeIndirect: false }));
        expect(result.paths).toHaveLength(0);
    });

    it('returns a direct path with includeIndirect=false', async () => {
        const result = parseToolResult(await findRelationshipPathsHandler(source, { sourceId: 's1', destinationId: 'c1', includeIndirect: false }));
        expect(result.paths).toHaveLength(1);
        expect(result.paths[0].map((r: any) => r.id)).toEqual(['r-s1-c1']);
    });
});

describe('query-by-metadata', () => {
    it('matches by key presence', async () => {
        const result = parseToolResult(await queryByMetadataHandler(source, { key: 'owner' }));
        expect(result.results.map((e: any) => e.id).sort()).toEqual(['c2', 's1']);
    });

    it('matches by key+value with the equals operator', async () => {
        const result = parseToolResult(await queryByMetadataHandler(source, { key: 'language', value: 'Go' }));
        expect(result.results.map((e: any) => e.id)).toEqual(['c2']);
    });

    it('matches by value with the contains operator', async () => {
        const result = parseToolResult(await queryByMetadataHandler(source, { key: 'language', value: 'script', match: 'contains' }));
        expect(result.results.map((e: any) => e.id).sort()).toEqual(['c1', 's1']);
    });
});

describe('query-by-tags', () => {
    it('matches allOf / anyOf / noneOf', async () => {
        const all = parseToolResult(await queryByTagsHandler(source, { allOf: ['Element', 'Software System'] }));
        expect(all.results.map((e: any) => e.id).sort()).toEqual(['s1', 's2']);

        const any = parseToolResult(await queryByTagsHandler(source, { anyOf: ['backend'] }));
        expect(any.results.map((e: any) => e.id)).toEqual(['s1']);

        const none = parseToolResult(await queryByTagsHandler(source, { noneOf: ['backend'] }));
        expect(none.results.map((e: any) => e.id)).not.toContain('s1');
    });
});

describe('query-by-tag-pattern', () => {
    it('matches prefix and suffix', async () => {
        const prefix = parseToolResult(await queryByTagPatternHandler(source, { pattern: 'front', match: 'prefix' }));
        expect(prefix.results.map((e: any) => e.id)).toEqual(['s2']);

        const suffix = parseToolResult(await queryByTagPatternHandler(source, { pattern: 'end', match: 'suffix' }));
        expect(suffix.results.map((e: any) => e.id).sort()).toEqual(['s1', 's2']);
    });
});
