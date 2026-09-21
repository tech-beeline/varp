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

import { DocumentState, LangiumDocument, WorkspaceCache } from 'langium';
import { isWorkspace, C4Document, isC4Document } from '../generated/ast';
import { LangiumServices } from 'langium/lsp';
import { URI } from 'vscode-uri';
import * as includeResolver from './c4-include-resolver';
import { C4JsonEnricher } from './c4-json-enricher';

/**
 * A generated workspace JSON together with the generation of the build it was
 * produced from. `generation` is a monotonically increasing counter, incremented
 * once per generated JSON, so the client can tell whether a payload is a NEW
 * build (full Workspace rebuild needed) or the SAME build it already rendered
 * (only a changeView is needed). The pair is stored in the cache, but the counter
 * itself lives module-level, so the cached JSON object is never mutated.
 */
export interface GeneratedJson {
    /** The Structurizr-compatible workspace JSON (immutable for consumers). */
    json: any;
    /** Generation of the build this payload was produced from. */
    generation: number;
}

/**
 * Global, monotonically increasing generation counter. Incremented once per
 * generated workspace JSON, so a build keeps its generation across deliveries
 * and the client can tell a new build (full rebuild) from the same build it has
 * already rendered (changeView only).
 */
let jsonGeneration = 0;

/**
 * Handles JSON generation lifecycle: listens to document build phases (post-validation),
 * generates Structurizr-compatible JSON for each workspace document, and caches the results.
 * Provides URI-based lookup for the extension to retrieve cached JSON for diagram rendering.
 */
export class C4GeneratorHandler {
    private jsonCache: WorkspaceCache<string, GeneratedJson>;
    private services: LangiumServices;
    /**
     * Root workspace URIs that currently have cached JSON. Kept in sync with
     * jsonCache: on every workspace update the WorkspaceCache is wiped wholesale,
     * so this set must be reset as well (see the onUpdate hook in the
     * constructor) - otherwise it accumulates phantom projects (deleted,
     * renamed or closed files) that list-projects would report as available.
     */
    private cachedUris: Set<string> = new Set();
    /**
     * Set when a workspace update invalidated jsonCache. The next
     * updateMemoryCache() then rebuilds cachedUris from scratch and regenerates
     * every still-live root, so editing one project does not silently drop the
     * cached JSON of the other open projects.
     */
    private pendingReset = false;
    /** Enriches the render JSON with the documentation fields the render pipeline does not produce. */
    private enricher: C4JsonEnricher;
    /** In-flight generate() promises keyed by root workspace URI. Coalesces the
     *  duplicate generate() calls that a single build cycle produces (one per
     *  fragment document), so a root workspace is generated exactly once and its
     *  external themes are fetched once - not once per fragment. */
    private readonly pendingGenerate = new Map<string, Promise<void>>();
    /**
     * Newest workspace node that arrived for a URI whose generation was still in
     * flight. The in-flight build may have started from an older AST, so this one
     * is regenerated as soon as it finishes instead of being dropped.
     */
    private readonly queuedWorkspaces = new Map<string, any>();

    /**
     * Optional callback invoked after a workspace's JSON has been successfully
     * generated and cached. Used by the language server entry points to notify
     * the client (e.g., custom/contentUpdated) so the diagram preview refreshes
     * only once fresh JSON is actually available. The generation identifies the
     * build this (uri, json) pair came from (it is not mutated into the json).
     */
    public onJsonGenerated?: (uri: string, json: any, generation: number) => void;

    constructor(services: LangiumServices) {
        this.services = services;
        this.jsonCache = new WorkspaceCache<string, any>(services.shared);
        this.enricher = new C4JsonEnricher(services.shared);

        // Mirror the WorkspaceCache lifecycle for cachedUris: jsonCache is wiped
        // wholesale on every update, so the URI list must be dropped at the same
        // moment, otherwise it drifts (phantom projects) and its first entry, used
        // as the default project by the MCP tools, may point at a document that no
        // longer exists. Dropping it here rather than lazily in updateMemoryCache
        // also means list-projects never reports a project whose JSON was just
        // invalidated; the list is repopulated as generation succeeds.
        services.shared.workspace.DocumentBuilder.onUpdate(() => {
            this.cachedUris.clear();
            this.pendingReset = true;
        });

        // Regenerate JSON once documents are validated. The state is referenced by
        // name rather than by value, and generation (fire-and-forget) starts only
        // after the validation phase has completed.
        services.shared.workspace.DocumentBuilder.onBuildPhase(
            DocumentState.Validated,
            (documents) => this.updateMemoryCache(documents)
        );
    }

    /**
     * Returns the workspace AST node of a document (bare root or wrapped inside a
     * C4Document), or undefined when the document has no workspace.
     */
    private workspaceNodeOf(doc: LangiumDocument): any | undefined {
        const root = doc.parseResult.value;
        if (isWorkspace(root)) {
            return root;
        }
        if (isC4Document(root) && root.workspaces?.length === 1) {
            return root.workspaces.at(0);
        }
        return undefined;
    }

    /**
     * Called after each build cycle. Collects the UNIQUE root workspace documents
     * reachable from the validated `documents` and generates/caches JSON for each
     * root exactly once.
     *
     * A build cycle passes every changed document (the workspace file AND each
     * !include fragment). Without dedup, a root workspace would be regenerated
     * once per fragment (1 + N fragments), and each generation would re-fetch the
     * same external themes - producing the theme-download spam. Here each root is
     * generated once: documents that ARE workspaces map to themselves, fragments
     * resolve to their owning root via findRootWorkspace(), and duplicate roots
     * are collapsed by the Map key (and by the in-flight guard in generateAndCache).
     *
     * When the preceding update invalidated the JSON cache (pendingReset), the
     * list of known roots is rebuilt from the currently loaded documents and all
     * still-live roots are regenerated, not just the ones this cycle touched.
     */
    private updateMemoryCache(documents: LangiumDocument[]) {
        const roots = new Map<string, any>();
        for (const doc of documents) {
            const direct = this.workspaceNodeOf(doc);
            if (direct) {
                roots.set(doc.uri.toString(), direct);
            } else {
                // Fragment (include/extends target, or a bare C4Document): resolve
                // the owning root workspace and mark it for (re)generation.
                const rootDoc = this.findRootWorkspace(doc.uri.toString());
                const rootNode = rootDoc ? this.workspaceNodeOf(rootDoc) : undefined;
                if (rootDoc && rootNode) {
                    roots.set(rootDoc.uri.toString(), rootNode);
                }
            }
        }

        if (this.pendingReset) {
            // The preceding update wiped jsonCache for every root, while the build
            // cycle only covers the documents it touched. Schedule every root that is
            // still loaded for regeneration, so a change in one project does not drop
            // the cached JSON (and the diagram) of the other open projects. cachedUris
            // was already cleared in the onUpdate hook and is repopulated by
            // doGenerateAndCache as each generation succeeds, so it never advertises
            // a project whose JSON failed to build.
            this.pendingReset = false;
            for (const doc of this.services.shared.workspace.LangiumDocuments.all.toArray()) {
                const workspaceNode = this.workspaceNodeOf(doc);
                if (!workspaceNode) continue;
                const uri = doc.uri.toString();
                if (!roots.has(uri)) {
                    roots.set(uri, workspaceNode);
                }
            }
        }

        for (const [uri, workspaceNode] of roots) {
            this.generateAndCache(uri, workspaceNode);
        }
    }

    /**
     * Generates Structurizr-compatible JSON for a workspace node and stores it in the cache.
     * Logs errors if generation fails but does not throw (non-critical for the build pipeline).
     *
     * Coalesces concurrent calls for the same URI: when a build cycle registers the same
     * root workspace once per fragment document, all those calls share ONE generation
     * promise. This both avoids wasted full JSON rebuilds and guarantees the external
     * theme files are fetched once per rebuild instead of once per fragment.
     */
    private generateAndCache(uri: string, workspace: any): Promise<void> {
        const pending = this.pendingGenerate.get(uri);
        if (pending) {
            // A generation is already running. Its result is based on the AST it
            // started from, so queue the newest node and return the running
            // promise: the drain loop below regenerates from it afterwards.
            this.queuedWorkspaces.set(uri, workspace);
            return pending;
        }
        const promise = this.drainGenerations(uri, workspace);
        this.pendingGenerate.set(uri, promise);
        return promise;
    }

    /**
     * Generates JSON for a root URI, then keeps regenerating while newer workspace
     * nodes were queued during a generation. Queued calls are only recorded while
     * a generation is in flight, so this loop drains them without spinning.
     */
    private async drainGenerations(uri: string, workspace: any): Promise<void> {
        let current = workspace;
        try {
            for (;;) {
                await this.doGenerateAndCache(uri, current);
                const next = this.queuedWorkspaces.get(uri);
                if (next === undefined) {
                    return;
                }
                this.queuedWorkspaces.delete(uri);
                current = next;
            }
        } finally {
            this.queuedWorkspaces.delete(uri);
            this.pendingGenerate.delete(uri);
        }
    }

    private async doGenerateAndCache(uri: string, workspace: any): Promise<void> {
        try {
            const generator = (this.services as any).generation.C4JsonGenerator;
            const json = await generator.generate(workspace, uri);
            // Cache the json WITHOUT mutating it. The generation identifies this
            // build and stays stable across every delivery of the same payload.
            jsonGeneration += 1;
            const generation = jsonGeneration;
            this.jsonCache.set(uri, { json, generation });
            this.cachedUris.add(uri);
            // Notify the client only after the JSON was generated successfully.
            this.onJsonGenerated?.(uri, json, generation);
        } catch (err) {
            console.error(`[C4 Build] Generation failed for ${uri}:`, err);
        }
    }

    /**
     * Returns the root workspace document for the given URI: the document itself
     * when it contains a Workspace node, otherwise the topmost ancestor of its
     * !include/extendsUri chain. The ancestor chain is resolved deterministically
     * via the shared include resolver (single source of truth), so fragment files
     * resolve to the workspace document that owns the generated JSON.
     */
    private findRootWorkspace(currentUri: string): LangiumDocument | undefined {
        // Check if the file itself is a workspace (bare Workspace or C4Document wrapping one)
        const self = this.services.shared.workspace.LangiumDocuments.getDocument(URI.parse(currentUri));
        if (self && this.getWorkspaceNode(self)) {
            return self;
        }

        // Walk the !include / extendsUri ancestor chain via the shared resolver.
        const chain = includeResolver.getAncestorChain(this.services.shared, currentUri);
        if (chain.length === 0) return self;
        const rootUri = chain[chain.length - 1];
        return this.services.shared.workspace.LangiumDocuments.getDocument(URI.parse(rootUri)) ?? self;
    }

    /**
     * Returns the Workspace AST node of a document (bare root or wrapped inside a
     * C4Document), or undefined if the document has no workspace.
     */
    private getWorkspaceNode(doc: LangiumDocument): any | undefined {
        const root = doc.parseResult.value as any;
        if (isWorkspace(root)) {
            return root;
        }
        if (isC4Document(root) && Array.isArray(root.workspaces) && root.workspaces.length > 0) {
            return root.workspaces[0];
        }
        return undefined;
    }

    /**
     * Returns the root workspace document URIs that currently have cached JSON.
     * Used by MCP to enumerate the available projects/workspaces.
     */
    public getCachedUris(): string[] {
        // Sorted so the list (and in particular its first entry, which the MCP
        // tools use as the default project) is stable across build cycles and does
        // not depend on document insertion order.
        return Array.from(this.cachedUris).sort();
    }

    /**
     * Resolves the root workspace document URI for the given URI.
     * Walks up !include / extendsUri chains so that fragment files resolve
     * to the workspace document that owns the generated JSON.
     */
    public getRootUri(uri: string): string {
        const rootDoc = this.findRootWorkspace(uri);
        return rootDoc ? rootDoc.uri.toString() : uri;
    }

    /**
     * Public API: retrieves the cached (json, generation) PAIR for a document URI.
     * Finds the root workspace for the URI and returns its cached JSON content
     * together with the generation of the build it came from. The pair is
     * returned as cached, so repeated reads of the same build report the same
     * generation and the client can tell a view switch from a rebuild. Returns
     * null if no cached content is found.
     */
    public getContentForUri(uri: string): GeneratedJson | null {
        const rootUri = this.getRootUri(uri);
        const entry = this.jsonCache.get(rootUri);

        if (!entry) {
            console.warn(`[C4 Build] No cached content found for root: ${rootUri}`);
            return null;
        }

        return entry;
    }

    /**
     * Returns the cached generated JSON for the root workspace of the given URI,
     * or undefined when no JSON has been generated yet. Unlike getContentForUri,
     * this performs no logging - it is intended for read-only inspections such as
     * the code-lens provider, where a missing cache entry is an expected state.
     */
    public getCachedContentForUri(uri: string): any {
        const rootUri = this.getRootUri(uri);
        return this.jsonCache.get(rootUri)?.json;
    }

    /**
     * Texts the renderer measures to size frames, for the cached workspace of the
     * given URI, keyed by view key. Empty when the workspace has no auto-laid-out
     * view or no JSON cached yet.
     */
    public getTextMeasurements(uri: string): Record<string, any> {
        const rootUri = this.getRootUri(uri);
        if (!this.jsonCache.get(rootUri)) return {};
        return (this.services as any).generation.C4JsonGenerator.getTextMeasurements(rootUri);
    }

    /**
     * Re-runs the auto-layout of the cached workspace with the text widths the
     * renderer measured, and returns the views to re-render (elements, relationship
     * vertices and dimensions). Returns undefined when the generation does not match
     * the cached build, so a stale measurement pass can never overwrite a newer
     * layout.
     */
    public async applyTextMeasurements(uri: string, generation: number, widths: Record<string, number>): Promise<{ views: any[] } | undefined> {
        const rootUri = this.getRootUri(uri);
        const entry = this.jsonCache.get(rootUri);
        if (!entry || entry.generation !== generation) return undefined;
        const views = await (this.services as any).generation.C4JsonGenerator.applyTextMeasurements(rootUri, entry.json, widths ?? {});
        return { views };
    }

    /**
     * Returns the FULL Structurizr-compatible JSON for the given URI: the cached
     * render JSON enriched with the fields the render pipeline does not produce
     * (currently `documentation.decisions` from `!adrs`/`!decisions`).
     *
     * The render JSON is used as-is for the diagram preview; this method layers
     * the additional documentation content on top without re-generating the
     * model/views, so the enrichment is cheap. Returns undefined when no render
     * JSON is cached yet.
     */
    public async getFullContentForUri(uri: string): Promise<any> {
        const rootUri = this.getRootUri(uri);
        const entry = this.jsonCache.get(rootUri);
        const renderJson = entry ? entry.json : undefined;
        if (!renderJson) return undefined;

        // Deep-clone the render JSON so the cached copy stays untouched and the
        // enricher can freely inject nested `documentation` into model elements.
        const fullJson = JSON.parse(JSON.stringify(renderJson));
        await this.enricher.enrich(rootUri, fullJson);
        return fullJson;
    }
}
