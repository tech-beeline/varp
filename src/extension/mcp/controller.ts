import * as vscode from 'vscode';
import { LanguageClientModelSource, type C4LanguageClientLike } from './model';
import { MCP_SERVER_NAME, startC4McpServer, type C4McpServerHandle } from './server';

const SERVER_LABEL = 'C4 VARP';
const PROVIDER_ID = 'c4-varp.mcp';

let handle: C4McpServerHandle | undefined;
let version = '0.0.0';
let registered = false;
let emitter: vscode.EventEmitter<void> | undefined;

function isAutoStartEnabled(): boolean {
    return vscode.workspace.getConfiguration('varp.mcp').get<boolean>('autoStart', false);
}

/**
 * Initializes the built-in MCP server:
 * - registers an MCP server definition provider (VS Code MCP client);
 * - starts the server on activation if `varp.mcp.autoStart` is enabled;
 * - reacts to setting changes (start/stop) without restarting VS Code.
 *
 * Node/desktop only — the web (browser) entry point does not call this.
 */
export async function initMCP(context: vscode.ExtensionContext, client: C4LanguageClientLike): Promise<void> {
    const ext = vscode.extensions.getExtension('vimpelcom.c4-varp');
    version = ext?.packageJSON?.version ?? '0.0.0';

    if (!registered) {
        emitter = new vscode.EventEmitter<void>();
        context.subscriptions.push(emitter);
        context.subscriptions.push(
            vscode.lm.registerMcpServerDefinitionProvider(PROVIDER_ID, {
                onDidChangeMcpServerDefinitions: emitter.event,
                provideMcpServerDefinitions: () => {
                    if (!handle) {
                        return [];
                    }
                    return [
                        new vscode.McpHttpServerDefinition(
                            SERVER_LABEL,
                            vscode.Uri.parse(handle.url),
                            {},
                            version,
                        ),
                    ];
                },
            }),
        );
        registered = true;
        console.log('[C4 MCP] definition provider registered');
    }

    if (isAutoStartEnabled()) {
        await start(context, client);
    }

    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration('varp.mcp.autoStart')) {
                void (isAutoStartEnabled() ? start(context, client) : stop());
            }
        }),
    );
}

async function start(context: vscode.ExtensionContext, client: C4LanguageClientLike): Promise<void> {
    if (handle) {
        return;
    }
    try {
        const source = new LanguageClientModelSource(client);
        handle = await startC4McpServer(source, version);
        console.log(`[C4 MCP] server started at ${handle.url}`);
        emitter?.fire();
    } catch (err) {
        console.error('[C4 MCP] failed to start:', err);
        handle = undefined;
    }
}

async function stop(): Promise<void> {
    if (!handle) {
        return;
    }
    const h = handle;
    handle = undefined;
    try {
        await h.close();
    } catch (err) {
        console.error('[C4 MCP] stop error:', err);
    }
    emitter?.fire();
}
