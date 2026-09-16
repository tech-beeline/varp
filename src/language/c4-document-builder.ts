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
    type BuildOptions,
    type LangiumSharedCoreServices,
} from 'langium';
import { URI } from 'vscode-uri';
import { isInclude, Include } from '../generated/ast';
import * as includeResolver from './c4-include-resolver';

/**
 * C4DocumentBuilder - extends DefaultDocumentBuilder to auto-load !include files.
 *
 * Include/extends targets are discovered dynamically: a directive cannot be read
 * until its file has been parsed, so the flow is "build, scan, load, rebuild".
 * Langium reaches this flow through two entry points, and both are handled here:
 * update() for LSP changes (didOpen/didChange/watched files) and build() for
 * workspace initialization. build() calls emitUpdate/buildDocuments directly and
 * never reaches update(), so handling update() alone would leave the first build
 * without its !include fragments.
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

        // Step 2: After processing, scan the changed documents for !include directives
        // and extendsUri. Only a changed document can introduce new targets; for any
        // other document the guards in loadIncludeFile/loadExtendsUri returned early
        // on a previous cycle because its targets are already loaded.
        const result = await this.discoverNewIncludes(changed);

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
     * Workspace initialization entry point. Runs the same discovery flow as
     * update(), so the first build already sees the !include/extends fragments.
     *
     * The initial documents are built first (they must be parsed before their
     * directives can be read), then every directive target that is not yet loaded
     * is pulled in and the affected documents are rebuilt, keyed off the documents
     * handed over by the workspace manager.
     */
    override async build<T extends AstNode>(
        documents: Array<LangiumDocument<T>>,
        options?: BuildOptions,
        cancelToken?: any
    ): Promise<void> {
        await super.build(documents, options, cancelToken);

        const result = await this.discoverNewIncludes();
        if (result.newUris.length > 0) {
            console.log(`[C4 Builder] Discovered ${result.newUris.length} new include file(s) during initialization, rebuilding`);
            // Follow up with update(): the parents are already Validated and build()
            // skips every phase for a document whose state is already >= the target
            // state, so they would never be relinked against the freshly loaded
            // fragments. update() resets them to Changed, which performs that relink.
            const allToUpdate = [...new Set([...result.parentUris, ...result.newUris])];
            await super.update(allToUpdate, [], cancelToken);
        }
    }

    /**
     * Scans the given documents for !include directives and extendsUri and loads
     * any target that is not loaded yet. Returns the newly loaded URIs together
     * with the URIs of the documents that referenced them.
     *
     * @param scanUris Documents to scan. When omitted, every loaded document is
     *        scanned (used by build(), where the whole workspace is being
     *        initialized and nothing has been discovered yet). update() passes only
     *        the changed documents, because a document whose targets are already
     *        loaded cannot produce new ones.
     */
    private async discoverNewIncludes(scanUris?: URI[]): Promise<{ newUris: URI[]; parentUris: URI[] }> {
        const newUris: URI[] = [];
        const parentUris: URI[] = [];
        const parentSeen = new Set<string>();

        // Work queue: a document loaded here may itself contain directives, so it
        // must be scanned in the same pass; otherwise nested includes would stay
        // undiscovered until a later update().
        const queue: LangiumDocument[] = [];
        if (scanUris) {
            for (const uri of scanUris) {
                const doc = this.langiumDocuments?.getDocument(uri);
                if (doc) queue.push(doc);
            }
        } else {
            queue.push(...(this.langiumDocuments?.all.toArray() ?? []));
        }

        const scanned = new Set<string>();
        // URIs already present before this pass - used to detect what the loaders add.
        const known = new Set<string>(
            (this.langiumDocuments?.all.toArray() ?? []).map(d => d.uri.toString())
        );

        while (queue.length > 0) {
            const doc = queue.shift()!;
            const docUri = doc.uri.toString();
            if (scanned.has(docUri)) continue;
            scanned.add(docUri);
            if (!doc.parseResult?.value) continue;

            let hasNewIncludes = false;

            // Find and load !include directives
            for (const inc of this.collectIncludes(doc.parseResult.value)) {
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

            if (hasNewIncludes) {
                if (!parentSeen.has(docUri)) {
                    parentSeen.add(docUri);
                    parentUris.push(doc.uri);
                }

                // Enqueue everything the loaders added (a single file, or every file
                // of a directory !include) so their own directives are followed too.
                for (const added of this.langiumDocuments?.all.toArray() ?? []) {
                    const addedUri = added.uri.toString();
                    if (!known.has(addedUri)) {
                        known.add(addedUri);
                        queue.push(added);
                    }
                }
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
            // One-line, stack-less: remote extends failures (network/TLS or a
            // cached "invalid" URL) repeated on every rebuild shouldn't dump a
            // full stack trace into the log.
            const reason = (e instanceof Error) ? e.message : String(e);
            console.warn(`[C4 Builder] Error loading extends: ${extendsUri}: ${reason}`);
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
