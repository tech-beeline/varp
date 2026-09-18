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

import { AstNode, AstUtils, LangiumDocument, WorkspaceCache } from 'langium';
import type { LangiumSharedCoreServices } from 'langium';
import { URI, Utils } from 'vscode-uri';
import { isConstant, isInclude, isWorkspace, type Include } from '../generated/ast';

/**
 * Single source of truth for resolving !include and extendsUri targets across the
 * code base (document builder, scope provider, validator, JSON generator, JSON
 * generator handler and the document-link provider).
 *
 * All resolutions follow the same pipeline:
 *   1. strip surrounding quotes,
 *   2. substitute ${CONST} placeholders (optional hook),
 *   3. http(s) URLs are parsed as-is,
 *   4. relative paths are resolved against the directory of the context document.
 *
 * Optional .dsl-extension fallback (matching C4DocumentBuilder.loadIncludeFile)
 * is provided via resolveTargetUris / resolveIncludedDocument.
 */

/** Hook used to substitute ${CONST} placeholders in a path before resolution. */
export type ConstantsResolver = (path: string, contextNode: AstNode) => string;

export interface ResolveOptions {
    /** Substitutes ${CONST} placeholders; unknown placeholders must be left as-is. */
    constants?: ConstantsResolver;
    /** Also try the path with a ".dsl" suffix when the exact one is not found (local paths only). */
    withDslFallback?: boolean;
    /** Skip documents whose parse produced errors (include fragments that cannot stand alone). */
    skipParseErrors?: boolean;
}

/** Strips a single pair of surrounding single/double quotes (idempotent). */
export function stripPathQuotes(value: string | undefined): string {
    return (value ?? '').replace(/^["']|["']$/g, '');
}

/** Returns the document of an AST node, or undefined when the node is not connected to one. */
function documentOf(node: AstNode): LangiumDocument | undefined {
    try {
        return AstUtils.getDocument(node);
    } catch {
        return undefined;
    }
}

/**
 * Resolves a raw path (relative path or http(s) URL) to an absolute URI, relative
 * to the directory of the document that contains `contextNode`. When `contextNode`
 * is a URI itself (document builder), the path is resolved against that URI.
 */
export function resolveTargetUri(rawPath: string, contextNode: AstNode | URI, options?: ResolveOptions): URI | undefined {
    let path = stripPathQuotes(rawPath);
    if (!path) return undefined;

    if (options?.constants && !URI.isUri(contextNode)) {
        try {
            path = options.constants(path, contextNode);
        } catch {
            // constant lookup failed (e.g. unparsed document) - keep the path as-is
        }
    }

    if (path.startsWith('http://') || path.startsWith('https://')) {
        try {
            return URI.parse(path);
        } catch {
            return undefined;
        }
    }

    const sourceUri = URI.isUri(contextNode) ? contextNode : documentOf(contextNode)?.uri;
    if (!sourceUri) return undefined;

    try {
        return Utils.resolvePath(Utils.dirname(sourceUri), path);
    } catch {
        return undefined;
    }
}

/**
 * Candidate URIs for a path: the exact match plus, when `withDslFallback` is set,
 * the ".dsl"-suffixed variant. The fallback applies to local paths only and is
 * skipped when the path already ends with ".dsl".
 */
export function resolveTargetUris(rawPath: string, contextNode: AstNode | URI, options?: ResolveOptions): URI[] {
    const uri = resolveTargetUri(rawPath, contextNode, options);
    if (!uri) return [];
    if (!options?.withDslFallback) return [uri];

    const uriString = uri.toString();
    if (uriString.startsWith('http://') || uriString.startsWith('https://')) return [uri];
    if (uriString.toLowerCase().endsWith('.dsl')) return [uri];
    return [uri, URI.parse(uriString + '.dsl')];
}

/** Looks up the target document in the Langium document index (with optional .dsl fallback). */
export function resolveIncludedDocument(
    shared: LangiumSharedCoreServices,
    rawPath: string,
    contextNode: AstNode | URI,
    options?: ResolveOptions,
): LangiumDocument | undefined {
    const documents = shared.workspace.LangiumDocuments;
    for (const uri of resolveTargetUris(rawPath, contextNode, options)) {
        const doc = documents.getDocument(uri);
        if (!doc) continue;
        if (options?.skipParseErrors && doc.parseResult.parserErrors.length > 0) continue;
        return doc;
    }
    return undefined;
}

/** Returns the parsed root AST of the target document (with optional .dsl fallback). */
export function resolveIncludedRoot(
    shared: LangiumSharedCoreServices,
    rawPath: string,
    contextNode: AstNode | URI,
    options?: ResolveOptions,
): AstNode | undefined {
    return resolveIncludedDocument(shared, rawPath, contextNode, options)?.parseResult.value;
}

// ─────────────────────────────────────────────────────────────────────────────
// WORKSPACE GRAPH (!include / extendsUri ancestor chain)
//
// The root workspace of a document is discovered by walking the parent graph:
// a parent document references its children through `!include` directives (anywhere
// in the AST) or through a `Workspace.extendsUri`. Walking this graph is what keeps
// ${CONST} lookups scoped to the document's own workspace instead of scanning every
// open document in insertion (nondeterministic) order.
// ─────────────────────────────────────────────────────────────────────────────

/** Resolves ${NAME} placeholders using only the constants declared in the node's own document. */
function substituteLocalConstants(shared: LangiumSharedCoreServices, input: string, contextNode: AstNode): string {
    if (!input.includes('${')) return input;
    const doc = documentOf(contextNode);
    if (!doc) return input;
    const constants = getConstantsForDocument(shared, doc.uri.toString());
    return input.replace(/\$\{([^}]+)\}/g, (match, key) => constants.get(key.trim()) ?? match);
}

/**
 * One outbound edge of the reference graph: a document referencing another
 * document through a `!include` directive or a workspace `extendsUri`.
 */
interface ReferenceEdge {
    /** URI of the referencing (parent) document - the lowest URI wins on conflict. */
    parentUri: string;
    /** The `!include` directive that created the edge, when one exists for this target. */
    include?: Include;
}

/**
 * Reverse reference index: childUri -> the document that directly references it
 * through a `!include` directive or a workspace `extendsUri`.
 *
 * Built in one pass over all loaded documents: each document's AST is walked
 * once and every include/extends target resolved once. A lookup is then a plain
 * map read.
 *
 * Paths are resolved using only the candidate parent's own constants (see
 * substituteLocalConstants) - ancestor discovery must not recurse into the
 * constant lookup, otherwise chain walking and constant lookup would deadlock.
 *
 * When several documents reference the same target (rare), the one with the
 * lowest URI string wins, so the result is deterministic regardless of document
 * insertion order.
 */
const parentIndexCaches = new WeakMap<LangiumSharedCoreServices, WorkspaceCache<string, Map<string, ReferenceEdge>>>();

function getParentIndex(shared: LangiumSharedCoreServices): Map<string, ReferenceEdge> {
    let cache = parentIndexCaches.get(shared);
    if (!cache) {
        cache = new WorkspaceCache<string, Map<string, ReferenceEdge>>(shared);
        parentIndexCaches.set(shared, cache);
    }
    return cache.get('*', () => {
        const index = new Map<string, ReferenceEdge>();
        const constantsHook: ConstantsResolver = (path, node) => substituteLocalConstants(shared, path, node);

        // Record one edge. `parentUri` follows the deterministic min-URI rule. The
        // include directive is captured from the first document that includes the
        // target (an `extendsUri` edge carries none), so it is available to callers
        // that need it.
        const addEdge = (target: string | undefined, parentUri: string, include?: Include): void => {
            if (!target || target === parentUri) return;
            const existing = index.get(target);
            if (!existing) {
                index.set(target, { parentUri, include });
                return;
            }
            if (parentUri < existing.parentUri) {
                // This document wins the deterministic min-URI rule, so the directive
                // must come from it as well - keeping the previous document's include
                // would pair a parent URI with a directive that belongs to another file.
                existing.parentUri = parentUri;
                existing.include = include;
                return;
            }
            if (parentUri === existing.parentUri && !existing.include && include) {
                existing.include = include;
            }
        };

        // Target URI the document builder loaded: the exact path, or its ".dsl" fallback
        // when only that variant is present in the document index.
        const loadedTargetUri = (rawPath: string, node: AstNode): string | undefined => {
            const candidates = resolveTargetUris(rawPath, node, { withDslFallback: true, constants: constantsHook });
            for (const uri of candidates) {
                if (shared.workspace.LangiumDocuments.getDocument(uri)) return uri.toString();
            }
            return candidates[0]?.toString();
        };

        for (const doc of shared.workspace.LangiumDocuments.all.toArray()) {
            const docUri = doc.uri.toString();
            const root = doc.parseResult.value;
            if (!root) continue;
            for (const inc of AstUtils.streamAllContents(root).filter(isInclude)) {
                addEdge(loadedTargetUri(inc.file, inc), docUri, inc);
            }
            for (const ws of AstUtils.streamAllContents(root).filter(isWorkspace)) {
                if (!ws.extendsUri) continue;
                addEdge(loadedTargetUri(ws.extendsUri, ws), docUri);
            }
        }
        return index;
    });
}

/**
 * Returns the document that directly references `childUri` through a `!include`
 * directive or a workspace `extendsUri`, or undefined when no loaded document
 * references it. Backed by the shared reverse index (single AST pass per build).
 */
export function findParentDocument(shared: LangiumSharedCoreServices, childUri: string): LangiumDocument | undefined {
    const edge = getParentIndex(shared).get(childUri);
    if (!edge) return undefined;
    return shared.workspace.LangiumDocuments.getDocument(URI.parse(edge.parentUri));
}

/**
 * Returns the `!include` directive that pulls `targetUri` into the workspace, or
 * undefined when no loaded document includes it (e.g. it is only reached through
 * `extendsUri`). Served from the same reverse index as findParentDocument.
 *
 * Paths are resolved by the shared pipeline (quotes, ${CONST}, http(s), relative
 * paths), so the directive found here is the same one the document builder
 * follows.
 */
export function findIncludeDirective(shared: LangiumSharedCoreServices, targetUri: string): Include | undefined {
    return getParentIndex(shared).get(targetUri)?.include;
}

// Cached per shared-services instance and auto-invalidated on workspace changes
// (see the constants cache above for the same pattern).
const ancestorChainCaches = new WeakMap<LangiumSharedCoreServices, WorkspaceCache<string, string[]>>();

/**
 * Returns the URI of the document that directly references `childUri` through a
 * `!include` directive or a workspace `extendsUri`, or undefined when no loaded
 * document references it. The reverse reference index (see getParentIndex) is
 * already cached per workspace build, so this is a plain O(1) lookup.
 * Deterministic: when several documents reference the same target, the one with
 * the lowest URI string wins (same rule as findParentDocument).
 */
export function getParentUri(shared: LangiumSharedCoreServices, childUri: string): string | undefined {
    return getParentIndex(shared).get(childUri)?.parentUri;
}

/**
 * Returns the ancestor chain of the document with the given URI: the closest
 * parent first, the root workspace last. The chain never includes the document
 * itself. Cycle-safe and depth-capped so malformed include graphs cannot hang
 * the lookup.
 */
export function getAncestorChain(shared: LangiumSharedCoreServices, docUri: string): string[] {
    let cache = ancestorChainCaches.get(shared);
    if (!cache) {
        cache = new WorkspaceCache<string, string[]>(shared);
        ancestorChainCaches.set(shared, cache);
    }
    return cache.get(docUri, () => {
        const chain: string[] = [];
        const visited = new Set<string>([docUri]);
        let current = docUri;
        for (let depth = 0; depth < 100; depth++) {
            const parentUri = getParentUri(shared, current);
            if (!parentUri) break;
            if (visited.has(parentUri)) break; // cycle detected
            visited.add(parentUri);
            chain.push(parentUri);
            current = parentUri;
        }
        return chain;
    });
}

/**
 * Returns the URI of the root workspace document that owns the document with the
 * given URI (the topmost ancestor of its !include/extendsUri chain). Documents
 * without an owning workspace resolve to themselves.
 */
export function getRootWorkspaceUri(shared: LangiumSharedCoreServices, docUri: string): string {
    const chain = getAncestorChain(shared, docUri);
    return chain.length > 0 ? chain[chain.length - 1] : docUri;
}

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS (!const / !var) - single shared implementation used by
// the scope provider, the document-link provider, the validator and the builder.
// ─────────────────────────────────────────────────────────────────────────────

/** Collects all !const/!var declarations from the given root AST node into a map. */
export function collectConstantsFromRoot(root: AstNode, target: Map<string, string>): void {
    AstUtils.streamAllContents(root).filter(isConstant).forEach((c) => {
        const name = (c.name ?? '').toString().replace(/['"]/g, '');
        const rawValue = (c.value ?? '').toString();
        const value = typeof rawValue === 'string' ? rawValue.replace(/^['"]|['"]$/g, '') : rawValue;
        if (name && !target.has(name)) target.set(name, value);
    });
}

// Cache is kept per shared-services instance (a WeakMap key allows every
// createC4Services() call - e.g. in tests - to get its own cache) and is cleared
// automatically by WorkspaceCache on any workspace update.
const constantsCaches = new WeakMap<LangiumSharedCoreServices, WorkspaceCache<string, Map<string, string>>>();

/**
 * Returns the constants (!const/!var) declared in the document with the
 * given URI. Cached per shared-services instance, so ${NAME} lookups do not
 * re-scan the AST on every call.
 */
export function getConstantsForDocument(shared: LangiumSharedCoreServices, docUri: string): Map<string, string> {
    let cache = constantsCaches.get(shared);
    if (!cache) {
        cache = new WorkspaceCache<string, Map<string, string>>(shared);
        constantsCaches.set(shared, cache);
    }
    return cache.get(docUri, () => {
        const constants = new Map<string, string>();
        try {
            const doc = shared.workspace.LangiumDocuments.getDocument(URI.parse(docUri));
            if (doc?.parseResult?.value) collectConstantsFromRoot(doc.parseResult.value, constants);
        } catch {
            // document not loaded or unparseable - empty set
        }
        return constants;
    });
}

/**
 * Looks up a constant by name, scoped to the workspace graph that contains
 * `contextNode`: parent files first (closest ancestor first, root last), then
 * sibling documents that share the same root workspace (sorted by URI).
 *
 * Unlike the previous implementation - which scanned every open document in
 * insertion (nondeterministic) order - this never searches documents from
 * unrelated workspaces and always resolves the same way for the same input,
 * eliminating "sometimes resolves to the wrong sibling file" behavior.
 */
export function lookupConstantInWorkspace(shared: LangiumSharedCoreServices, name: string, contextNode: AstNode): string | undefined {
    const doc = documentOf(contextNode);
    if (!doc) return undefined;
    const docUri = doc.uri.toString();

    // 1. Ancestors first - constants are often declared in the file that
    //    !includes the current one (e.g. a constant used in an include path).
    for (const ancestorUri of getAncestorChain(shared, docUri)) {
        const constants = getConstantsForDocument(shared, ancestorUri);
        if (constants.has(name)) return constants.get(name);
    }

    // 2. Sibling documents that share the same root workspace (deterministic
    //    URI order). Documents of unrelated workspaces are never searched.
    const rootUri = getRootWorkspaceUri(shared, docUri);
    const rootByDoc = new Map<string, string>();
    const candidates = shared.workspace.LangiumDocuments.all
        .toArray()
        .map((d) => d.uri.toString())
        .filter((uri) => {
            if (uri === docUri) return false;
            let root = rootByDoc.get(uri);
            if (root === undefined) {
                root = getRootWorkspaceUri(shared, uri);
                rootByDoc.set(uri, root);
            }
            return root === rootUri;
        })
        .sort();
    for (const uri of candidates) {
        const constants = getConstantsForDocument(shared, uri);
        if (constants.has(name)) return constants.get(name);
    }
    return undefined;
}

/**
 * Substitutes ${NAME} placeholders in the input string. Priority: the document
 * that contains `contextNode` first, then the constants visible from the document's
 * workspace graph (ancestors first, then same-root siblings - see
 * lookupConstantInWorkspace). Unknown placeholders are left as-is.
 */
export function substituteConstants(shared: LangiumSharedCoreServices, input: string, contextNode: AstNode): string {
    if (!input.includes('${')) return input;
    const doc = documentOf(contextNode);
    if (!doc) return input;
    const localConstants = getConstantsForDocument(shared, doc.uri.toString());

    return input.replace(/\$\{([^}]+)\}/g, (match, key) => {
        const name = key.trim();
        if (localConstants.has(name)) return localConstants.get(name)!;
        const fromWorkspace = lookupConstantInWorkspace(shared, name, contextNode);
        return fromWorkspace ?? match;
    });
}
