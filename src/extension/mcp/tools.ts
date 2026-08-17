import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult, LoggingLevel } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { C4ModelSource } from './model';
import { flattenModel } from './model';

/** Logger abstraction fed into tool handlers; wired to MCP `logging` notifications. */
export type McpLogger = (level: LoggingLevel, data: unknown) => void;

export function text(result: unknown): CallToolResult {
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
}

/** Parses the JSON payload of a tool result (useful in tests). */
export function parseToolResult(result: CallToolResult): any {
    const content = result.content?.[0];
    if (content && 'text' in content && typeof content.text === 'string') {
        return JSON.parse(content.text);
    }
    return null;
}

/** Resolves the target project URI, defaulting to the first available project. */
export async function resolveProject(source: C4ModelSource, uri?: string): Promise<string> {
    if (uri) {
        return uri;
    }
    const projects = await source.listProjects();
    return projects[0] ?? '';
}

/**
 * Zod schema for the optional `uri` project argument on tools.
 *
 * Note: tool arguments have NO protocol-level completions. `completion/complete`
 * only supports prompt arguments (`ref/prompt`) and resource templates
 * (`ref/resource`) - see CompleteRequestParamsSchema in the MCP SDK. Project-URI
 * completions are therefore exposed via the prompts (`summarize-project`,
 * `explore-element`) and the `c4://project/{uri}` resource template instead.
 */
export function uriArgSchema() {
    return z.string().optional().describe('Project (root workspace) URI. Defaults to the first available project.');
}

export async function listProjectsHandler(source: C4ModelSource, logger?: McpLogger): Promise<CallToolResult> {
    logger?.('info', { tool: 'list-projects', event: 'start' });
    const projects = await source.listProjects();
    logger?.('info', { tool: 'list-projects', event: 'complete', projectCount: projects.length });
    return text({ projects });
}

export async function readProjectSummaryHandler(
    source: C4ModelSource,
    args: { uri?: string },
    logger?: McpLogger,
): Promise<CallToolResult> {
    logger?.('info', { tool: 'read-project-summary', event: 'start', uri: args.uri });
    const projectUri = await resolveProject(source, args.uri);
    const json = await source.getContent(projectUri);
    if (!json) {
        logger?.('warning', { tool: 'read-project-summary', event: 'no-model', projectUri });
        return text({ error: `No model found for ${projectUri}` });
    }
    const model = flattenModel(projectUri, json);
    const elementsByType: Record<string, number> = {};
    for (const e of model.elements) {
        elementsByType[e.type] = (elementsByType[e.type] ?? 0) + 1;
    }
    logger?.('info', { tool: 'read-project-summary', event: 'complete', projectUri, elementCount: model.elements.length });
    return text({
        project: model.project,
        elementCount: model.elements.length,
        elementsByType,
        relationshipCount: model.elements.reduce((n, e) => n + e.relationships.length, 0),
        viewCount: model.views.length,
        views: model.views.map(v => ({ key: v.key, type: v.type })),
    });
}

export async function searchElementHandler(
    source: C4ModelSource,
    args: { search: string; uri?: string },
    logger?: McpLogger,
): Promise<CallToolResult> {
    logger?.('info', { tool: 'search-element', event: 'start', search: args.search, uri: args.uri });
    const projectUri = await resolveProject(source, args.uri);
    const json = await source.getContent(projectUri);
    if (!json) {
        logger?.('warning', { tool: 'search-element', event: 'no-model', projectUri });
        return text({ error: `No model found for ${projectUri}` });
    }
    const model = flattenModel(projectUri, json);
    const q = args.search.toLowerCase();
    const matches = model.elements.filter(e =>
        e.id.toLowerCase().includes(q) ||
        e.name.toLowerCase().includes(q) ||
        e.type.toLowerCase().includes(q) ||
        e.tags.some(t => t.toLowerCase().includes(q)),
    );
    const truncated = matches.length > 100;
    logger?.('info', { tool: 'search-element', event: 'complete', projectUri, resultCount: Math.min(matches.length, 100), truncated });
    return text({
        project: projectUri,
        results: matches.slice(0, 100).map(e => ({ id: e.id, name: e.name, type: e.type, tags: e.tags, path: e.path })),
        truncated,
    });
}

export async function readElementHandler(
    source: C4ModelSource,
    args: { id: string; uri?: string },
    logger?: McpLogger,
): Promise<CallToolResult> {
    logger?.('info', { tool: 'read-element', event: 'start', id: args.id, uri: args.uri });
    const projectUri = await resolveProject(source, args.uri);
    const json = await source.getContent(projectUri);
    if (!json) {
        logger?.('warning', { tool: 'read-element', event: 'no-model', projectUri });
        return text({ error: `No model found for ${projectUri}` });
    }
    const model = flattenModel(projectUri, json);
    const element = model.elements.find(e => e.id === args.id);
    if (!element) {
        logger?.('warning', { tool: 'read-element', event: 'not-found', id: args.id });
        return text({ error: `Element ${args.id} not found in ${projectUri}` });
    }
    const includedInViews = model.views
        .filter(v => v.elementIds.includes(args.id))
        .map(v => ({ key: v.key, type: v.type }));
    logger?.('info', { tool: 'read-element', event: 'complete', id: args.id, includedInViewCount: includedInViews.length });
    return text({ element, includedInViews });
}

/** Registers the read-only C4 model tools on the MCP server. */
export function registerTools(server: McpServer, source: C4ModelSource): void {
    const logger: McpLogger = (level, data) => void server.sendLoggingMessage({ level, data });

    server.registerTool(
        'list-projects',
        {
            title: 'List C4 projects',
            description: 'List all root workspace documents (projects) that currently have a resolved C4 model.',
            inputSchema: z.object({}),
        },
        async () => listProjectsHandler(source, logger),
    );

    server.registerTool(
        'read-project-summary',
        {
            title: 'Read C4 project summary',
            description: 'Summary of a project: element counts by type, total relationships, and available views.',
            inputSchema: z.object({ uri: uriArgSchema() }),
        },
        async (args: { uri?: string }) => readProjectSummaryHandler(source, args, logger),
    );

    server.registerTool(
        'search-element',
        {
            title: 'Search C4 elements',
            description: 'Search elements in a project by id, name, type or tags.',
            inputSchema: z.object({
                search: z.string().describe('Text to match against id, name, type and tags.'),
                uri: uriArgSchema(),
            }),
        },
        async (args: { search: string; uri?: string }) => searchElementHandler(source, args, logger),
    );

    server.registerTool(
        'read-element',
        {
            title: 'Read C4 element',
            description: 'Full details of an element: attributes, outgoing relationships, and the views that include it.',
            inputSchema: z.object({
                id: z.string().describe('Element id (Structurizr id).'),
                uri: uriArgSchema(),
            }),
        },
        async (args: { id: string; uri?: string }) => readElementHandler(source, args, logger),
    );
}
