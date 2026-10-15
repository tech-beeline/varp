import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { C4ModelSource } from './model';
import { registerTools } from './tools';
import { registerReadTools } from './tools-read';
import { registerViewTools } from './tools-view';
import { registerGraphTools } from './tools-graph';
import { registerJsonTools } from './tools-json';
import { registerBatchTools } from './tools-batch';
import { registerResources } from './resources';
import { registerPrompts } from './prompts';

export const MCP_SERVER_NAME = 'c4-varp';
export const MCP_DEFAULT_PORT = 47474;

/**
 * Upper bound on concurrent MCP sessions. Each session owns a full McpServer, so
 * without a cap repeated `initialize` POSTs (which need no session header) could
 * grow memory unboundedly. When a new session would exceed the cap, the oldest
 * one is evicted.
 */
export const MCP_MAX_SESSIONS = 32;

/**
 * Instructions advertised to MCP clients describing how to use the C4 tools.
 */
const MCP_INSTRUCTIONS = `c4-varp MCP - read-only navigation of Structurizr C4 models.

Conventions:
- All tools are read-only and idempotent.
- "uri" (the project) is optional and defaults to the project with the most views.
  It accepts a full workspace URI, a file name (e.g. "workspace.dsl"), or the
  workspace name or description (e.g. "FilteredDemo").
- Use "list-projects" to discover projects, then "read-project-summary" for an
  overview (element counts by type, total relationships, views), then
  "search-element" / "read-element" to inspect specific elements and their
  outgoing relationships and the views that include them.
- "batch-read-elements" reads several elements in a single call (reduces round-trips).
- "element-diff" compares two elements side-by-side (attributes, metadata, tags, relationships).
- "subgraph-summary" gives a compact summary of all descendants of an element.
- "list-views" lists all views of a project as a compact catalog (with an optional type filter).
- "read-raw-workspace-json" returns the full resolved workspace JSON (model, views, configuration, styles/themes, documentation).
- Project resources are available at c4://projects and c4://project/{uri}.
- Prompts: summarize-project, explore-element.`;

export interface C4McpServerHandle {
    port: number;
    url: string;
    close(): Promise<void>;
}

/** Builds a fully registered MCP server. One instance is created per HTTP session. */
function createMcpServer(source: C4ModelSource, version: string): McpServer {
    const server = new McpServer(
        { name: MCP_SERVER_NAME, version },
        {
            instructions: MCP_INSTRUCTIONS,
            capabilities: { tools: {}, resources: {}, prompts: {}, completions: {}, logging: {} },
        },
    );
    server.server.onerror = (err) => console.error('[C4 MCP] protocol error:', err);
    registerTools(server, source);
    registerReadTools(server, source);
    registerViewTools(server, source);
    registerGraphTools(server, source);
    registerJsonTools(server, source);
    registerBatchTools(server, source);
    registerResources(server, source);
    registerPrompts(server, source);
    return server;
}

function writeJson(res: ServerResponse, status: number, body: unknown): void {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
}

/**
 * Starts a streamable-HTTP MCP server bound to 127.0.0.1 only.
 *
 * Endpoints:
 *   GET  /health -> { status: 'ok' }
 *   ALL  /mcp    -> MCP JSON-RPC (streamable HTTP transport)
 *
 * The MCP SDK's server (a Protocol) can be connected to exactly one transport, so a
 * fresh McpServer is created per session/transport. A request carrying an
 * `mcp-session-id` reuses that session; a POST without one starts a new session, and
 * any other request without a session is rejected with 400.
 */
export async function startC4McpServer(
    source: C4ModelSource,
    version: string,
    port: number = MCP_DEFAULT_PORT,
): Promise<C4McpServerHandle> {
    const sessions = new Map<string, { transport: StreamableHTTPServerTransport; server: McpServer }>();
    let httpServer: Server;

    httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
        try {
            const url = new URL(req.url ?? '/', 'http://127.0.0.1');
            if (url.pathname === '/health') {
                writeJson(res, 200, { status: 'ok' });
                return;
            }
            if (url.pathname !== '/mcp') {
                writeJson(res, 404, { error: 'Not found' });
                return;
            }

            const sessionId = typeof req.headers['mcp-session-id'] === 'string'
                ? req.headers['mcp-session-id']
                : undefined;

            if (sessionId !== undefined) {
                const session = sessions.get(sessionId);
                if (session) {
                    await session.transport.handleRequest(req, res);
                    return;
                }
                if (req.method === 'DELETE') {
                    res.writeHead(404);
                    res.end();
                    return;
                }
                writeJson(res, 404, {
                    jsonrpc: '2.0',
                    error: { code: -32001, message: 'Session not found' },
                    id: null,
                });
                return;
            }

            // No session: only a POST can start a new one (the transport validates that
            // it is an initialize request and rejects anything else with 400).
            if (req.method !== 'POST') {
                writeJson(res, 400, {
                    jsonrpc: '2.0',
                    error: { code: -32000, message: 'Bad Request: Mcp-Session-Id header is required' },
                    id: null,
                });
                return;
            }

            // Keep the session map bounded: evict the oldest session when a new one
            // would exceed the cap (a Map iterates in insertion order, so the first
            // entry is the least recently created).
            if (sessions.size >= MCP_MAX_SESSIONS) {
                const oldest = sessions.entries().next().value;
                if (oldest) {
                    const [oldestId, session] = oldest;
                    sessions.delete(oldestId);
                    try {
                        await session.transport.close();
                        await session.server.close();
                    } catch {
                        // ignore eviction close errors
                    }
                }
            }

            const server = createMcpServer(source, version);
            const transport = new StreamableHTTPServerTransport({
                sessionIdGenerator: () => randomUUID(),
                onsessioninitialized: (sid) => {
                    sessions.set(sid, { transport, server });
                },
            });
            transport.onclose = () => {
                if (transport.sessionId) {
                    sessions.delete(transport.sessionId);
                }
                void server.close();
            };
            await server.connect(transport);
            await transport.handleRequest(req, res);
        } catch (err) {
            console.error('[C4 MCP] request error:', err);
            if (!res.headersSent) {
                writeJson(res, 500, { error: 'Internal server error' });
            } else {
                res.end();
            }
        }
    });

    await new Promise<void>((resolve, reject) => {
        httpServer.once('error', reject);
        httpServer.listen(port, '127.0.0.1', () => {
            httpServer.removeListener('error', reject);
            resolve();
        });
    });

    const actualPort = (httpServer.address() as any).port;

    return {
        port: actualPort,
        url: `http://127.0.0.1:${actualPort}/mcp`,
        close: async () => {
            for (const { transport, server } of sessions.values()) {
                try {
                    await transport.close();
                    await server.close();
                } catch {
                    // ignore per-session close errors
                }
            }
            sessions.clear();
            await new Promise<void>((resolve) => httpServer.close(() => resolve()));
        },
    };
}
