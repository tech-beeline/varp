import { completable } from '@modelcontextprotocol/sdk/server/completable.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { GetPromptResult, PromptMessage } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { C4ModelSource } from './model';

function textMessage(role: 'user' | 'assistant', text: string): PromptMessage {
    return { role, content: { type: 'text', text } };
}

/**
 * Zod schema for the `uri` prompt argument with protocol-level completions
 * (`completion/complete`, `ref/prompt`).
 *
 * `.default('')` (not `.optional()`) is required so the MCP SDK registers the
 * completion handler: its registration-time detection unwraps `ZodOptional` to
 * the inner type (losing the completable marker), while the handler-time check
 * needs the marker on the field itself; a `ZodDefault` keeps the marker on the
 * field for both paths. An empty value means "use the default project".
 */
function promptUriSchema(source: C4ModelSource) {
    return completable(
        z.string().default('').describe('Project (root workspace) URI. Defaults to the first available project.'),
        async (value = '') => (await source.listProjects()).filter((p) => p.startsWith(value)),
    );
}

/**
 * Registers prompts that guide the model to navigate the C4 model using the
 * read-only tools (read-project-summary / search-element / read-element).
 */
export function registerPrompts(server: McpServer, source: C4ModelSource): void {
    server.registerPrompt(
        'summarize-project',
        {
            title: 'Summarize a C4 project',
            description: 'Instruct the model to summarize a C4 project: its elements, relationships and views.',
            argsSchema: { uri: promptUriSchema(source) },
        },
        async (args: { uri?: string }): Promise<GetPromptResult> => {
            const target = args.uri ? ` for the project "${args.uri}"` : '';
            return {
                description: 'Summarize the C4 architecture project',
                messages: [
                    textMessage('user',
                        'Instructions: You are an expert in C4 architecture modeling. ' +
                        'Produce a concise, well-structured summary of the project architecture. ' +
                        'Use the available read-only MCP tools to gather data.'),
                    textMessage('user',
                        `Summarize the C4 project${target}. First call read-project-summary to get an ` +
                        'overview (element counts by type, total relationships, views). Then call ' +
                        'read-element on the most important elements to gather details about their ' +
                        'relationships. Present the result as: overview, key elements, relationships, and views.'),
                ],
            };
        },
    );

    server.registerPrompt(
        'explore-element',
        {
            title: 'Explore a C4 element',
            description: 'Instruct the model to deep-dive into one element: its details, relationships and views.',
            argsSchema: {
                id: z.string().describe('Element id (Structurizr id).'),
                uri: promptUriSchema(source),
            },
        },
        async (args: { id: string; uri?: string }): Promise<GetPromptResult> => {
            const projectPart = args.uri ? ` and uri="${args.uri}"` : '';
            return {
                description: `Explore element ${args.id}`,
                messages: [
                    textMessage('user',
                        'Instructions: You are an expert in C4 architecture modeling. ' +
                        'Explain the role of the element in the overall architecture based on the data.'),
                    textMessage('user',
                        `Call read-element with id="${args.id}"${projectPart} to get the full element details. ` +
                        'Then analyze its outgoing relationships (descriptions, targets, tags) and the views that ' +
                        'include it. Explain the role of this element in the architecture and note anything unusual.'),
                ],
            };
        },
    );
}
