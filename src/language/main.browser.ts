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

/**
 * C4 DSL Language Server — Browser (Web) entry point.
 * 
 * This file initializes the language server for the Web version of the extension
 * (vscode.dev, GitHub Codespaces, or webview-based environments).
 * 
 * Key differences from the Node.js version:
 * 1. Uses BrowserMessageReader/Writer instead of Node.js IPC for LSP transport
 * 2. Uses EmptyFileSystem instead of NodeFileSystem (no local file access in browser)
 * 3. Does NOT register the custom 'custom/getContentForUri' handler
 *    (diagram preview in browser is handled differently)
 * 4. The FileSystemProvider patch for remote URLs is shared with the Node.js version
 * 
 * Both versions share the same service creation logic via createC4Services().
 */

import { EmptyFileSystem } from 'langium';
import { startLanguageServer } from 'langium/lsp';
import { BrowserMessageReader, BrowserMessageWriter, createConnection } from 'vscode-languageserver/browser';
import { createC4Services } from './c4-module';

// Create LSP connection using browser-based message transport
// (postMessage API instead of Node.js stdin/stdout)
const messageReader = new BrowserMessageReader(self);
const messageWriter = new BrowserMessageWriter(self);
const connection = createConnection(messageReader, messageWriter);

// ─── FileSystemProvider Monkey-Patch ───────────────────────────────────────
// In the browser, there is no local file system, only remote URLs (http/https).
// EmptyFileSystem provides a minimal provider that we extend with fetch support.
// This enables !include and extendsUri to load remote Structurizr workspace files.

const baseProvider = EmptyFileSystem.fileSystemProvider();

// In-memory cache for fetched URL content to avoid redundant network requests
const fetchCache = new Map<string, { content: string; timestamp: number }>();
const INCLUDE_CACHE_TTL = 60000; // 60 seconds — same as Node.js version

// Store reference to the original (no-op) readFile
const originalReadFile = (baseProvider as any).readFile.bind(baseProvider);

// Replace readFile with fetch-based implementation for URL support
(baseProvider as any).readFile = async function(uri: any) {
    const uriString = uri.toString();
    
    // Handle http/https URLs via fetch with caching
    if (uriString.startsWith('http://') || uriString.startsWith('https://')) {
        console.log(`[FileSystem] Request for URL: ${uriString.substring(0, 100)}`);
        
        // Check cache first
        const cached = fetchCache.get(uriString);
        if (cached && Date.now() - cached.timestamp < INCLUDE_CACHE_TTL) {
            console.log(`[FileSystem] Cache hit: ${uriString.substring(0, 80)}`);
            return cached.content;
        }

        // Fetch from remote URL using the browser's built-in fetch API
        console.log(`[FileSystem] Fetching URL: ${uriString.substring(0, 100)}`);
        const response = await fetch(uriString);
        if (!response.ok) {
            throw new Error(`Failed to fetch ${uriString}: ${response.status}`);
        }
        const text = await response.text();
        console.log(`[FileSystem] Downloaded ${(text.length/1024).toFixed(1)} KB`);
        
        // Store in cache
        fetchCache.set(uriString, { content: text, timestamp: Date.now() });
        return text;
    }
    
    // For unsupported schemes in the browser, fall back to the original (empty) provider
    return originalReadFile(uri);
};

// ─── Service Initialization ────────────────────────────────────────────────
// Create C4 language services. The monkey-patched fileSystemProvider handles all file reads.
const { shared, C4 } = createC4Services({
    connection,
    fileSystemProvider: () => baseProvider as any
});

// ─── Custom LSP Request Handler ────────────────────────────────────────────
// Register the same custom request as the Node.js version so the extension
// can retrieve cached JSON for diagram preview refresh on file save.
connection.onRequest('custom/getContentForUri', (params: { uri: string }) => {
    const content = C4.generation.C4GeneratorHandler.getContentForUri(params.uri);
    return content ? { json: content.json } : null;
});

// ─── Start Language Server ────────────────────────────────────────────────
// Start listening for LSP messages. In the browser, this sets up the connection
// to the extension host running in the same web worker context.
startLanguageServer(shared);
