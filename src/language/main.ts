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
 * C4 DSL Language Server — Node.js entry point.
 * 
 * This file initializes the language server for the VS Code extension (Node.js process).
 * 
 * Key responsibilities:
 * 1. Creates an LSP connection using Node.js IPC transport
 * 2. Patches the FileSystemProvider to handle remote https:// URLs (for Structurizr
 *    workspaces that extend or include files from GitHub/other HTTP sources)
 * 3. Creates C4 language services via dependency injection
 * 4. Registers a custom LSP request handler for retrieving cached generated JSON
 *    (used by the extension to render diagram previews on demand)
 * 5. Starts the language server
 */

import { startLanguageServer } from 'langium/lsp';
import { NodeFileSystem } from 'langium/node';
import { createConnection, ProposedFeatures } from 'vscode-languageserver/node';
import { URI } from 'vscode-uri';
import { createC4Services } from './c4-module';

// Create an LSP connection using Node.js IPC (stdio) transport
// This communicates with the VS Code extension host process
const connection = createConnection(ProposedFeatures.all);

// ─── FileSystemProvider Monkey-Patch ───────────────────────────────────────
// The default NodeFileSystem only handles local files. We need to support
// remote URLs for !include and extendsUri directives (e.g., workspaces hosted
// on GitHub). We wrap the base provider's readFile method with a fetch-based
// implementation and in-memory caching.

const baseProvider = NodeFileSystem.fileSystemProvider();

// Cache for fetched URL content: URL string → { content, timestamp }
// Invalidates after INCLUDE_CACHE_TTL milliseconds to prevent stale data
// while avoiding repeated network requests on every file open/change.
const fetchCache = new Map<string, { content: string; timestamp: number }>();
const INCLUDE_CACHE_TTL = 60000; // 60 seconds

// Store reference to the original readFile for non-URL fallback
const originalReadFile = (baseProvider as any).readFile.bind(baseProvider);

// Replace readFile with an async version that handles both local files and URLs
(baseProvider as any).readFile = async function(uri: any) {
    const uriString = uri.toString();
    
    // Handle http/https URLs via fetch with caching
    if (uriString.startsWith('http://') || uriString.startsWith('https://')) {
        // Check cache first
        const cached = fetchCache.get(uriString);
        if (cached && Date.now() - cached.timestamp < INCLUDE_CACHE_TTL) {
            return cached.content;
        }

        // Fetch from remote URL
        const response = await fetch(uriString);
        if (!response.ok) {
            throw new Error(`Failed to fetch ${uriString}: ${response.status}`);
        }
        const text = await response.text();

        // Store in cache
        fetchCache.set(uriString, { content: text, timestamp: Date.now() });
        return text;
    }
    
    // For local files, delegate to the original Node.js readFile
    return originalReadFile(uri);
};

// ─── Service Initialization ────────────────────────────────────────────────
// Create C4 language services using Langium's dependency injection.
// The monkey-patched fileSystemProvider is passed as the context,
// so all file reads (including workspace initialization) go through our
// URL-aware readFile wrapper.
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
// Register a custom LSP request that the extension calls when it needs
// the latest generated JSON (e.g., on file save, for diagram preview refresh).
// Returns the cached JSON content for rendering.
connection.onRequest('custom/getContentForUri', (params: { uri: string }) => {
    const content = C4.generation.C4GeneratorHandler.getContentForUri(params.uri);
    return content ? { json: content } : null;
});

// ─── Custom LSP Request Handler: Themes ─────────────────────────────────────
// Returns the raw JSON content of the requested theme files so the diagram
// preview webview can render without re-downloading them. Reading through the
// (patched) FileSystemProvider reuses the fetchCache in this file, so already
// downloaded themes are served from memory instead of the network.
connection.onRequest('custom/getThemes', async (params: { themes: string[] }) => {
    const urls = Array.isArray(params?.themes) ? params.themes : [];
    const themes: { url: string; content: string }[] = [];
    for (const url of urls) {
        if (!/^https?:\/\//i.test(url)) {
            continue; // only http(s) themes are fetched; built-ins are not supported here
        }
        try {
            const content = await (baseProvider as any).readFile(URI.parse(url));
            themes.push({ url, content });
        } catch (err) {
            console.warn(`[C4 Themes] Could not read theme ${url}:`, err);
        }
    }
    return { themes };
});

// Enumerate root workspace documents that currently have generated JSON.
// Used by MCP tools (e.g., list-projects) to discover available projects.
connection.onRequest('custom/listProjects', () => {
    const projects = C4.generation.C4GeneratorHandler.getCachedUris();
    return { projects };
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
// Start listening for LSP messages from the client (VS Code extension).
// This sets up all built-in LSP handlers (completion, hover, validation, etc.)
startLanguageServer(shared);
