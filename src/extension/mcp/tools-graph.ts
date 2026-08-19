import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { C4ModelSource, McpElement, McpRelationship } from './model';
import { flattenModel } from './model';
import {
    ancestorsOf, buildModelIndex, childrenOf, descendantsOf, directIncomers, directOutgoers,
    parentOf, siblingsOf, type ModelIndex,
} from './model-index';
import type { McpLogger } from './tools';
import { resolveProject, text, uriArgSchema } from './tools';

const SUMMARY_FIELDS = ['id', 'name', 'type', 'path'] as const;
const summary = (e: McpElement) => ({
    id: e.id,
    name: e.name,
    type: e.type,
    path: e.path,
});

const relWithNames = (index: ModelIndex, r: McpRelationship) => ({
    id: r.id,
    sourceId: r.sourceId,
    sourceName: index.elementById.get(r.sourceId)?.name,
    destinationId: r.destinationId,
    destinationName: index.elementById.get(r.destinationId)?.name,
    description: r.description,
    tags: r.tags,
});

/** Loads a project, flattens it and builds the lookup index. */
async function loadModel(
    source: C4ModelSource,
    uri: string | undefined,
    tool: string,
    logger?: McpLogger,
): Promise<{ projectUri: string; model: ReturnType<typeof flattenModel>; index: ModelIndex } | null> {
    const projectUri = await resolveProject(source, uri);
    const json = await source.getContent(projectUri);
    if (!json) {
        logger?.('warning', { tool, event: 'no-model', projectUri });
        return null;
    }
    const model = flattenModel(projectUri, json);
    return { projectUri, model, index: buildModelIndex(model) };
}

const notFound = (tool: string, id: string, projectUri: string): CallToolResult =>
    text({ error: `Element ${id} not found in ${projectUri}` });

/**
 * Queries the neighbourhood of an element: ancestors, descendants, siblings,
 * children, parent, and/or direct incoming/outgoing relationships.
 */
export async function queryGraphHandler(
    source: C4ModelSource,
    args: {
        id: string;
        uri?: string;
        mode?: 'ancestors' | 'descendants' | 'siblings' | 'children' | 'parent' | 'incomers' | 'outgoers' | 'all';
    },
    logger?: McpLogger,
): Promise<CallToolResult> {
    logger?.('info', { tool: 'query-graph', event: 'start', id: args.id, mode: args.mode, uri: args.uri });
    const loaded = await loadModel(source, args.uri, 'query-graph', logger);
    if (!loaded) {
        return text({ error: `No model found for ${args.uri ?? '(default project)'}` });
    }
    const { projectUri, index } = loaded;
    const el = index.elementById.get(args.id);
    if (!el) {
        logger?.('warning', { tool: 'query-graph', event: 'not-found', id: args.id });
        return notFound('query-graph', args.id, projectUri);
    }

    const mode = args.mode ?? 'all';
    const pick = (m: string) => mode === 'all' || mode === m;
    const result: Record<string, unknown> = {
        project: projectUri,
        id: args.id,
        name: el.name,
        type: el.type,
        mode,
    };
    if (pick('parent')) {
        const p = parentOf(index, args.id);
        result.parent = p ? summary(p) : null;
    }
    if (pick('children')) result.children = childrenOf(index, args.id).map(summary);
    if (pick('siblings')) result.siblings = siblingsOf(index, args.id).map(summary);
    if (pick('ancestors')) result.ancestors = ancestorsOf(index, args.id).map(summary);
    if (pick('descendants')) result.descendants = descendantsOf(index, args.id).map(summary);
    if (pick('incomers')) result.incomers = directIncomers(index, args.id).map(({ element, relationship }) => ({
        element: summary(element), relationship: relWithNames(index, relationship),
    }));
    if (pick('outgoers')) result.outgoers = directOutgoers(index, args.id).map(({ element, relationship }) => ({
        element: summary(element), relationship: relWithNames(index, relationship),
    }));

    logger?.('info', { tool: 'query-graph', event: 'complete', id: args.id, mode });
    return text(result);
}

function traverseGraph(
    index: ModelIndex,
    startId: string,
    direction: 'in' | 'out',
    maxDepth: number,
    maxNodes: number,
): { nodes: { id: string; name: string; type: string; path: string[]; depth: number }[]; edges: (McpRelationship & { depth: number })[] } {
    const start = index.elementById.get(startId);
    const nodes: { id: string; name: string; type: string; path: string[]; depth: number }[] = [];
    const edges: (McpRelationship & { depth: number })[] = [];
    if (!start) {
        return { nodes, edges };
    }
    const visited = new Set<string>([startId]);
    nodes.push({ ...summary(start), depth: 0 });
    const queue: { id: string; depth: number }[] = [{ id: startId, depth: 0 }];
    outer:
    while (queue.length > 0) {
        const cur = queue.shift()!;
        if (cur.depth >= maxDepth) {
            continue;
        }
        const rels = direction === 'in' ? directIncomers(index, cur.id) : directOutgoers(index, cur.id);
        for (const { element, relationship } of rels) {
            if (nodes.length >= maxNodes) {
                break outer;
            }
            edges.push({ ...relationship, depth: cur.depth + 1 });
            if (!visited.has(element.id)) {
                visited.add(element.id);
                nodes.push({ ...summary(element), depth: cur.depth + 1 });
                queue.push({ id: element.id, depth: cur.depth + 1 });
            }
        }
    }
    return { nodes, edges };
}

function graphToolHandler(direction: 'in' | 'out') {
    return async (
        source: C4ModelSource,
        args: { id: string; uri?: string; maxDepth?: number; maxNodes?: number },
        logger?: McpLogger,
    ): Promise<CallToolResult> => {
        const tool = direction === 'in' ? 'query-incomers-graph' : 'query-outgoers-graph';
        logger?.('info', { tool, event: 'start', id: args.id, uri: args.uri });
        const loaded = await loadModel(source, args.uri, tool, logger);
        if (!loaded) {
            return text({ error: `No model found for ${args.uri ?? '(default project)'}` });
        }
        const { projectUri, index } = loaded;
        if (!index.elementById.has(args.id)) {
            logger?.('warning', { tool, event: 'not-found', id: args.id });
            return notFound(tool, args.id, projectUri);
        }
        const maxDepth = Math.max(1, Math.min(args.maxDepth ?? 3, 10));
        const maxNodes = Math.max(1, Math.min(args.maxNodes ?? 50, 500));
        const graph = traverseGraph(index, args.id, direction, maxDepth, maxNodes);
        logger?.('info', { tool, event: 'complete', id: args.id, nodeCount: graph.nodes.length, edgeCount: graph.edges.length });
        return text({
            project: projectUri,
            id: args.id,
            direction,
            maxDepth,
            maxNodes,
            truncated: graph.nodes.length >= maxNodes,
            nodes: graph.nodes,
            edges: graph.edges.map(e => relWithNames(index, e)),
        });
    };
}

export const queryIncomersGraphHandler = graphToolHandler('in');
export const queryOutgoersGraphHandler = graphToolHandler('out');

/**
 * Finds model relationships matching an optional source, destination and/or tag.
 */
export async function findRelationshipsHandler(
    source: C4ModelSource,
    args: { uri?: string; sourceId?: string; destinationId?: string; tag?: string },
    logger?: McpLogger,
): Promise<CallToolResult> {
    logger?.('info', { tool: 'find-relationships', event: 'start', ...args });
    const loaded = await loadModel(source, args.uri, 'find-relationships', logger);
    if (!loaded) {
        return text({ error: `No model found for ${args.uri ?? '(default project)'}` });
    }
    const { projectUri, index, model } = loaded;
    const results: { id?: string; sourceId: string; sourceName?: string; destinationId: string; destinationName?: string; description?: string; tags: string[] }[] = [];
    const tag = args.tag?.toLowerCase();
    for (const e of model.elements) {
        for (const r of e.relationships) {
            if (args.sourceId && r.sourceId !== args.sourceId) continue;
            if (args.destinationId && r.destinationId !== args.destinationId) continue;
            if (tag && !r.tags.some(t => t.toLowerCase().includes(tag))) continue;
            results.push(relWithNames(index, r));
        }
    }
    logger?.('info', { tool: 'find-relationships', event: 'complete', resultCount: results.length });
    return text({ project: projectUri, results });
}

/**
 * Finds paths (sequences of relationships) between two elements via BFS.
 * With `includeIndirect=false` only a direct relationship is returned.
 */
export async function findRelationshipPathsHandler(
    source: C4ModelSource,
    args: { sourceId: string; destinationId: string; uri?: string; maxDepth?: number; includeIndirect?: boolean },
    logger?: McpLogger,
): Promise<CallToolResult> {
    logger?.('info', { tool: 'find-relationship-paths', event: 'start', ...args });
    const loaded = await loadModel(source, args.uri, 'find-relationship-paths', logger);
    if (!loaded) {
        return text({ error: `No model found for ${args.uri ?? '(default project)'}` });
    }
    const { projectUri, index } = loaded;
    const maxDepth = Math.max(1, Math.min(args.maxDepth ?? 5, 10));
    const includeIndirect = args.includeIndirect ?? true;

    const paths: McpRelationship[][] = [];
    const visited = new Set<string>([args.sourceId]);
    const walk = (current: string, path: McpRelationship[]): void => {
        if (path.length >= maxDepth) {
            return;
        }
        for (const r of index.outgoers.get(current) ?? []) {
            if (visited.has(r.destinationId)) {
                continue;
            }
            path.push(r);
            if (r.destinationId === args.destinationId) {
                paths.push([...path]);
            } else {
                visited.add(r.destinationId);
                walk(r.destinationId, path);
                visited.delete(r.destinationId);
            }
            path.pop();
            if (paths.length >= 50) {
                return;
            }
        }
    };
    walk(args.sourceId, []);

    const filtered = includeIndirect ? paths : paths.filter(p => p.length <= 1);
    const resultPaths = filtered.map(path => path.map(r => relWithNames(index, r)));
    logger?.('info', { tool: 'find-relationship-paths', event: 'complete', pathCount: resultPaths.length });
    return text({
        project: projectUri,
        sourceId: args.sourceId,
        destinationId: args.destinationId,
        maxDepth,
        includeIndirect,
        paths: resultPaths,
    });
}

/** Match operator for metadata / tag queries. */
const MATCH_OP = z.enum(['equals', 'contains', 'starts', 'ends', 'prefix', 'suffix']);

function applyMatch(value: string, pattern: string, match: string): boolean {
    switch (match) {
        case 'contains': return value.toLowerCase().includes(pattern.toLowerCase());
        case 'starts': case 'prefix': return value.toLowerCase().startsWith(pattern.toLowerCase());
        case 'ends': case 'suffix': return value.toLowerCase().endsWith(pattern.toLowerCase());
        case 'equals': default: return value.toLowerCase() === pattern.toLowerCase();
    }
}

/**
 * Queries elements by their properties (Structurizr metadata). With `key` only the
 * presence of the property is matched; with `key`+`value` the value is matched by
 * the given operator. An optional `type` narrows the element type.
 */
export async function queryByMetadataHandler(
    source: C4ModelSource,
    args: { uri?: string; type?: string; key: string; value?: string; match?: string },
    logger?: McpLogger,
): Promise<CallToolResult> {
    logger?.('info', { tool: 'query-by-metadata', event: 'start', ...args });
    const loaded = await loadModel(source, args.uri, 'query-by-metadata', logger);
    if (!loaded) {
        return text({ error: `No model found for ${args.uri ?? '(default project)'}` });
    }
    const { projectUri, model } = loaded;
    const match = args.match ?? 'equals';
    const results = model.elements.filter(e => {
        if (args.type && e.type !== args.type) return false;
        const properties = e.properties ?? {};
        const value = properties[args.key];
        if (value === undefined) return false;
        if (args.value === undefined) return true;
        return applyMatch(value, args.value, match);
    }).map(e => ({ id: e.id, name: e.name, type: e.type, path: e.path, properties: e.properties }));
    logger?.('info', { tool: 'query-by-metadata', event: 'complete', resultCount: results.length });
    return text({ project: projectUri, results });
}

/**
 * Queries elements by their tags: allOf (must have every tag), anyOf (at least
 * one), noneOf (must have none). Matching is exact on the tag value.
 */
export async function queryByTagsHandler(
    source: C4ModelSource,
    args: { uri?: string; allOf?: string[]; anyOf?: string[]; noneOf?: string[] },
    logger?: McpLogger,
): Promise<CallToolResult> {
    logger?.('info', { tool: 'query-by-tags', event: 'start', ...args });
    const loaded = await loadModel(source, args.uri, 'query-by-tags', logger);
    if (!loaded) {
        return text({ error: `No model found for ${args.uri ?? '(default project)'}` });
    }
    const { projectUri, model } = loaded;
    const allOf = (args.allOf ?? []).map(t => t.toLowerCase());
    const anyOf = (args.anyOf ?? []).map(t => t.toLowerCase());
    const noneOf = (args.noneOf ?? []).map(t => t.toLowerCase());
    const results = model.elements.filter(e => {
        const tags = e.tags.map(t => t.toLowerCase());
        if (allOf.length > 0 && !allOf.every(t => tags.includes(t))) return false;
        if (anyOf.length > 0 && !anyOf.some(t => tags.includes(t))) return false;
        if (noneOf.some(t => tags.includes(t))) return false;
        return true;
    }).map(e => ({ id: e.id, name: e.name, type: e.type, tags: e.tags, path: e.path }));
    logger?.('info', { tool: 'query-by-tags', event: 'complete', resultCount: results.length });
    return text({ project: projectUri, results });
}

/**
 * Queries elements by a tag pattern: prefix, contains or suffix match on any tag.
 */
export async function queryByTagPatternHandler(
    source: C4ModelSource,
    args: { uri?: string; pattern: string; match?: string },
    logger?: McpLogger,
): Promise<CallToolResult> {
    logger?.('info', { tool: 'query-by-tag-pattern', event: 'start', ...args });
    const loaded = await loadModel(source, args.uri, 'query-by-tag-pattern', logger);
    if (!loaded) {
        return text({ error: `No model found for ${args.uri ?? '(default project)'}` });
    }
    const { projectUri, model } = loaded;
    const match = args.match ?? 'contains';
    const results = model.elements.filter(e =>
        e.tags.some(t => applyMatch(t, args.pattern, match)),
    ).map(e => ({ id: e.id, name: e.name, type: e.type, tags: e.tags, path: e.path }));
    logger?.('info', { tool: 'query-by-tag-pattern', event: 'complete', resultCount: results.length });
    return text({ project: projectUri, results });
}

/** Registers the Phase 2b graph/query tools on the MCP server. */
export function registerGraphTools(server: McpServer, source: C4ModelSource): void {
    const logger: McpLogger = (level, data) => void server.sendLoggingMessage({ level, data });

    server.registerTool(
        'query-graph',
        {
            title: 'Query C4 element graph',
            description: 'Neighbourhood of an element: ancestors, descendants, siblings, children, parent and/or direct incoming/outgoing relationships.',
            inputSchema: z.object({
                id: z.string().describe('Element id (Structurizr id).'),
                mode: z.enum(['ancestors', 'descendants', 'siblings', 'children', 'parent', 'incomers', 'outgoers', 'all'])
                    .optional().describe('Which parts of the neighbourhood to return. Defaults to all.'),
                uri: uriArgSchema(),
            }),
        },
        async (args: { id: string; uri?: string; mode?: 'ancestors' | 'descendants' | 'siblings' | 'children' | 'parent' | 'incomers' | 'outgoers' | 'all' }) =>
            queryGraphHandler(source, args, logger),
    );

    server.registerTool(
        'query-incomers-graph',
        {
            title: 'Query C4 incoming graph',
            description: 'Recursive graph of elements that (directly or transitively) depend on the given element, up to a depth/node cap.',
            inputSchema: z.object({
                id: z.string().describe('Element id (Structurizr id).'),
                maxDepth: z.number().int().min(1).max(10).optional().describe('Maximum traversal depth. Defaults to 3.'),
                maxNodes: z.number().int().min(1).max(500).optional().describe('Maximum number of nodes. Defaults to 50.'),
                uri: uriArgSchema(),
            }),
        },
        async (args: { id: string; uri?: string; maxDepth?: number; maxNodes?: number }) =>
            queryIncomersGraphHandler(source, args, logger),
    );

    server.registerTool(
        'query-outgoers-graph',
        {
            title: 'Query C4 outgoing graph',
            description: 'Recursive graph of elements the given element (directly or transitively) depends on, up to a depth/node cap.',
            inputSchema: z.object({
                id: z.string().describe('Element id (Structurizr id).'),
                maxDepth: z.number().int().min(1).max(10).optional().describe('Maximum traversal depth. Defaults to 3.'),
                maxNodes: z.number().int().min(1).max(500).optional().describe('Maximum number of nodes. Defaults to 50.'),
                uri: uriArgSchema(),
            }),
        },
        async (args: { id: string; uri?: string; maxDepth?: number; maxNodes?: number }) =>
            queryOutgoersGraphHandler(source, args, logger),
    );

    server.registerTool(
        'find-relationships',
        {
            title: 'Find C4 relationships',
            description: 'Find model relationships by optional source, destination and/or tag.',
            inputSchema: z.object({
                sourceId: z.string().optional().describe('Restrict to relationships with this source element id.'),
                destinationId: z.string().optional().describe('Restrict to relationships with this destination element id.'),
                tag: z.string().optional().describe('Restrict to relationships having a tag containing this text (case-insensitive).'),
                uri: uriArgSchema(),
            }),
        },
        async (args: { uri?: string; sourceId?: string; destinationId?: string; tag?: string }) =>
            findRelationshipsHandler(source, args, logger),
    );

    server.registerTool(
        'find-relationship-paths',
        {
            title: 'Find C4 relationship paths',
            description: 'Find paths (sequences of relationships) between two elements via BFS. With includeIndirect=false only a direct relationship is returned.',
            inputSchema: z.object({
                sourceId: z.string().describe('Source element id.'),
                destinationId: z.string().describe('Destination element id.'),
                maxDepth: z.number().int().min(1).max(10).optional().describe('Maximum path length. Defaults to 5.'),
                includeIndirect: z.boolean().optional().describe('Allow multi-hop paths. Defaults to true.'),
                uri: uriArgSchema(),
            }),
        },
        async (args: { sourceId: string; destinationId: string; uri?: string; maxDepth?: number; includeIndirect?: boolean }) =>
            findRelationshipPathsHandler(source, args, logger),
    );

    server.registerTool(
        'query-by-metadata',
        {
            title: 'Query C4 elements by metadata',
            description: 'Query elements by a property (key/value). With only key the presence is matched; with key+value the value is matched by the operator.',
            inputSchema: z.object({
                key: z.string().describe('Property key.'),
                value: z.string().optional().describe('Property value to match. Omit to match by key presence.'),
                match: MATCH_OP.optional().describe('Value match operator. Defaults to equals.'),
                type: z.string().optional().describe('Restrict to this element type (e.g. SoftwareSystem, Container).'),
                uri: uriArgSchema(),
            }),
        },
        async (args: { uri?: string; type?: string; key: string; value?: string; match?: string }) =>
            queryByMetadataHandler(source, args, logger),
    );

    server.registerTool(
        'query-by-tags',
        {
            title: 'Query C4 elements by tags',
            description: 'Query elements by tags: allOf (must have every tag), anyOf (at least one), noneOf (must have none).',
            inputSchema: z.object({
                allOf: z.array(z.string()).optional().describe('Tags that must all be present.'),
                anyOf: z.array(z.string()).optional().describe('Tags where at least one must be present.'),
                noneOf: z.array(z.string()).optional().describe('Tags that must all be absent.'),
                uri: uriArgSchema(),
            }),
        },
        async (args: { uri?: string; allOf?: string[]; anyOf?: string[]; noneOf?: string[] }) =>
            queryByTagsHandler(source, args, logger),
    );

    server.registerTool(
        'query-by-tag-pattern',
        {
            title: 'Query C4 elements by tag pattern',
            description: 'Query elements whose any tag matches a pattern by prefix, contains or suffix.',
            inputSchema: z.object({
                pattern: z.string().describe('Tag pattern to match.'),
                match: z.enum(['prefix', 'contains', 'suffix']).optional().describe('Match operator. Defaults to contains.'),
                uri: uriArgSchema(),
            }),
        },
        async (args: { uri?: string; pattern: string; match?: string }) =>
            queryByTagPatternHandler(source, args, logger),
    );
}
