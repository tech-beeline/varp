import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { C4ModelSource } from './model';
import { registerTools } from './tools';

export const MCP_SERVER_NAME = 'c4-varp';
export const MCP_DEFAULT_PORT = 47474;

export interface C4McpServerHandle {
    port: number;
    url: string;
    close(): Promise<void>;
}

/**
 * Starts a streamable-HTTP MCP server bound to 127.0.0.1 only.
 *
 * Endpoints:
 *   GET  /health -> { status: 'ok' }
 *   ALL  /mcp    -> MCP JSON-RPC (streamable HTTP transport)
 */
export async function startC4McpServer(
    source: C4ModelSource,
    version: string,
    port: number = MCP_DEFAULT_PORT,
): Promise<C4McpServerHandle> {
    const server = new McpServer(
        { name: MCP_SERVER_NAME, version },
        { capabilities: { tools: {} } },
    );
    registerTools(server, source);

    const transports = new Map<string, StreamableHTTPServerTransport>();
    let httpServer: Server;

    httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
        try {
            const url = new URL(req.url ?? '/', 'http://127.0.0.1');
            if (url.pathname === '/health') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 'ok' }));
                return;
            }
            if (url.pathname !== '/mcp') {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Not found' }));
                return;
            }

            const sessionId = typeof req.headers['mcp-session-id'] === 'string'
                ? req.headers['mcp-session-id']
                : undefined;
            let transport = sessionId ? transports.get(sessionId) : undefined;

            if (!transport) {
                if (req.method === 'DELETE') {
                    res.writeHead(404);
                    res.end();
                    return;
                }
                transport = new StreamableHTTPServerTransport({
                    sessionIdGenerator: () => randomUUID(),
                });
                transport.onclose = () => {
                    if (transport?.sessionId) {
                        transports.delete(transport.sessionId);
                    }
                };
                await server.connect(transport);
                if (transport.sessionId) {
                    transports.set(transport.sessionId, transport);
                }
            }

            await transport.handleRequest(req, res);
        } catch (err) {
            console.error('[C4 MCP] request error:', err);
            if (!res.headersSent) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Internal server error' }));
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

    const actualPort = (httpServer.address() as { port: number }).port;

    return {
        port: actualPort,
        url: `http://127.0.0.1:${actualPort}/mcp`,
        close: async () => {
            for (const t of transports.values()) {
                try {
                    await t.close();
                } catch {
                    // ignore per-transport close errors
                }
            }
            transports.clear();
            await new Promise<void>((resolve) => httpServer.close(() => resolve()));
        },
    };
}
