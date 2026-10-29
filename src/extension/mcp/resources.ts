import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ReadResourceResult } from '@modelcontextprotocol/sdk/types.js';
import type { C4ModelSource } from './model';
import { flattenModel } from './model';

/** Resource URI listing every available project. */
export const PROJECTS_RESOURCE_URI = 'c4://projects';
/** Resource template for a single project's flattened model. */
export const PROJECT_RESOURCE_TEMPLATE = 'c4://project/{uri}';

function toTextResource(uri: string, text: string): ReadResourceResult {
    return {
        contents: [{ uri, mimeType: 'application/json', text }],
    };
}

/**
 * Registers read-only resources over the resolved C4 model:
 *   - c4://projects            -> { projects: string[] }
 *   - c4://project/{uri}       -> flattened model (elements, relationships, views)
 */
export function registerResources(server: McpServer, source: C4ModelSource): void {
    server.registerResource(
        'projects',
        PROJECTS_RESOURCE_URI,
        {
            description: 'List of all C4 projects (root workspace document URIs).',
            mimeType: 'application/json',
        },
        async (uri) => {
            const projects = await source.listProjects();
            return toTextResource(uri.toString(), JSON.stringify({ projects }, null, 2));
        },
    );

    // The `{uri}` variable exposes protocol-level completions (`ref/resource`)
    // from the available projects, e.g. while a client is typing a project URI.
    const template = new ResourceTemplate(PROJECT_RESOURCE_TEMPLATE, {
        list: undefined,
        complete: {
            uri: async (value = '') => (await source.listProjects()).filter((p) => p.startsWith(value)),
        },
    });
    server.registerResource(
        'project',
        template,
        {
            description: 'Flattened C4 model (elements, relationships, views) of a project.',
            mimeType: 'application/json',
        },
        async (uri, variables) => {
            const raw = variables['uri'];
            const projectUri = decodeURIComponent(Array.isArray(raw) ? raw[0] ?? '' : raw ?? '');
            const json = await source.getContent(projectUri);
            const model = json
                ? flattenModel(projectUri, json)
                : { project: { uri: projectUri }, elements: [], views: [] };
            return toTextResource(uri.toString(), JSON.stringify(model, null, 2));
        },
    );
}
