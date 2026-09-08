import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { C4ModelSource, McpView } from './model';
import { flattenModel } from './model';
import type { McpLogger } from './tools';
import { resolveProject, text, uriArgSchema } from './tools';

/** Supported view types, matching the Structurizr renderer buckets. */
const VIEW_TYPES = [
    'systemLandscape',
    'systemContext',
    'container',
    'component',
    'deployment',
    'dynamic',
    'filtered',
    'custom',
] as const;

/**
 * Lists all views of a project as a compact catalog: per-view key/type/title/
 * description plus element and relationship counts, and an aggregate `byType`
 * breakdown. An optional `type` filter narrows the returned views.
 */
export async function listViewsHandler(
    source: C4ModelSource,
    args: { uri?: string; type?: string },
    logger?: McpLogger,
): Promise<CallToolResult> {
    logger?.('info', { tool: 'list-views', event: 'start', type: args.type, uri: args.uri });
    const projectUri = await resolveProject(source, args.uri);
    const json = await source.getContent(projectUri);
    if (!json) {
        logger?.('warning', { tool: 'list-views', event: 'no-model', projectUri });
        return text({ error: `No model found for ${projectUri}` });
    }
    const model = flattenModel(projectUri, json);

    const all = model.views;
    const requestedType = args.type?.toLowerCase();
    const filtered = requestedType ? all.filter(v => v.type.toLowerCase() === requestedType) : [...all];
    const byType: Record<string, number> = {};
    for (const v of filtered) {
        byType[v.type] = (byType[v.type] ?? 0) + 1;
    }
    const views: {
        key: string;
        type: string;
        title?: string;
        description?: string;
        elementCount: number;
        relationshipCount: number;
    }[] = filtered.map((v: McpView) => ({
        key: v.key,
        type: v.type,
        title: v.title,
        description: v.description,
        elementCount: v.elementIds.length,
        relationshipCount: v.relationships.length,
    }));

    logger?.('info', { tool: 'list-views', event: 'complete', projectUri, count: views.length, byType });
    return text({ project: projectUri, count: views.length, byType, views });
}

/** Registers the view-catalog tools on the MCP server. */
export function registerViewTools(server: McpServer, source: C4ModelSource): void {
    const logger: McpLogger = (level, data) => void server.sendLoggingMessage({ level, data });

    server.registerTool(
        'list-views',
        {
            title: 'List C4 views',
            description: 'Catalog of all views in a project: key, type, title, description, element and relationship counts, plus an aggregate byType breakdown. Optionally filter by type.',
            inputSchema: z.object({
                type: z.enum(VIEW_TYPES).optional().describe('Filter views by this type.'),
                uri: uriArgSchema(),
            }),
        },
        async (args: { uri?: string; type?: string }) => listViewsHandler(source, args, logger),
    );
}
