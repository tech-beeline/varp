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

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { text } from './tools';

/**
 * The VS Code API is loaded on demand: the server module is imported by tests and by
 * builds where the `vscode` module does not exist, and only the handlers need it.
 */
type VsCode = typeof import('vscode');
const vs = (): Promise<VsCode> => import('vscode');

/** Upper bound for collections returned to the agent, so one query cannot flood a context. */
const MAX_ITEMS = 500;
const MAX_SYMBOL_DEPTH = 4;

const uriSchema = z.string().describe('File URI (file:///...) or an absolute path.');
const positionSchema = {
    line: z.number().int().min(0).describe('Line number, 0-indexed.'),
    character: z.number().int().min(0).describe('Character offset in the line, 0-indexed.'),
};

function toUri(api: VsCode, value: string) {
    return value.includes('://') ? api.Uri.parse(value) : api.Uri.file(value);
}

function rangeJson(range: any) {
    return {
        startLine: range.start.line,
        startCharacter: range.start.character,
        endLine: range.end.line,
        endCharacter: range.end.character,
    };
}

function locationJson(location: any) {
    return { uri: location.uri.toString(), ...rangeJson(location.range) };
}

/** Normalizes `Location | LocationLink` results of the definition provider. */
function targetJson(api: VsCode, target: any) {
    if (target?.targetUri) {
        return {
            uri: target.targetUri.toString(),
            ...rangeJson(target.targetSelectionRange ?? target.targetRange),
            originSelectionRange: target.originSelectionRange ? rangeJson(target.originSelectionRange) : undefined,
        };
    }
    return locationJson(target);
}

/** Serializes `DocumentSymbol` trees and flat `SymbolInformation` lists. */
function symbolJson(symbol: any, kindName: (kind: number) => string, depth: number): any {
    const result: any = { name: symbol.name, kind: kindName(symbol.kind), detail: symbol.detail };
    if (symbol.range) result.range = rangeJson(symbol.range);
    if (symbol.location) result.location = locationJson(symbol.location);
    if (Array.isArray(symbol.children) && depth > 1) {
        result.children = symbol.children.map((child: any) => symbolJson(child, kindName, depth - 1));
    }
    return result;
}

/** Flattens hover contents (MarkdownString, MarkedString or plain text) into one string. */
function hoverText(contents: any): string {
    const parts = Array.isArray(contents) ? contents : [contents];
    return parts
        .map((part: any) => {
            if (typeof part === 'string') return part;
            if (typeof part?.value === 'string') return part.value;
            if (typeof part?.language === 'string' && typeof part.value === 'string') return part.value;
            return '';
        })
        .filter(Boolean)
        .join('\n\n');
}

const SEVERITY_NAMES = ['error', 'warning', 'information', 'hint'];

/**
 * Registers the editor tools backed by the language servers VS Code has running: the
 * built-in commands query any registered provider, so the tools answer for C4 DSL files
 * through this extension's Langium server and for other languages through theirs.
 */
export function registerLspTools(server: McpServer): void {
    server.registerTool(
        'get-diagnostics',
        {
            title: 'Get diagnostics',
            description: 'Errors, warnings, information and hints reported by the language servers, optionally for one file.',
            inputSchema: z.object({ uri: uriSchema.optional() }),
        },
        async (args: { uri?: string }) => {
            const api = await vs();
            const all = api.languages.getDiagnostics();
            const filtered = args.uri
                ? all.filter(([uri]) => uri.toString() === toUri(api, args.uri!).toString())
                : all;
            const diagnostics = filtered.flatMap(([uri, list]) => list.map(diagnostic => ({
                uri: uri.toString(),
                severity: SEVERITY_NAMES[diagnostic.severity] ?? String(diagnostic.severity),
                message: diagnostic.message,
                source: diagnostic.source,
                code: typeof diagnostic.code === 'object' ? diagnostic.code.value : diagnostic.code,
                ...rangeJson(diagnostic.range),
            })));
            return text({ count: diagnostics.length, diagnostics: diagnostics.slice(0, MAX_ITEMS) });
        },
    );

    server.registerTool(
        'find-references',
        {
            title: 'Find references',
            description: 'All references to the symbol at a position, as reported by the language server.',
            inputSchema: z.object({
                uri: uriSchema,
                ...positionSchema,
                includeDeclaration: z.boolean().optional().default(true).describe('Include the declaration itself.'),
            }),
        },
        async (args: { uri: string; line: number; character: number; includeDeclaration?: boolean }) => {
            const api = await vs();
            const locations: any[] = await api.commands.executeCommand(
                'vscode.executeReferenceProvider',
                toUri(api, args.uri),
                new api.Position(args.line, args.character),
                { includeDeclaration: args.includeDeclaration ?? true },
            ) ?? [];
            const references = locations.slice(0, MAX_ITEMS).map(locationJson);
            return text({ count: locations.length, references });
        },
    );

    server.registerTool(
        'go-to-definition',
        {
            title: 'Go to definition',
            description: 'Definition location(s) of the symbol at a position, as reported by the language server.',
            inputSchema: z.object({ uri: uriSchema, ...positionSchema }),
        },
        async (args: { uri: string; line: number; character: number }) => {
            const api = await vs();
            const result: any = await api.commands.executeCommand(
                'vscode.executeDefinitionProvider',
                toUri(api, args.uri),
                new api.Position(args.line, args.character),
            );
            const targets = (Array.isArray(result) ? result : result ? [result] : []).slice(0, MAX_ITEMS);
            return text({ count: targets.length, definitions: targets.map(target => targetJson(api, target)) });
        },
    );

    server.registerTool(
        'get-hover',
        {
            title: 'Get hover',
            description: 'Hover information (type, documentation) for the symbol at a position.',
            inputSchema: z.object({ uri: uriSchema, ...positionSchema }),
        },
        async (args: { uri: string; line: number; character: number }) => {
            const api = await vs();
            const hovers: any[] = await api.commands.executeCommand(
                'vscode.executeHoverProvider',
                toUri(api, args.uri),
                new api.Position(args.line, args.character),
            ) ?? [];
            const textContent = hovers.map(hover => hoverText(hover.contents)).filter(Boolean).join('\n\n');
            return text({ count: hovers.length, hover: textContent });
        },
    );

    server.registerTool(
        'get-document-symbols',
        {
            title: 'Get document symbols',
            description: 'Symbols (elements, views, groups, and their nesting) declared in a document.',
            inputSchema: z.object({ uri: uriSchema }),
        },
        async (args: { uri: string }) => {
            const api = await vs();
            const symbols: any[] = await api.commands.executeCommand(
                'vscode.executeDocumentSymbolProvider',
                toUri(api, args.uri),
            ) ?? [];
            const kindName = (kind: number) => api.SymbolKind[kind] ?? String(kind);
            return text({
                count: symbols.length,
                symbols: symbols.slice(0, MAX_ITEMS).map(symbol => symbolJson(symbol, kindName, MAX_SYMBOL_DEPTH)),
            });
        },
    );

    server.registerTool(
        'search-workspace-symbols',
        {
            title: 'Search workspace symbols',
            description: 'Search symbols across the workspace through the language servers.',
            inputSchema: z.object({
                query: z.string().describe('Symbol name or fragment to search for.'),
            }),
        },
        async (args: { query: string }) => {
            const api = await vs();
            const symbols: any[] = await api.commands.executeCommand(
                'vscode.executeWorkspaceSymbolProvider',
                args.query,
            ) ?? [];
            const kindName = (kind: number) => api.SymbolKind[kind] ?? String(kind);
            return text({
                count: symbols.length,
                symbols: symbols.slice(0, MAX_ITEMS).map(symbol => symbolJson(symbol, kindName, 1)),
            });
        },
    );
}
