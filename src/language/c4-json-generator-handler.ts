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

import { LangiumDocument, LangiumCoreServices, WorkspaceCache, AstUtils } from 'langium';
import { isWorkspace, C4Document, isC4Document } from '../generated/ast';
import { LangiumServices } from 'langium/lsp';
import { URI, Utils } from 'vscode-uri';

/**
 * Handles JSON generation lifecycle: listens to document build phases (post-validation),
 * generates Structurizr-compatible JSON for each workspace document, and caches the results.
 * Provides URI-based lookup for the extension to retrieve cached JSON for diagram rendering.
 */
export class C4GeneratorHandler {
    private jsonCache: WorkspaceCache<string, any>;
    private services: LangiumServices;

    constructor(services: LangiumServices) {
        this.services = services;
        this.jsonCache = new WorkspaceCache<string, any>(services.shared);

        // Hook into build phase 5 (Validated) to regenerate JSON after documents are processed
        services.shared.workspace.DocumentBuilder.onBuildPhase(
            5, // Post-validation
            (documents) => this.updateMemoryCache(documents)
        );
    }

    /**
     * Called after each build cycle. Iterates over validated documents and generates/caches
     * JSON for each workspace root found. Falls back to rebuilding related workspaces
     * for documents that are include fragments (no workspace root of their own).
     */
    private updateMemoryCache(documents: LangiumDocument[]) {
        for (const doc of documents) {
            // Find the workspace root node
            const root = doc.parseResult.value;
            let workspaceNode = undefined;

            if (isWorkspace(root)) {
                workspaceNode = root;
            } else if (isC4Document(root)) {
                // If the file has no explicit Workspace but has elements,
                // we need to find the document that includes this file.
                if(root.workspaces?.length === 1) {
                    workspaceNode = root.workspaces.at(0); 
                }
            }

            if (workspaceNode) {
                this.generateAndCache(doc.uri.toString(), workspaceNode);
            } else {
                // Include problem: this file is part of a larger workspace.
                // Find and rebuild the main workspace document that includes this file.
                this.rebuildRelatedWorkspaces(doc);
            }
        }
    }

    /**
     * Searches the document index for all workspace-type documents and regenerates
     * their JSON caches. Used when an include file changes — the including workspace
     * needs to be re-generated even though it wasn't directly modified.
     */
    private rebuildRelatedWorkspaces(changedDoc: LangiumDocument) {
        const allDocs = this.services.shared.workspace.LangiumDocuments.all.toArray();
        for (const doc of allDocs) {
            const root = doc.parseResult.value;
            let workspaceNode = undefined;

            if (isWorkspace(root)) {
                workspaceNode = root;
            } else if (isC4Document(root)) {
                if(root.workspaces?.length === 1) {
                    workspaceNode = root.workspaces.at(0); 
                }
            }
            if (workspaceNode) {
                this.generateAndCache(doc.uri.toString(), workspaceNode);
            }
        }
    }

    /**
     * Generates Structurizr-compatible JSON for a workspace node and stores it in the cache.
     * Logs errors if generation fails but does not throw (non-critical for the build pipeline).
     */
    private generateAndCache(uri: string, workspace: any) {
        try {
            const generator = (this.services as any).generation.C4JsonGenerator;
            const json = generator.generate(workspace);
            this.jsonCache.set(uri, json);
        } catch (err) {
            console.error(`[C4 Build] Generation failed for ${uri}:`, err);
        }
    }

    /**
     * Traverses the document index to find the root workspace document that either
     * directly contains the given URI or includes a file chain leading to it.
     * Supports both !include chains and extendsUri workspace inheritance.
     */
    private findRootWorkspace(currentUri: string): LangiumDocument | undefined {
        const allDocs = this.services.shared.workspace.LangiumDocuments.all.toArray();

        // Check if the file itself is a workspace
        const self = allDocs.find(d => d.uri.toString() === currentUri);
        if (self && (isWorkspace(self.parseResult.value) || (self.parseResult.value as any).workspace)) {
            return self;
        }

        // Search for a parent document that includes this file
        for (const doc of allDocs) {
            const root = doc.parseResult.value as any;
            if (!root) continue;

            // Check !include directives
            const includes = root.model?.at(0)?.includes || root.workspace?.model?.at(0)?.includes || [];
            for (const inc of includes) {
                const resolvedUri = Utils.resolvePath(Utils.dirname(doc.uri), inc.file).toString();
                if (resolvedUri === currentUri) {
                    // Found the parent! Recursively search for grandparent (in case of chains)
                    return this.findRootWorkspace(doc.uri.toString()) || doc;
                }
            }

            // Check extendsUri chain
            const extendsUri = root.extendsUri || root.workspace?.extendsUri;
            if (extendsUri) {
                const resolvedExtends = Utils.resolvePath(Utils.dirname(doc.uri), extendsUri).toString();
                if (resolvedExtends === currentUri) {
                    return this.findRootWorkspace(doc.uri.toString()) || doc;
                }
            }
        }

        return undefined;
    }

    /**
     * Public API: retrieves cached JSON for a given document URI.
     * Finds the root workspace for the URI and returns its cached JSON content.
     * Returns null if no cached content is found.
     */
    public getContentForUri(uri: string) : any {
        // Find which workspace this file belongs to
        const rootDoc = this.findRootWorkspace(uri);
        const rootUri = rootDoc ? rootDoc.uri.toString() : uri;

        // Return content specifically for that workspace
        const json = this.jsonCache.get(rootUri);
        
        if (!json) {
            console.warn(`[C4 Build] No cached content found for root: ${rootUri}`);
        }
        
        return json;
    }
}
