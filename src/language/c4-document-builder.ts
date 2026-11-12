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
    DocumentState,
    LangiumDocument,
    AstUtils,
    AstNode,
    type BuildOptions,
    type LangiumSharedCoreServices,
} from 'langium';
import { URI } from 'vscode-uri';
import { isC4Document, isInclude, isWorkspace, Include, Workspace } from '../generated/ast';
import * as includeResolver from './c4-include-resolver';

/**
 * C4DocumentBuilder - extends DefaultDocumentBuilder to auto-load !include files.
 *
 * Include/extends targets are discovered dynamically: a directive cannot be read
 * until its file has been parsed, so the flow is "scan, load, rebuild".
 *
 * The scan runs as a build phase listener, before the documents are validated, so
 * the first validation already sees the targets and does not report an include that
 * is still loading. The targets themselves are built, and the documents that
 * reference them are relinked, by the follow-up pass at the end of update()/build().
 *
 * The scan is not tied to the documents of the call that triggered it: workspace
 * initialization is cancellable, and the workspace lock cancels it as soon as the
 * editor reports a change. Its documents are already in the index by then, so they
 * are validated by the next update without their targets ever being loaded.
 * Scanning every indexed document that has not been scanned yet covers that case.
 */
export class C4DocumentBuilder extends DefaultDocumentBuilder {

    private readonly shared: LangiumSharedCoreServices;

    constructor(services: LangiumSharedCoreServices) {
        super(services);
        this.shared = services;
        this.onBuildPhase(DocumentState.IndexedReferences, documents => this.scanIncludes(documents));
    }

    // Tracks include/extends targets that were loaded successfully (keyed by the
    // resolved URI). Failures are NOT recorded, so a transient error is retried
    // on the next build cycle instead of being silently dropped for the session.
    private loadedIncludes = new Set<string>();

    // Documents whose !include/extendsUri targets have been scanned. A change
    // removes the document again, so it is scanned with its new content.
    private scannedDocuments = new Set<string>();

    // Documents whose targets were loaded after the linking phase ran. They are
    // relinked and validated again at the end of the pass.
    private awaitingRebuild = new Set<string>();

    override async update(changed: URI[], deleted: URI[], cancelToken?: any): Promise<void> {
        for (const uri of changed) {
            this.scannedDocuments.delete(uri.toString());
        }
        for (const uri of deleted) {
            this.scannedDocuments.delete(uri.toString());
            this.awaitingRebuild.delete(uri.toString());
        }

        // Step 1: Let the parent process all documents through build phases
        await super.update(changed, deleted, cancelToken);

        // Step 2-3: Load the targets that no phase has reached and rebuild the
        // documents whose targets became available.
        await this.loadPendingIncludes(cancelToken);

        // Step 4: Re-run validation for the rest of the touched workspaces, so their
        // diagnostics reflect the new state as well.
        await this.revalidateWorkspaces(changed, deleted, cancelToken);
    }

    /**
     * Workspace initialization entry point. Runs the same discovery flow as
     * update(), so the first build already sees the !include/extends fragments.
     */
    override async build<T extends AstNode>(
        documents: Array<LangiumDocument<T>>,
        options?: BuildOptions,
        cancelToken?: any
    ): Promise<void> {
        await super.build(documents, options, cancelToken);

        await this.loadPendingIncludes(cancelToken);
    }

    /**
     * Build phase listener: loads the targets of the documents that were linked in
     * this pass, so validation sees them. The documents that reference a freshly
     * loaded target are relinked afterwards, because their symbols were not in the
     * index while they were linked.
     */
    private async scanIncludes(documents: LangiumDocument[]): Promise<void> {
        const pending = documents.filter(document => !this.scannedDocuments.has(document.uri.toString()));
        const result = await this.discoverIncludes(pending);
        for (const uri of result.parentUris) {
            this.awaitingRebuild.add(uri);
        }
    }

    /**
     * Loads the targets of every indexed document that has not been scanned yet and
     * rebuilds the documents whose targets were loaded after they were linked.
     */
    private async loadPendingIncludes(cancelToken?: any): Promise<void> {
        const pending = (this.langiumDocuments?.all.toArray() ?? [])
            .filter(document => !this.scannedDocuments.has(document.uri.toString()));
        const result = await this.discoverIncludes(pending);
        for (const uri of result.parentUris) {
            this.awaitingRebuild.add(uri);
        }

        const toRebuild = [...new Set([...this.awaitingRebuild, ...result.newUris.map(uri => uri.toString())])];
        if (toRebuild.length === 0) {
            return;
        }

        if (result.newUris.length > 0) {
            console.log(`[C4 Builder] Discovered ${result.newUris.length} new include file(s), rebuilding ${toRebuild.length} document(s)`);
        }

        // Follow up with update(): the parents are already Validated and build()
        // skips every phase for a document whose state is already >= the target
        // state, so they would never be relinked against the freshly loaded
        // fragments. update() resets them to Changed, which performs that relink.
        await super.update(toRebuild.map(uri => URI.parse(uri)), [], cancelToken);
        this.awaitingRebuild.clear();
    }

    /**
     * Re-runs validation for every document of the workspaces touched by the update.
     *
     * Diagnostics are published when a document reaches the Validated phase, while an
     * update rebuilds only the changed documents and their reference dependents. The
     * relation this language cares about - a workspace and the files it includes - is
     * not a reference relation: an included file does not reference the file that
     * includes it. Without this pass, a file would keep the diagnostics of the
     * previous state until it is reopened, and files that are not open would never be
     * refreshed at all.
     *
     * The documents are not re-parsed: Langium's `validation: true` build option resets
     * them to the reference index and runs linking and validation again, which is the
     * documented way to force re-validation. A pass over a workspace of several
     * hundred files measures in the hundreds of milliseconds.
     */
    private async revalidateWorkspaces(changed: URI[], deleted: URI[], cancelToken?: any): Promise<void> {
        const roots = new Set([...changed, ...deleted]
            .map(uri => includeResolver.getRootWorkspaceUri(this.shared, uri.toString())));
        if (roots.size === 0) return;
        const documents = (this.langiumDocuments?.all.toArray() ?? []).filter(document =>
            document.state >= DocumentState.Validated
            && roots.has(includeResolver.getRootWorkspaceUri(this.shared, document.uri.toString())));
        if (documents.length === 0) return;
        await super.build(documents, { validation: true }, cancelToken);
    }

    /**
     * Scans the given documents for !include directives and extendsUri and loads
     * any target that is not loaded yet. Returns the newly loaded URIs together
     * with the URIs of the documents that referenced them.
     *
     * Documents added by the loaders are scanned in the same pass, so a fragment
     * that includes further fragments is followed to the end.
     */
    private async discoverIncludes(documents: LangiumDocument[]): Promise<{
        newUris: URI[];
        parentUris: string[];
    }> {
        const newUris: URI[] = [];
        const parentUris: string[] = [];
        const parentSeen = new Set<string>();

        // Work queue: a document loaded here may itself contain directives, so it
        // must be scanned in the same pass; otherwise nested includes would stay
        // undiscovered until a later update().
        const queue = [...documents];
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

            this.scannedDocuments.add(docUri);

            if (hasNewIncludes) {
                if (!parentSeen.has(docUri)) {
                    parentSeen.add(docUri);
                    parentUris.push(docUri);
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

        // Skip if the document was already loaded into the index (success earlier).
        // The lookup tolerates a Unicode normalisation difference between the
        // path written here and the file name reported by the file system.
        if (includeResolver.findDocument(this.shared, targetUri)) {
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
        const root = doc.parseResult.value;
        let extendsUri: string | undefined;
        let workspaceNode: Workspace | undefined;

        if (isC4Document(root)) {
            workspaceNode = root.workspaces[0];
            extendsUri = workspaceNode?.extendsUri;
        } else if (isWorkspace(root)) {
            workspaceNode = root;
            extendsUri = root.extendsUri;
        }

        if (!extendsUri || !workspaceNode) return undefined;

        const targetUri = this.resolveTargetUri(extendsUri, workspaceNode);
        if (!targetUri) return undefined;

        // Skip if already loaded or visited
        if (includeResolver.findDocument(this.shared, targetUri)) return undefined;

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
