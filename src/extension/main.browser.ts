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

import * as vscode from 'vscode';
import { LanguageClient, type LanguageClientOptions } from 'vscode-languageclient/browser';
import { init, setLanguageClient } from './init';

let client: LanguageClient;

export function activate(context: vscode.ExtensionContext): void {

    init(context);

    const serverMain = vscode.Uri.joinPath(context.extensionUri, 'dist', 'server.browser.js');
    const worker = new Worker(serverMain.toString(true));

    const clientOptions: LanguageClientOptions = {
        documentSelector: [{ scheme: 'file', language: 'c4' }, { scheme: 'untitled', language: 'c4' }]
    };

    client = new LanguageClient('c4', 'C4', worker, clientOptions);
    client.start().then(() => {
        setLanguageClient(client);
    });
}

export function deactivate(): Thenable<void> | undefined {
    if (!client) {
        return undefined;
    }
    return client.stop();
}
