import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { C4ModelSource, McpElement } from './model';
import { flattenModel } from './model';
import { buildModelIndex } from './model-index';
import type { McpLogger } from './tools';
import { resolveProject, text, uriArgSchema } from './tools';

interface DeploymentNodeInfo {
    id: string;
    name: string;
    type: 'deploymentNode' | 'infrastructureNode' | 'softwareSystemInstance' | 'containerInstance';
    technology?: string;
    tags: string[];
    description?: string;
    instanceCount?: number;
    instanceNumber?: number;
    children: DeploymentNodeInfo[];
}

function splitTags(tags?: string): string[] {
    if (!tags) {
        return [];
    }
    return tags.split(',').map(t => t.trim()).filter(Boolean);
}

function toDeploymentNode(raw: any): DeploymentNodeInfo {
    const base = {
        id: String(raw?.id ?? ''),
        name: raw?.name ?? '',
        technology: raw?.technology,
        tags: splitTags(raw?.tags),
        description: raw?.description,
        instanceCount: raw?.instanceCount,
        instanceNumber: raw?.instanceNumber,
    };
    const children: DeploymentNodeInfo[] = [
        ...(raw?.children ?? []).map(toDeploymentNode),
        ...(raw?.infrastructureNodes ?? []).map((inf: any) => ({ ...toDeploymentNode(inf), type: 'infrastructureNode' as const })),
        ...(raw?.softwareSystemInstances ?? []).map((inst: any) => ({ ...toDeploymentNode(inst), type: 'softwareSystemInstance' as const })),
        ...(raw?.containerInstances ?? []).map((inst: any) => ({ ...toDeploymentNode(inst), type: 'containerInstance' as const })),
    ];
    return { ...base, type: 'deploymentNode' as const, children };
}

/** Depth-first search over the raw deployment tree (nodes, infra nodes and instances). */
function findDeploymentNodeById(nodes: any[], id: string): any | undefined {
    for (const n of nodes ?? []) {
        if (String(n?.id) === id) {
            return n;
        }
        const nested = findDeploymentNodeById(n?.children ?? [], id)
            ?? findDeploymentNodeById(n?.infrastructureNodes ?? [], id)
            ?? findDeploymentNodeById(n?.softwareSystemInstances ?? [], id)
            ?? findDeploymentNodeById(n?.containerInstances ?? [], id);
        if (nested) {
            return nested;
        }
    }
    return undefined;
}

/**
 * Reads the deployment model: the deployment-node tree with infrastructure
 * nodes and deployed instances (with instance counts). With `id` only the
 * subtree of that node is returned; without it all root deployment nodes are.
 */
export async function readDeploymentHandler(
    source: C4ModelSource,
    args: { id?: string; uri?: string },
    logger?: McpLogger,
): Promise<CallToolResult> {
    logger?.('info', { tool: 'read-deployment', event: 'start', id: args.id, uri: args.uri });
    const projectUri = await resolveProject(source, args.uri);
    const json = await source.getContent(projectUri);
    if (!json) {
        logger?.('warning', { tool: 'read-deployment', event: 'no-model', projectUri });
        return text({ error: `No model found for ${projectUri}` });
    }
    const model = flattenModel(projectUri, json);
    const index = buildModelIndex(model);
    const roots = json?.model?.deploymentNodes ?? [];

    if (args.id) {
        const target = findDeploymentNodeById(roots, args.id);
        if (!target) {
            logger?.('warning', { tool: 'read-deployment', event: 'not-found', id: args.id });
            return text({ error: `Deployment node ${args.id} not found in ${projectUri}` });
        }
        const element = index.elementById.get(args.id);
        logger?.('info', { tool: 'read-deployment', event: 'complete', id: args.id });
        return text({
            project: projectUri,
            deployment: toDeploymentNode(target),
            path: element?.path ?? [],
        });
    }

    const deployment = roots.map(toDeploymentNode);
    logger?.('info', { tool: 'read-deployment', event: 'complete', rootCount: deployment.length });
    return text({ project: projectUri, deployment });
}

/**
 * Reads a single view: its metadata, the elements it shows and its
 * relationships (with source/destination names resolved).
 */
export async function readViewHandler(
    source: C4ModelSource,
    args: { key: string; uri?: string },
    logger?: McpLogger,
): Promise<CallToolResult> {
    logger?.('info', { tool: 'read-view', event: 'start', key: args.key, uri: args.uri });
    const projectUri = await resolveProject(source, args.uri);
    const json = await source.getContent(projectUri);
    if (!json) {
        logger?.('warning', { tool: 'read-view', event: 'no-model', projectUri });
        return text({ error: `No model found for ${projectUri}` });
    }
    const model = flattenModel(projectUri, json);
    const index = buildModelIndex(model);
    const view = model.views.find(v => v.key === args.key);
    if (!view) {
        logger?.('warning', { tool: 'read-view', event: 'not-found', key: args.key });
        return text({ error: `View ${args.key} not found in ${projectUri}` });
    }

    const elements = view.elementIds
        .map(id => index.elementById.get(id))
        .filter((e): e is McpElement => !!e)
        .map(e => ({ id: e.id, name: e.name, type: e.type, path: e.path }));
    const relationships = view.relationships.map(r => ({
        id: r.id,
        sourceId: r.sourceId,
        destinationId: r.destinationId,
        sourceName: index.elementById.get(r.sourceId)?.name,
        destinationName: index.elementById.get(r.destinationId)?.name,
        description: r.description,
        order: r.order,
    }));

    logger?.('info', { tool: 'read-view', event: 'complete', key: args.key, elementCount: elements.length, relationshipCount: relationships.length });
    return text({
        project: projectUri,
        view: { key: view.key, type: view.type, title: view.title, description: view.description },
        elements,
        relationships,
    });
}

/** Registers the read tools on the MCP server. */
export function registerReadTools(server: McpServer, source: C4ModelSource): void {
    const logger: McpLogger = (level, data) => void server.sendLoggingMessage({ level, data });

    server.registerTool(
        'read-deployment',
        {
            title: 'Read C4 deployment',
            description: 'Deployment tree: deployment nodes, infrastructure nodes and deployed instances (with instance counts).',
            inputSchema: z.object({
                id: z.string().optional().describe('Deployment node id. Omit to return all root deployment nodes.'),
                uri: uriArgSchema(),
            }),
        },
        async (args: { id?: string; uri?: string }) => readDeploymentHandler(source, args, logger),
    );

    server.registerTool(
        'read-view',
        {
            title: 'Read C4 view',
            description: 'Details of a single view: metadata, elements and relationships (with names resolved).',
            inputSchema: z.object({
                key: z.string().describe('View key.'),
                uri: uriArgSchema(),
            }),
        },
        async (args: { key: string; uri?: string }) => readViewHandler(source, args, logger),
    );
}
