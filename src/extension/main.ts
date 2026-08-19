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

import * as path from 'path';
import { LanguageClient, type LanguageClientOptions, type ServerOptions, TransportKind } from 'vscode-languageclient/node';
import { commands, ExtensionContext } from 'vscode';
import { init, setLanguageClient } from './init';
import { disposeMCP, initMCP } from './mcp/controller';

let client: LanguageClient;

export function activate(context: ExtensionContext): void {

    init(context);

    const serverModule = context.asAbsolutePath(path.join('dist', 'server.js'));
    const serverOptions: ServerOptions = {
        run: { 
            module: serverModule, 
            transport: TransportKind.ipc,
            options: { 
                execArgv: [
                    '--stack-size=65536',
                    '--max-old-space-size=8192',
                    '--max-semi-space-size=256'
                ] 
            }
        },
        debug: { 
            module: serverModule, 
            transport: TransportKind.ipc, 
            options: { 
                execArgv: [
                    '--nolazy', 
                    '--inspect=6009',
                    '--stack-size=65536',
                    '--max-old-space-size=8192',
                    '--max-semi-space-size=256'
                ] 
            } 
        }
    };

    const clientOptions: LanguageClientOptions = {
        documentSelector: [{ scheme: 'file', language: 'c4' }]
    };

    client = new LanguageClient('c4', 'C4', serverOptions, clientOptions);
    client.start().then(() => {
        setLanguageClient(client);
        // Start the built-in MCP server if varp.mcp.autoStart is enabled
        // (Node/desktop only; the browser entry point does not include MCP).
        void initMCP(context, client);
        console.log('[C4 Extension] Language Server connected, auto-refresh enabled');
    });

    commands.executeCommand('setContext', 'extension:c4', true);
}

export async function deactivate(): Promise<void> {
    // Stop the built-in MCP server (127.0.0.1 HTTP listener) so it does not
    // outlive the extension and keep its port free.
    try {
        await disposeMCP();
    } catch (err) {
        console.error('[C4 Extension] MCP dispose error on deactivate:', err);
    }
    if (client) {
        await client.stop();
    }
}
