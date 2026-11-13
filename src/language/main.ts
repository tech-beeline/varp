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
import { HttpCache, defaultFetcher, validateTheme } from './http-cache';
import { DEFAULT_THEME_JSON, isDefaultThemeUrl } from './c4-default-theme';

// Create an LSP connection using Node.js IPC (stdio) transport
// This communicates with the VS Code extension host process
const connection = createConnection(ProposedFeatures.all);

// ─── FileSystemProvider Monkey-Patch ───────────────────────────────────────
// The default NodeFileSystem only handles local files. We need to support
// remote URLs for !include and extendsUri directives (e.g., workspaces hosted
// on GitHub). We wrap the base provider's readFile method with a fetch-based
// implementation and in-memory caching.

const baseProvider = NodeFileSystem.fileSystemProvider();

// Shared cache for fetched URL content (http/https). A single TTL applies to
// every downloaded document (includes, extendsUri targets and remote themes).
// Themes additionally run a validator on first download: invalid themes are
// cached as "invalid for the TTL" and are never delivered to the preview.
const httpCache = new HttpCache(defaultFetcher);

// Store reference to the original readFile for non-URL fallback
const originalReadFile = baseProvider.readFile.bind(baseProvider);

// Replace readFile with an async version that handles both local files and URLs
baseProvider.readFile = async function (uri: URI) {
    const uriString = uri.toString();

    // Handle http/https URLs via fetch with caching (no theme validation here -
    // include/extendsUri documents are not themes).
    if (uriString.startsWith('http://') || uriString.startsWith('https://')) {
        return await httpCache.readRemoteWithCache(uriString);
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
    fileSystemProvider: () => baseProvider
});

// ─── Workspace Updated Notification ────────────────────────────────────────
// After a build, notify the client with the workspace's view list so it can
// refresh the open diagram preview. The full JSON is not generated here: the
// preview fetches the per-view payload on demand.
C4.generation.C4GeneratorHandler.onViewsUpdated = (uri, views) => {
    // The notification only carries the view list: the preview fetches the small
    // per-view payload on demand instead of receiving the whole workspace JSON.
    connection.sendNotification('c4/contentUpdated', { uri, views });
};

// ─── Custom LSP Request Handler ────────────────────────────────────────────
// Register a custom LSP request that the extension calls when it needs
// the latest generated JSON (e.g., on file save, for diagram preview refresh).
// Returns the cached JSON content for rendering.
connection.onRequest('c4/getContentForUri', async (params: { uri: string }) => {
    // Returns { json, generation } so the client can tell "same cached build,
    // just changeView" from a fresh/different build (which needs a full rebuild).
    // A missing entry is regenerated on demand: the cache is wiped by any document
    // update and restored by the build phase, so a read that lands outside that
    // window is still served.
    const content = await C4.generation.C4GeneratorHandler.ensureContentForUri(params.uri);
    return content
        ? { json: content.json, generation: content.generation, textMeasurements: C4.generation.C4GeneratorHandler.getTextMeasurements(params.uri), rootUri: C4.generation.C4GeneratorHandler.getRootUri(params.uri) }
        : null;
});

// Returns the JSON limited to one view, so the preview renders a small payload
// instead of the whole workspace. Null when the workspace or the view key is
// unknown; the caller then keeps the current render.
connection.onRequest('c4/getViewContent', async (params: { uri: string; viewKey: string }) => {
    const content = await C4.generation.C4GeneratorHandler.getViewContentForUri(params.uri, params.viewKey);
    return content
        ? {
            json: content.json,
            generation: content.generation,
            textMeasurements: C4.generation.C4GeneratorHandler.getViewTextMeasurements(params.uri, params.viewKey),
            views: C4.generation.C4GeneratorHandler.getViewRefs(params.uri),
            rootUri: C4.generation.C4GeneratorHandler.getRootUri(params.uri)
        }
        : null;
});

// Returns the view list of the workspace without generating the JSON. The save
// path uses it to resolve the displayed view key without pulling the full JSON.
connection.onRequest('c4/getViewRefs', (params: { uri: string }) => {
    return {
        rootUri: C4.generation.C4GeneratorHandler.getRootUri(params.uri),
        views: C4.generation.C4GeneratorHandler.getViewRefs(params.uri)
    };
});

// Re-runs the auto-layout of the cached workspace with the text widths the webview
// measured after the first render. The renderer sizes a frame from its measured
// name/metadata, so the layout has to reserve that space - otherwise the frame
// overlaps its right-hand neighbour. Returns the views to re-render.
connection.onRequest('c4/applyTextMeasurements', async (params: { uri: string; generation: number; widths: Record<string, number> }) => {
    return await C4.generation.C4GeneratorHandler.applyTextMeasurements(params.uri, params.generation, params.widths);
});

// Applies a drawio file's layout to the cached view (drawio layout import). The
// cached JSON is changed in place and its generation bumped, so a subsequent
// getContentForUri returns the imported coordinates for a full workspace rebuild.
connection.onRequest('c4/importDrawioLayout', async (params: { uri: string; viewKey: string; xml: string }) => {
    // The full JSON is generated lazily; the import edits it in place.
    await C4.generation.C4GeneratorHandler.ensureContentForUri(params.uri);
    return C4.generation.C4GeneratorHandler.applyDrawioLayout(params.uri, params.viewKey, params.xml) ?? null;
});

// Returns the FULL Structurizr-compatible JSON for the given URI: the cached
// render JSON enriched with documentation not produced by the render pipeline
// (e.g. `documentation.decisions` from !adrs/!decisions). Used for export/tooling;
// the diagram preview keeps using the lighter render JSON from getContentForUri.
// `pruneUnusedElements` drops the model elements that have no relationship and are
// drawn by no view (the fitness checks ask for it).
connection.onRequest('c4/getFullContentForUri', async (params: { uri: string; pruneUnusedElements?: boolean }) => {
    const content = await C4.generation.C4GeneratorHandler.getFullContentForUri(params.uri, {
        pruneUnusedElements: params.pruneUnusedElements
    });
    return content ? { json: content } : null;
});

// ─── Custom LSP Request Handler: Themes ─────────────────────────────────────
// Returns the raw JSON content of the requested theme files so the diagram
// preview webview can render without re-downloading them. Themes are validated
// before being cached: an invalid theme (malformed JSON, missing required
// fields) is cached as invalid for the HTTP_CACHE_TTL
// and is NOT included in the response, so the webview never receives a theme
// that would break rendering.
connection.onRequest('c4/getThemes', async (params: { themes: string[] }) => {
    const urls = Array.isArray(params?.themes) ? params.themes : [];
    const themes: { url: string; content: string }[] = [];
    for (const url of urls) {
        // The built-in default theme is bundled: the Structurizr cloud no longer
        // serves its URL, so it must not go to the network.
        if (isDefaultThemeUrl(url)) {
            themes.push({ url, content: DEFAULT_THEME_JSON });
            continue;
        }
        if (!/^https?:\/\//i.test(url)) {
            continue; // only http(s) themes are fetched; anything else is not a remote resource
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

// Enumerate root workspace documents that can be served. Used by MCP tools
// (e.g., list-projects) to discover available projects. Includes roots whose JSON
// is not cached yet: reads regenerate on demand, so discovery stays stable across
// cache invalidation instead of dropping every project until the next build.
connection.onRequest('c4/listProjects', () => {
    const projects = C4.generation.C4GeneratorHandler.getProjectUris();
    return { projects };
});

// Cheap lookup of the root workspace document URI for a given URI. Used by the
// extension to decide whether a contentUpdated notification (which always
// carries the ROOT workspace URI) belongs to the document the preview is bound
// to - without fetching the full JSON on every unrelated generation event.
connection.onRequest('c4/getRootUri', (params: { uri: string }) => {
    const rootUri = C4.generation.C4GeneratorHandler.getRootUri(params?.uri ?? '');
    return { rootUri };
});

// ─── Start Language Server ────────────────────────────────────────────────
// Start listening for LSP messages from the client (VS Code extension).
// This sets up all built-in LSP handlers (completion, hover, validation, etc.)
startLanguageServer(shared);
