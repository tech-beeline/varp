import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { C4ModelSource } from './model';
import { elementDetail, flattenModel } from './model';
import type { McpLogger } from './tools';
import { resolveProject, text, uriArgSchema } from './tools';

/** Hard cap for the number of elements returned by batch-read-elements. */
const MAX_IDS = 100;

/**
 * Reads the details of several elements in a single call, reducing round-trips
 * versus calling `read-element` once per id. Not-found ids are reported in the
 * `missing` list and as individual `{ found: false }` result entries; duplicate
 * ids are resolved once and the response keeps the requested order.
 */
export async function batchReadElementsHandler(
    source: C4ModelSource,
    args: { ids: string[]; uri?: string },
    logger?: McpLogger,
): Promise<CallToolResult> {
    logger?.('info', { tool: 'batch-read-elements', event: 'start', idCount: args.ids.length, uri: args.uri });
    const projectUri = await resolveProject(source, args.uri);
    const json = await source.getContent(projectUri);
    if (!json) {
        logger?.('warning', { tool: 'batch-read-elements', event: 'no-model', projectUri });
        return text({ error: `No model found for ${projectUri}` });
    }
    const model = flattenModel(projectUri, json);

    const uniqueIds = [...new Set(args.ids)];
    const truncated = uniqueIds.length > MAX_IDS;
    const requested = uniqueIds.slice(0, MAX_IDS);

    const missing: string[] = [];
    const results: unknown[] = [];
    for (const id of requested) {
        const detail = elementDetail(model, id);
        if (!detail) {
            missing.push(id);
            results.push({ id, found: false, error: `Element ${id} not found in ${projectUri}` });
            continue;
        }
        results.push({ id, found: true, element: detail.element, includedInViews: detail.includedInViews });
    }

    logger?.('info', {
        tool: 'batch-read-elements',
        event: 'complete',
        projectUri,
        requested: requested.length,
        found: results.length - missing.length,
        missing: missing.length,
        truncated,
    });
    return text({
        project: projectUri,
        requested: requested.length,
        returned: results.length,
        truncated,
        missing,
        results,
    });
}

function scalarDiff(a: unknown, b: unknown): { a: unknown; b: unknown; same: boolean } {
    const aStr = a === undefined ? null : a;
    const bStr = b === undefined ? null : b;
    return { a: aStr, b: bStr, same: aStr === bStr };
}

function arrayDiff<T>(
    a: T[],
    b: T[],
    keyOf: (v: T) => string = (v) => String(v),
): { a: T[]; b: T[]; same: boolean; onlyInA: T[]; onlyInB: T[] } {
    const aKeys = new Set(a.map(keyOf));
    const bKeys = new Set(b.map(keyOf));
    return {
        a,
        b,
        same: a.length === b.length && a.every((v, i) => keyOf(v) === keyOf(b[i])),
        onlyInA: a.filter(v => !bKeys.has(keyOf(v))),
        onlyInB: b.filter(v => !aKeys.has(keyOf(v))),
    };
}

function sortRelationships(rels: { sourceId: string; destinationId: string }[]) {
    return [...rels].sort((x, y) => {
        return `${x.sourceId}>${x.destinationId}`.localeCompare(`${y.sourceId}>${y.destinationId}`);
    });
}

interface RelationshipKey {
    sourceId: string;
    destinationId: string;
    description?: string;
}

function relKey(r: RelationshipKey): string {
    return `${r.sourceId} -> ${r.destinationId}${r.description ? ' (' + r.description + ')' : ''}`;
}

/**
 * Compares two C4 elements side-by-side: base attributes (name, type,
 * description, technology), properties (metadata), tags and relationships.
 * Missing ids are reported in the `error`.
 */
export async function elementDiffHandler(
    source: C4ModelSource,
    args: { element1Id: string; element2Id: string; uri?: string },
    logger?: McpLogger,
): Promise<CallToolResult> {
    logger?.('info', { tool: 'element-diff', event: 'start', element1Id: args.element1Id, element2Id: args.element2Id, uri: args.uri });
    const projectUri = await resolveProject(source, args.uri);
    const json = await source.getContent(projectUri);
    if (!json) {
        logger?.('warning', { tool: 'element-diff', event: 'no-model', projectUri });
        return text({ error: `No model found for ${projectUri}` });
    }
    const model = flattenModel(projectUri, json);
    const a = model.elements.find(e => e.id === args.element1Id);
    const b = model.elements.find(e => e.id === args.element2Id);
    if (!a || !b) {
        const missing = [args.element1Id, args.element2Id].filter(id => !model.elements.find(e => e.id === id));
        logger?.('warning', { tool: 'element-diff', event: 'not-found', missing });
        return text({ error: `Element(s) not found in ${projectUri}: ${missing.join(', ')}` });
    }

    const properties = (key: string): string | undefined => (a?.properties ?? {})[key];

    const propertyKeys = new Set<string>([...(Object.keys(a.properties ?? {})), ...(Object.keys(b.properties ?? {}))]);
    const propertiesDiff = [...propertyKeys].map(key => ({
        key,
        ...scalarDiff(properties(key), (b.properties ?? {})[key]),
    }));

    const relationships = arrayDiff(
        sortRelationships(a.relationships),
        sortRelationships(b.relationships),
        relKey,
    );

    const detail = {
        project: projectUri,
        element1: { id: a.id, name: a.name, type: a.type },
        element2: { id: b.id, name: b.name, type: b.type },
        attributes: {
            name: scalarDiff(a.name, b.name),
            type: scalarDiff(a.type, b.type),
            description: scalarDiff(a.description, b.description),
            technology: scalarDiff(a.technology, b.technology),
        },
        properties: propertiesDiff,
        tags: arrayDiff(a.tags, b.tags),
        relationships,
    };
    logger?.('info', {
        tool: 'element-diff', event: 'complete',
        element1Id: a.id, element2Id: b.id,
        differentAttributes: Object.values(detail.attributes).some(d => !d.same),
        differentProperties: propertiesDiff.some(d => !d.same),
        differentTags: !detail.tags.same,
    });
    return text(detail);
}

/**
 * Compact summary of all descendants of an element: per-element metadata (only
 * the requested `metadataKeys`), tags and relationship counts, plus an overall
 * breakdown by element type. `maxDepth` limits how far down the containment
 * tree the traversal goes (1 = direct children only).
 */
export async function subgraphSummaryHandler(
    source: C4ModelSource,
    args: { elementId: string; uri?: string; maxDepth?: number; metadataKeys?: string[] },
    logger?: McpLogger,
): Promise<CallToolResult> {
    logger?.('info', { tool: 'subgraph-summary', event: 'start', elementId: args.elementId, uri: args.uri });
    const projectUri = await resolveProject(source, args.uri);
    const json = await source.getContent(projectUri);
    if (!json) {
        logger?.('warning', { tool: 'subgraph-summary', event: 'no-model', projectUri });
        return text({ error: `No model found for ${projectUri}` });
    }
    const model = flattenModel(projectUri, json);
    const root = model.elements.find(e => e.id === args.elementId);
    if (!root) {
        logger?.('warning', { tool: 'subgraph-summary', event: 'not-found', id: args.elementId });
        return text({ error: `Element ${args.elementId} not found in ${projectUri}` });
    }

    const maxDepth = Math.max(1, Math.min(args.maxDepth ?? 1, 10));
    const metadataKeys = new Set(args.metadataKeys ?? []);

    interface SummaryNode {
        id: string;
        name: string;
        type: string;
        tags: string[];
        outRelationships: number;
        inRelationships: number;
        metadata?: Record<string, string>;
        depth: number;
    }

    const nodes: SummaryNode[] = [];
    const byType: Record<string, number> = {};

    const collect = (el: McpElementPath, depth: number): void => {
        nodes.push({
            id: el.id,
            name: el.name,
            type: el.type,
            tags: el.tags,
            outRelationships: el.relationships.length,
            inRelationships: el.incomingRelationships.length,
            ...(metadataKeys.size > 0
                ? { metadata: pickKey(el.properties ?? {}, metadataKeys) }
                : {}),
            depth,
        });
        byType[el.type] = (byType[el.type] ?? 0) + 1;
        if (depth >= maxDepth) {
            return;
        }
        const children = model.elements.filter(
            e => e.path.length === el.path.length + 1 && pathPrefix(el.path, e.path),
        );
        for (const child of children) {
            collect(child, depth + 1);
        }
    };

    for (const child of model.elements.filter(
        e => e.path.length === root.path.length + 1 && pathPrefix(root.path, e.path),
    )) {
        collect(child, 1);
    }

    logger?.('info', { tool: 'subgraph-summary', event: 'complete', elementId: root.id, nodeCount: nodes.length, maxDepth, byType });
    return text({
        project: projectUri,
        root: { id: root.id, name: root.name, type: root.type },
        maxDepth,
        metadataKeys: [...metadataKeys],
        nodeCount: nodes.length,
        byType,
        nodes,
    });
}

function pathPrefix(path: string[], candidate: string[]): boolean {
    return path.every((part, i) => part === candidate[i]);
}

function pickKey(props: Record<string, string>, keys: Set<string>): Record<string, string> {
    const out: Record<string, string> = {};
    for (const key of keys) {
        if (props[key] !== undefined) {
            out[key] = props[key];
        }
    }
    return out;
}

interface McpElementPath {
    id: string;
    name: string;
    type: string;
    tags: string[];
    relationships: unknown[];
    incomingRelationships: unknown[];
    properties?: Record<string, string>;
    path: string[];
}

/** Registers the batch/compare tools (Phase 2d) on the MCP server. */
export function registerBatchTools(server: McpServer, source: C4ModelSource): void {
    const logger: McpLogger = (level, data) => void server.sendLoggingMessage({ level, data });

    server.registerTool(
        'batch-read-elements',
        {
            title: 'Batch read C4 elements',
            description: 'Read full details of multiple elements in a single call. Not-found ids are reported in `missing`.',
            inputSchema: z.object({
                ids: z.array(z.string()).min(1).max(MAX_IDS).describe('Element ids (Structurizr ids) to read.'),
                uri: uriArgSchema(),
            }),
        },
        async (args: { ids: string[]; uri?: string }) => batchReadElementsHandler(source, args, logger),
    );

    server.registerTool(
        'element-diff',
        {
            title: 'Compare two C4 elements',
            description: 'Side-by-side comparison of two elements: attributes, properties (metadata), tags and relationships.',
            inputSchema: z.object({
                element1Id: z.string().describe('First element id (Structurizr id).'),
                element2Id: z.string().describe('Second element id (Structurizr id).'),
                uri: uriArgSchema(),
            }),
        },
        async (args: { element1Id: string; element2Id: string; uri?: string }) =>
            elementDiffHandler(source, args, logger),
    );

    server.registerTool(
        'subgraph-summary',
        {
            title: 'Summarize a C4 element subgraph',
            description: 'Compact summary of all descendants of an element: per-element metadata (metadataKeys), tags, relationship counts and a breakdown by type.',
            inputSchema: z.object({
                elementId: z.string().describe('Root element id (Structurizr id).'),
                maxDepth: z.number().int().min(1).max(10).optional().describe('Maximum containment depth. Defaults to 1 (direct children).'),
                metadataKeys: z.array(z.string()).optional().describe('Property keys to include per element. Omit to exclude metadata.'),
                uri: uriArgSchema(),
            }),
        },
        async (args: { elementId: string; uri?: string; maxDepth?: number; metadataKeys?: string[] }) =>
            subgraphSummaryHandler(source, args, logger),
    );
}
