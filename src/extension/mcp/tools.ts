import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { C4ModelSource } from './model';
import { flattenModel } from './model';

function text(result: unknown): CallToolResult {
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
async function resolveProject(source: C4ModelSource, uri?: string): Promise<string> {
    if (uri) {
        return uri;
    }
    const projects = await source.listProjects();
    return projects[0] ?? '';
}

export async function listProjectsHandler(source: C4ModelSource): Promise<CallToolResult> {
    const projects = await source.listProjects();
    return text({ projects });
}

export async function readProjectSummaryHandler(
    source: C4ModelSource,
    args: { uri?: string },
): Promise<CallToolResult> {
    const projectUri = await resolveProject(source, args.uri);
    const json = await source.getContent(projectUri);
    if (!json) {
        return text({ error: `No model found for ${projectUri}` });
    }
    const model = flattenModel(projectUri, json);
    const elementsByType: Record<string, number> = {};
    for (const e of model.elements) {
        elementsByType[e.type] = (elementsByType[e.type] ?? 0) + 1;
    }
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
): Promise<CallToolResult> {
    const projectUri = await resolveProject(source, args.uri);
    const json = await source.getContent(projectUri);
    if (!json) {
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
    return text({
        project: projectUri,
        results: matches.slice(0, 100).map(e => ({ id: e.id, name: e.name, type: e.type, tags: e.tags, path: e.path })),
        truncated,
    });
}

export async function readElementHandler(
    source: C4ModelSource,
    args: { id: string; uri?: string },
): Promise<CallToolResult> {
    const projectUri = await resolveProject(source, args.uri);
    const json = await source.getContent(projectUri);
    if (!json) {
        return text({ error: `No model found for ${projectUri}` });
    }
    const model = flattenModel(projectUri, json);
    const element = model.elements.find(e => e.id === args.id);
    if (!element) {
        return text({ error: `Element ${args.id} not found in ${projectUri}` });
    }
    const includedInViews = model.views
        .filter(v => v.elementIds.includes(args.id))
        .map(v => ({ key: v.key, type: v.type }));
    return text({ element, includedInViews });
}

/** Registers the read-only C4 model tools on the MCP server. */
export function registerTools(server: McpServer, source: C4ModelSource): void {
    server.registerTool(
        'list-projects',
        {
            title: 'List C4 projects',
            description: 'List all root workspace documents (projects) that currently have a resolved C4 model.',
            inputSchema: z.object({}),
        },
        async () => listProjectsHandler(source),
    );

    server.registerTool(
        'read-project-summary',
        {
            title: 'Read C4 project summary',
            description: 'Summary of a project: element counts by type, total relationships, and available views.',
            inputSchema: z.object({
                uri: z.string().optional().describe('Project (root workspace) URI. Defaults to the first available project.'),
            }),
        },
        async (args: { uri?: string }) => readProjectSummaryHandler(source, args),
    );

    server.registerTool(
        'search-element',
        {
            title: 'Search C4 elements',
            description: 'Search elements in a project by id, name, type or tags.',
            inputSchema: z.object({
                search: z.string().describe('Text to match against id, name, type and tags.'),
                uri: z.string().optional().describe('Project URI. Defaults to the first available project.'),
            }),
        },
        async (args: { search: string; uri?: string }) => searchElementHandler(source, args),
    );

    server.registerTool(
        'read-element',
        {
            title: 'Read C4 element',
            description: 'Full details of an element: attributes, outgoing relationships, and the views that include it.',
            inputSchema: z.object({
                id: z.string().describe('Element id (Structurizr id).'),
                uri: z.string().optional().describe('Project URI. Defaults to the first available project.'),
            }),
        },
        async (args: { id: string; uri?: string }) => readElementHandler(source, args),
    );
}
