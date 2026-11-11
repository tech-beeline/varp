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

const EXTENSION_ID = 'vimpelcom.c4-varp';
const REQUIRED_COMMANDS = ['varp.diagram-preview', 'varp.export-json'];
const SYMBOLS_TIMEOUT_MS = 90_000;
const VALIDATION_SETTLE_MS = 3_000;
const RENDER_TIMEOUT_MS = 60_000;
const WINDOW_LINGER_MS = 10_000;

function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/** Resolves with undefined instead of waiting past the deadline. */
function withTimeout<T>(work: Thenable<T>, ms: number): Promise<T | undefined> {
    return Promise.race([Promise.resolve(work), delay(ms).then(() => undefined)]);
}

/**
 * Cancels the save dialog of the SVG export: the smoke test only needs the
 * markup, and a browser download prompt would block the run.
 */
function cancelSaveDialog(): { dispose: () => void } {
    const windowApi = vscode.window as any;
    const showSaveDialog = windowApi.showSaveDialog;
    const interceptDialog = async () => undefined;
    windowApi.showSaveDialog = interceptDialog;
    if (windowApi.showSaveDialog !== interceptDialog) {
        throw new Error('the save dialog cannot be intercepted');
    }
    return {
        dispose: () => {
            windowApi.showSaveDialog = showSaveDialog;
        },
    };
}

/** Polls the symbol provider: symbols prove the worker and the LSP connection are up. */
async function waitForSymbols(document: vscode.TextDocument): Promise<number> {
    const deadline = Date.now() + SYMBOLS_TIMEOUT_MS;
    while (Date.now() < deadline) {
        const symbols = await vscode.commands.executeCommand<unknown>(
            'vscode.executeDocumentSymbolProvider',
            document.uri,
        );
        if (Array.isArray(symbols) && symbols.length > 0) {
            return symbols.length;
        }
        await delay(500);
    }
    throw new Error(`no document symbols for ${document.uri.toString()} after ${SYMBOLS_TIMEOUT_MS} ms`);
}

/** Rejects unless the exported markup contains a diagram with labels and shapes. */
function assertDiagram(svg: string): void {
    const missing: string[] = [];
    if (!svg.includes('<svg')) missing.push('<svg');
    if (!svg.includes('</svg>')) missing.push('</svg>');
    if ((svg.match(/<text/g) ?? []).length < 2) missing.push('at least two text labels');
    if ((svg.match(/<(rect|polygon|path|image)/g) ?? []).length < 2) missing.push('element shapes');
    for (const label of ['User', 'Software System']) {
        if (!svg.includes(label)) missing.push(`the "${label}" label`);
    }
    if (missing.length > 0) {
        throw new Error(`the exported diagram is missing: ${missing.join(', ')}`);
    }
}

/**
 * Opens the preview through the code lens of the first view and exports the
 * rendered diagram. The export only succeeds once the webview has built the
 * workspace with the vendored renderer, so a returned markup proves rendering.
 */
async function renderDiagram(document: vscode.TextDocument): Promise<string> {
    const lenses = await vscode.commands.executeCommand<vscode.CodeLens[]>(
        'vscode.executeCodeLensProvider',
        document.uri,
    ) ?? [];
    const lens = lenses.find(candidate => candidate.command?.command === 'varp.diagram-preview');
    if (!lens?.command) {
        throw new Error(`no diagram preview code lens in ${document.uri.toString()}`);
    }
    const args = lens.command.arguments ?? [];
    await vscode.commands.executeCommand(lens.command.command, ...args);
    console.log(`[web smoke] preview requested for view ${String(args[0])}`);

    const capture = cancelSaveDialog();
    try {
        const svg = await withTimeout(
            vscode.commands.executeCommand<string | undefined>('varp.export-svg'),
            RENDER_TIMEOUT_MS,
        );
        if (svg) {
            return svg;
        }
    } finally {
        capture.dispose();
    }
    throw new Error(`the diagram did not render within ${RENDER_TIMEOUT_MS} ms`);
}

export async function run(): Promise<void> {
    const extension = vscode.extensions.getExtension(EXTENSION_ID);
    if (!extension) {
        throw new Error(`${EXTENSION_ID} is not installed`);
    }
    await extension.activate();
    console.log(`[web smoke] activated ${EXTENSION_ID} ${extension.packageJSON.version}`);

    const available = await vscode.commands.getCommands(true);
    const missing = REQUIRED_COMMANDS.filter(command => !available.includes(command));
    if (missing.length > 0) {
        throw new Error(`commands not registered: ${missing.join(', ')}`);
    }
    console.log(`[web smoke] commands registered: ${REQUIRED_COMMANDS.join(', ')}`);

    const files = await vscode.workspace.findFiles('**/*.dsl');
    if (files.length === 0) {
        throw new Error('the test workspace has no .dsl file');
    }

    const document = await vscode.workspace.openTextDocument(files[0]);
    await vscode.window.showTextDocument(document);
    const symbolCount = await waitForSymbols(document);
    console.log(`[web smoke] language server answered for ${document.uri.toString()}: ${symbolCount} symbol(s)`);

    // Validation runs after linking, so a clean model is only meaningful once the
    // server has had time to publish its diagnostics.
    await delay(VALIDATION_SETTLE_MS);
    const errors = vscode.languages.getDiagnostics(document.uri)
        .filter(diagnostic => diagnostic.severity === vscode.DiagnosticSeverity.Error);
    if (errors.length > 0) {
        throw new Error(`errors in ${document.uri.toString()}: ${errors.map(error => error.message).join(' | ')}`);
    }

    const svg = await renderDiagram(document);
    assertDiagram(svg);
    console.log(`[web smoke] rendered a diagram: ${svg.length} characters of SVG`);

    // The window closes as soon as the run resolves, so linger to leave the
    // rendered diagram on screen for inspection.
    await delay(WINDOW_LINGER_MS);

    console.log('[web smoke] passed');
}
