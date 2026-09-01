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

import {
    DefaultDocumentBuilder,
    LangiumDocument,
    AstUtils,
    AstNode,
    type LangiumSharedCoreServices,
} from 'langium';
import { URI } from 'vscode-uri';
import { isInclude, Include } from '../generated/ast';
import * as includeResolver from './c4-include-resolver';

/**
 * C4DocumentBuilder - extends DefaultDocumentBuilder to auto-load !include files.
 * 
 * The approach:
 * 1. Override update() to first call super.update() which processes documents
 * 2. After processing, scan the AST of all documents for !include directives and extendsUri
 * 3. Load any new include files using the FileSystemProvider (works in Node.js AND browser)
 * 4. Trigger a rebuild if new includes were loaded
 */
export class C4DocumentBuilder extends DefaultDocumentBuilder {

    private readonly shared: LangiumSharedCoreServices;

    constructor(services: LangiumSharedCoreServices) {
        super(services);
        this.shared = services;
    }

    // Tracks include/extends targets that were loaded successfully (keyed by the
    // resolved URI). Failures are NOT recorded, so a transient error is retried
    // on the next build cycle instead of being silently dropped for the session.
    private loadedIncludes = new Set<string>();

    override async update(changed: URI[], deleted: URI[], cancelToken?: any): Promise<void> {
        // Step 1: Let the parent process all documents through build phases
        await super.update(changed, deleted, cancelToken);

        // Step 2: After processing, scan all documents for !include directives and extendsUri
        const result = await this.discoverNewIncludes();

        // Step 3: If new include files were found, trigger another update to reprocess them
        // along with their parent documents (so validation re-runs with includes available)
        if (result.newUris.length > 0) {
            console.log(`[C4 Builder] Discovered ${result.newUris.length} new include file(s), triggering rebuild`);
            // Include parent docs in changed list so they get re-validated
            const allToUpdate = [...new Set([...result.parentUris, ...result.newUris])];
            await super.update(allToUpdate, [], cancelToken);
        }
    }

    /**
     * Scan all parsed documents for !include directives and extendsUri.
     * Returns newly loaded include URIs and their parent document URIs.
     */
    private async discoverNewIncludes(): Promise<{ newUris: URI[]; parentUris: URI[] }> {
        const newUris: URI[] = [];
        const parentUris: URI[] = [];
        const allDocs = this.langiumDocuments?.all.toArray() ?? [];

        for (const doc of allDocs) {
            if (!doc.parseResult?.value) continue;

            const sourceUri = AstUtils.getDocument(doc.parseResult.value)?.uri;
            if (!sourceUri) continue;

            // Find and load !include directives
            const includes = this.collectIncludes(doc.parseResult.value);
            let hasNewIncludes = false;
            for (const inc of includes) {
                const uri = await this.loadIncludeFile(inc);
                if (uri) {
                    newUris.push(uri);
                    hasNewIncludes = true;
                }
            }

            // Find and load extendsUri
            const extUri = await this.loadExtendsUri(doc, newUris);
            if (extUri) {
                hasNewIncludes = true;
            }

            // Track parent docs that had new includes (they need re-validation)
            if (hasNewIncludes) {
                parentUris.push(sourceUri);
            }
        }

        return { newUris, parentUris };
    }

    /**
     * Resolves a file path (relative or URL) to an absolute URI.
     * For http/https URLs, uses URI.parse() directly.
     * For local paths, resolves relative to the source document's directory.
     */
    private resolveTargetUri(filePath: string, contextNode: AstNode | URI): URI | undefined {
        // Single shared resolution pipeline (quotes, ${CONST}, http(s), relative
        // paths) - matches the scope provider, validator and JSON generator.
        return includeResolver.resolveTargetUri(filePath, contextNode, {
            constants: (path, node) => includeResolver.substituteConstants(this.shared, path, node),
        });
    }

    /**
     * Load a single !include file using the FileSystemProvider.
     * Supports both local relative paths and http/https URLs.
     * URL fetching is handled by the FileSystemProvider monkey-patch (see main.ts).
     * Works in both Node.js and browser environments.
     */
    private async loadIncludeFile(inc: Include): Promise<URI | undefined> {
        const filePath = inc.file?.replace(/^["']|["']$/g, '');
        if (!filePath) return undefined;

        const targetUri = this.resolveTargetUri(filePath, inc);
        if (!targetUri) return undefined; // unresolvable path - retry on the next cycle
        // Key by the resolved absolute URI, so the same relative path used from
        // different parent directories never collides.
        const loadedKey = targetUri.toString();

        // Skip if the document was already loaded into the index (success earlier)
        if (this.langiumDocuments?.hasDocument(targetUri)) {
            return undefined;
        }
        // Skip if this resolved URI was loaded successfully earlier in the session
        if (this.loadedIncludes.has(loadedKey)) {
            return undefined;
        }

        try {
            // Try to read as a single file first
            try {
                const content = await this.fileSystemProvider.readFile(targetUri);
                const childDoc = this.langiumDocumentFactory.fromString(content, targetUri);
                this.langiumDocuments?.addDocument(childDoc);
                this.loadedIncludes.add(loadedKey);
                console.log(`[C4 Builder] Loaded include: ${filePath}`);
                return targetUri;
            } catch (readError: any) {
                // If it's a directory (EISDIR), load all .dsl files from it
                // Only for local paths — URLs won't be directories
                if (readError.code === 'EISDIR' || readError.message?.includes('EISDIR')) {
                    return this.loadIncludeDirectory(targetUri, filePath);
                }
                // For local files not found, try appending .dsl extension
                if ((readError.code === 'ENOENT' || readError.code === 'FILE_NOT_FOUND') && !filePath.startsWith('http')) {
                    const withExt = URI.parse(targetUri.toString() + '.dsl');
                    if (this.langiumDocuments?.hasDocument(withExt)) {
                        this.loadedIncludes.add(withExt.toString());
                        return undefined;
                    }
                    try {
                        const content = await this.fileSystemProvider.readFile(withExt);
                        const childDoc = this.langiumDocumentFactory.fromString(content, withExt);
                        this.langiumDocuments?.addDocument(childDoc);
                        this.loadedIncludes.add(withExt.toString());
                        console.log(`[C4 Builder] Loaded include (with .dsl): ${filePath}.dsl`);
                        return withExt;
                    } catch { /* not found - retry on the next cycle */ }
                }
                // Failed (missing file / transient error) - NOT marked as loaded,
                // so the next update cycle retries this include.
                return undefined;
            }
        } catch (e) {
            return undefined;
        }
    }

    /**
     * Load all .dsl files from a directory (Structurizr-style !include on a directory).
     */
    private async loadIncludeDirectory(dirUri: URI, filePath: string): Promise<URI | undefined> {
        try {
            const entries = await this.fileSystemProvider.readDirectory(dirUri);
            let loadedCount = 0;
            for (const entry of entries) {
                if (entry.isDirectory) continue;
                const name = entry.uri.toString().toLowerCase();
                if (!name.endsWith('.dsl')) continue;
                
                if (this.langiumDocuments?.hasDocument(entry.uri)) continue;
                
                try {
                    const content = await this.fileSystemProvider.readFile(entry.uri);
                    const childDoc = this.langiumDocumentFactory.fromString(content, entry.uri);
                    this.langiumDocuments?.addDocument(childDoc);
                    loadedCount++;
                } catch { /* skip unreadable files */ }
            }
            if (loadedCount > 0) {
                console.log(`[C4 Builder] Loaded ${loadedCount} file(s) from directory: ${filePath}`);
                return dirUri;
            }
        } catch { /* ignore directory read errors */ }
        return undefined;
    }

    /**
     * Handle extendsUri for workspace extension.
     * Uses FileSystemProvider for both local and URL-based extends.
     * URL fetching with caching is handled by the FileSystemProvider monkey-patch (see main.ts).
     * Returns the loaded document URI if successful, undefined otherwise.
     */
    private async loadExtendsUri(doc: LangiumDocument, newUris: URI[]): Promise<URI | undefined> {
        const root = doc.parseResult.value as any;
        let extendsUri: string | undefined;
        let workspaceNode: any;

        if (root.$type === 'C4Document') {
            workspaceNode = root.workspaces?.[0];
            extendsUri = workspaceNode?.extendsUri;
        } else if (root.$type === 'Workspace') {
            workspaceNode = root;
            extendsUri = root.extendsUri;
        }

        if (!extendsUri || !workspaceNode) return undefined;

        const targetUri = this.resolveTargetUri(extendsUri, workspaceNode);
        if (!targetUri) return undefined;

        // Skip if already loaded or visited
        if (this.langiumDocuments?.hasDocument(targetUri)) return undefined;

        const visitedKey = `extends:${targetUri.toString()}`;
        if (this.loadedIncludes.has(visitedKey)) return undefined;

        try {
            // Use FileSystemProvider for all extends types (local paths and URLs).
            // The FileSystemProvider is monkey-patched in main.ts/main.browser.ts
            // to handle http/https URLs with fetch and caching.
            const content = await this.fileSystemProvider.readFile(targetUri);
            if (content !== undefined) {
                const childDoc = this.langiumDocumentFactory.fromString(content, targetUri);
                this.langiumDocuments?.addDocument(childDoc);
                // Only mark as loaded on success; transient failures are retried
                // on the next build cycle.
                this.loadedIncludes.add(visitedKey);
                newUris.push(targetUri);
                console.log(`[C4 Builder] Loaded extends: ${extendsUri}`);
                return targetUri;
            }
        } catch (e) {
            console.warn(`[C4 Builder] Error loading extends: ${extendsUri}`, e);
        }
        return undefined;
    }

    private collectIncludes(node: AstNode): Include[] {
        const result: Include[] = [];
        this.collectIncludesRecursive(node, result);
        return result;
    }

    private collectIncludesRecursive(node: any, result: Include[]): void {
        if (!node || typeof node !== 'object') return;
        if (isInclude(node)) {
            result.push(node);
        }
        for (const key of Object.keys(node)) {
            if (key === '$container' || key.startsWith('$')) continue;
            const val = node[key];
            if (Array.isArray(val)) {
                for (const item of val) {
                    if (item && typeof item === 'object' && item.$type) {
                        this.collectIncludesRecursive(item, result);
                    }
                }
            } else if (val && typeof val === 'object' && val.$type) {
                this.collectIncludesRecursive(val, result);
            }
        }
    }
}
