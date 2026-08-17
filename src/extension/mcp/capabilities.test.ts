import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { C4ModelSource } from './model';
import { loadWorkspaceJson } from './test-fixtures';
import { registerTools } from './tools';
import { registerResources } from './resources';
import { registerPrompts } from './prompts';

const FIXTURE = 'simple-workspace';
const PROJECT_URI = 'file:///main.dsl';

function mockSource(model: any, projects: string[] = [PROJECT_URI]): C4ModelSource {
    return {
        listProjects: async () => projects,
        getContent: async (uri: string) => (uri === PROJECT_URI ? model : null),
    };
}

describe('MCP protocol capabilities (end-to-end over in-memory transport)', () => {
    let client: Client;
    let workspaceJson: any;

    // loadWorkspaceJson runs the full language + Graphviz pipeline, so give the
    // hook a generous timeout.
    beforeAll(async () => {
        workspaceJson = await loadWorkspaceJson(FIXTURE);
        const source = mockSource(workspaceJson);
        const server = new McpServer(
            { name: 'c4-varp-test', version: '0.0.0' },
            { capabilities: { tools: {}, resources: {}, prompts: {}, completions: {}, logging: {} } },
        );
        registerTools(server, source);
        registerResources(server, source);
        registerPrompts(server, source);

        const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
        client = new Client({ name: 'test-client', version: '0.0.0' });
        // Connect both ends concurrently: Client.connect awaits the initialize
        // handshake, which is queued on the server transport until it starts.
        await Promise.all([
            client.connect(clientTransport),
            server.connect(serverTransport),
        ]);
    }, 30000);

    afterAll(async () => {
        await client.close();
    });

    it('advertises all protocol capabilities', () => {
        const caps = client.getServerCapabilities() ?? {};
        expect(caps.tools).toBeDefined();
        expect(caps.resources).toBeDefined();
        expect(caps.prompts).toBeDefined();
        expect(caps.completions).toBeDefined();
        expect(caps.logging).toBeDefined();
    });

    it('serves the 4 read-only tools', async () => {
        const res = await client.listTools();
        const names = res.tools.map((t) => t.name);
        expect(names).toEqual(expect.arrayContaining([
            'list-projects', 'read-project-summary', 'search-element', 'read-element',
        ]));
    });

    it('reads the c4://projects resource', async () => {
        const res = await client.readResource({ uri: 'c4://projects' });
        const content = JSON.parse((res.contents[0] as any).text);
        expect(content.projects).toEqual([PROJECT_URI]);
    });

    it('reads the c4://project/{uri} template resource', async () => {
        const uri = `c4://project/${encodeURIComponent(PROJECT_URI)}`;
        const res = await client.readResource({ uri });
        const content = JSON.parse((res.contents[0] as any).text);
        expect(content.elements.length).toBeGreaterThan(0);
        expect(content.views.length).toBeGreaterThan(0);
    });

    it('lists and gets prompts', async () => {
        const list = await client.listPrompts();
        expect(list.prompts.map((p) => p.name)).toEqual(
            expect.arrayContaining(['summarize-project', 'explore-element']),
        );

        const res = await client.getPrompt({ name: 'summarize-project', arguments: { uri: PROJECT_URI } });
        expect(res.messages.length).toBeGreaterThan(0);
        expect(res.messages[0].content.type).toBe('text');
    });

    it('completes the uri prompt argument from the available projects (ref/prompt)', async () => {
        const res = await client.complete({
            ref: { type: 'ref/prompt', name: 'explore-element' },
            argument: { name: 'uri', value: 'file:' },
        });
        expect(res.completion.values).toContain(PROJECT_URI);
    });

    it('completes the uri resource-template variable from the available projects (ref/resource)', async () => {
        const res = await client.complete({
            ref: { type: 'ref/resource', uri: 'c4://project/{uri}' },
            argument: { name: 'uri', value: 'file:' },
        });
        expect(res.completion.values).toContain(PROJECT_URI);
    });

    it('accepts a logging level (logging capability enabled)', async () => {
        await expect(client.setLoggingLevel('info')).resolves.toBeDefined();
    });
});
