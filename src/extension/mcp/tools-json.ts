import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { C4ModelSource } from './model';
import type { McpLogger } from './tools';
import { resolveProject, text, uriArgSchema } from './tools';

/**
 * Returns the raw Structurizr model (`json.model`) of a project. This is the
 * ground-truth model JSON (people, software systems, deployment nodes with their
 * relationships), as opposed to the flattened, LLM-friendly summaries exposed by
 * the other tools/resources.
 */
export async function readModelJsonHandler(
    source: C4ModelSource,
    args: { uri?: string },
    logger?: McpLogger,
): Promise<CallToolResult> {
    logger?.('info', { tool: 'read-model-json', event: 'start', uri: args.uri });
    const projectUri = await resolveProject(source, args.uri);
    const json = await source.getContent(projectUri);
    if (!json) {
        logger?.('warning', { tool: 'read-model-json', event: 'no-model', projectUri });
        return text({ error: `No model found for ${projectUri}` });
    }
    logger?.('info', { tool: 'read-model-json', event: 'complete', projectUri });
    return text({ project: projectUri, model: json.model ?? {} });
}

/** Finds a raw view object by key across every view bucket of the workspace JSON. */
function findRawView(json: any, key: string): any | undefined {
    const views = json?.views ?? {};
    for (const bucket of Object.values(views)) {
        if (!Array.isArray(bucket)) {
            continue;
        }
        const found = bucket.find((v: any) => String(v?.key) === key);
        if (found) {
            return found;
        }
    }
    return undefined;
}

/**
 * Returns the raw Structurizr view JSON for a given view key: elements with
 * their computed positions/sizes, relationships (with vertices where present)
 * and dimensions - exactly what the diagram renderer uses.
 */
export async function readViewJsonHandler(
    source: C4ModelSource,
    args: { key: string; uri?: string },
    logger?: McpLogger,
): Promise<CallToolResult> {
    logger?.('info', { tool: 'read-view-json', event: 'start', key: args.key, uri: args.uri });
    const projectUri = await resolveProject(source, args.uri);
    const json = await source.getContent(projectUri);
    if (!json) {
        logger?.('warning', { tool: 'read-view-json', event: 'no-model', projectUri });
        return text({ error: `No model found for ${projectUri}` });
    }
    const view = findRawView(json, args.key);
    if (!view) {
        logger?.('warning', { tool: 'read-view-json', event: 'not-found', key: args.key });
        return text({ error: `View ${args.key} not found in ${projectUri}` });
    }
    logger?.('info', { tool: 'read-view-json', event: 'complete', key: args.key, elementCount: view.elements?.length ?? 0 });
    return text({ project: projectUri, key: args.key, view });
}

/** Registers the raw-JSON access tools (Phase 2c) on the MCP server. */
export function registerJsonTools(server: McpServer, source: C4ModelSource): void {
    const logger: McpLogger = (level, data) => void server.sendLoggingMessage({ level, data });

    server.registerTool(
        'read-model-json',
        {
            title: 'Read raw C4 model JSON',
            description: 'Raw Structurizr model JSON (json.model): people, software systems, deployment nodes with their relationships. Ground truth for exact ids/properties.',
            inputSchema: z.object({ uri: uriArgSchema() }),
        },
        async (args: { uri?: string }) => readModelJsonHandler(source, args, logger),
    );

    server.registerTool(
        'read-view-json',
        {
            title: 'Read raw C4 view JSON',
            description: 'Raw Structurizr view JSON for a view key: elements with computed positions/sizes, relationships and dimensions.',
            inputSchema: z.object({
                key: z.string().describe('View key.'),
                uri: uriArgSchema(),
            }),
        },
        async (args: { key: string; uri?: string }) => readViewJsonHandler(source, args, logger),
    );
}
