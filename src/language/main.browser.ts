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
import { HttpCache, defaultFetcher, validateTheme } from './http-cache';

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

// Shared cache for fetched URL content (http/https). A single TTL applies to
// every downloaded document (includes, extendsUri targets and remote themes).
// Themes additionally run a validator on first download: invalid themes are
// cached as "invalid for the TTL" and are never delivered to the preview.
const httpCache = new HttpCache(defaultFetcher);

// Store reference to the original (no-op) readFile
const originalReadFile = (baseProvider as any).readFile.bind(baseProvider);

// Replace readFile with fetch-based implementation for URL support
(baseProvider as any).readFile = async function(uri: any) {
    const uriString = uri.toString();
    
    // Handle http/https URLs via fetch with caching (no theme validation here -
    // include/extendsUri documents are not themes).
    if (uriString.startsWith('http://') || uriString.startsWith('https://')) {
        return await httpCache.readRemoteWithCache(uriString);
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

// ─── JSON Generated Notification ───────────────────────────────────────────
// When a workspace's JSON is successfully generated and cached, notify the
// client (extension host) so it can refresh the open diagram preview. This
// avoids the race where the client pulls JSON on save before the language
// server has finished rebuilding/generating.
C4.generation.C4GeneratorHandler.onJsonGenerated = (uri, json) => {
    connection.sendNotification('custom/contentUpdated', { uri, json });
};

// ─── Custom LSP Request Handler ────────────────────────────────────────────
// Register the same custom request as the Node.js version so the extension
// can retrieve cached JSON for diagram preview refresh on file save.
connection.onRequest('custom/getContentForUri', (params: { uri: string }) => {
    const content = C4.generation.C4GeneratorHandler.getContentForUri(params.uri);
    return content ? { json: content } : null;
});

// Returns the FULL Structurizr-compatible JSON for the given URI: the cached
// render JSON enriched with documentation not produced by the render pipeline
// (e.g. `documentation.decisions` from !adrs/!decisions). Used for export/tooling;
// the diagram preview keeps using the lighter render JSON from getContentForUri.
connection.onRequest('custom/getFullContentForUri', async (params: { uri: string }) => {
    const content = await C4.generation.C4GeneratorHandler.getFullContentForUri(params.uri);
    return content ? { json: content } : null;
});

// ─── Custom LSP Request Handler: Themes ─────────────────────────────────────
// Returns the raw JSON content of the requested theme files so the diagram
// preview webview can render without re-downloading them. Themes are validated
// before being cached: an invalid theme (malformed JSON, missing required
// fields, or unavailable images) is cached as invalid for the HTTP_CACHE_TTL
// and is NOT included in the response, so the webview never receives a theme
// that would break rendering.
connection.onRequest('custom/getThemes', async (params: { themes: string[] }) => {
    const urls = Array.isArray(params?.themes) ? params.themes : [];
    const themes: { url: string; content: string }[] = [];
    for (const url of urls) {
        if (!/^https?:\/\//i.test(url)) {
            continue; // only http(s) themes are fetched; built-ins are not supported here
        }
        try {
            const content = await httpCache.readRemoteWithCache(url, validateTheme);
            themes.push({ url, content });
        } catch (err) {
            console.warn(`[C4 Themes] Skipping invalid or unreadable theme ${url}:`, err);
        }
    }
    return { themes };
});

// Cheap lookup of the root workspace document URI for a given URI. Used by the
// extension to decide whether a contentUpdated notification (which always
// carries the ROOT workspace URI) belongs to the document the preview is bound
// to - without fetching the full JSON on every unrelated generation event.
connection.onRequest('custom/getRootUri', (params: { uri: string }) => {
    const rootUri = C4.generation.C4GeneratorHandler.getRootUri(params?.uri ?? '');
    return { rootUri };
});

// ─── Start Language Server ────────────────────────────────────────────────
// Start listening for LSP messages. In the browser, this sets up the connection
// to the extension host running in the same web worker context.
startLanguageServer(shared);
