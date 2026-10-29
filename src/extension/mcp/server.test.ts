/*
	Copyright 2026 VimpelCom PJSC

	Licensed under the Apache License, Version 2.0 (the "License");
	you may not use this file except in compliance with the License.
	You may obtain a copy of the License at

		http://www.apache.org/licenses/LICENSE-2.0

	Unless required by applicable law or agreed to in writing, software
	distributed under the License is distributed on an "AS IS" BASIS,
	WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
	See the License for the specific language governing permissions and
	limitations under the License.
*/

import { describe, it, expect } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { startC4McpServer, MCP_MAX_SESSIONS } from './server';
import type { C4ModelSource } from './model';

const source: C4ModelSource = {
    listProjects: async () => ['probe'],
    getContent: async () => ({ model: {} }),
};

async function connect(url: string): Promise<Client> {
    const client = new Client({ name: 'probe', version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(url)));
    return client;
}

describe('startC4McpServer', () => {
    it('serves initialize and tools over streamable HTTP', async () => {
        const handle = await startC4McpServer(source, '9.9.9', 0);
        try {
            const client = await connect(handle.url);
            const tools = await client.listTools();
            expect(tools.tools.length).toBeGreaterThan(0);
            await client.close();
        } finally {
            await handle.close();
        }
    });

    it('supports two concurrent sessions', async () => {
        const handle = await startC4McpServer(source, '9.9.9', 0);
        try {
            const a = await connect(handle.url);
            const b = await connect(handle.url);
            expect((await a.listTools()).tools.length).toBeGreaterThan(0);
            expect((await b.listTools()).tools.length).toBeGreaterThan(0);
            await a.close();
            await b.close();
        } finally {
            await handle.close();
        }
    });

    it('evicts the oldest session when the session cap is exceeded', async () => {
        const handle = await startC4McpServer(source, '9.9.9', 0);
        const clients: Client[] = [];
        try {
            for (let i = 0; i < MCP_MAX_SESSIONS + 1; i++) {
                clients.push(await connect(handle.url));
            }
            // The oldest session was evicted, so it can no longer serve requests,
            // while the newest one still works.
            await expect(clients[0].listTools()).rejects.toThrow();
            expect((await clients[clients.length - 1].listTools()).tools.length).toBeGreaterThan(0);
        } finally {
            for (const client of clients) {
                await client.close().catch(() => undefined);
            }
            await handle.close();
        }
    }, 60_000);
});
