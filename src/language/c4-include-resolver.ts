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
import { isConstant, isInclude, isWorkspace } from '../generated/ast';

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
 * Returns the document that directly references `childUri` through a `!include`
 * directive or a workspace `extendsUri`, or undefined when no loaded document
 * references it.
 *
 * Paths are resolved using only the candidate parent's own constants (see
 * substituteLocalConstants) - ancestor discovery must not recurse into the
 * constant lookup, otherwise chain walking and constant lookup would deadlock.
 *
 * When several documents reference the same target (rare), the one with the
 * lowest URI string wins, so the result is deterministic regardless of document
 * insertion order.
 */
export function findParentDocument(shared: LangiumSharedCoreServices, childUri: string): LangiumDocument | undefined {
    const constantsHook: ConstantsResolver = (path, node) => substituteLocalConstants(shared, path, node);
    let best: LangiumDocument | undefined;
    let bestUri = '';

    for (const doc of shared.workspace.LangiumDocuments.all.toArray()) {
        const docUri = doc.uri.toString();
        if (docUri === childUri) continue;
        const root = doc.parseResult.value;
        if (!root) continue;

        let referencesChild = false;
        for (const inc of AstUtils.streamAllContents(root).filter(isInclude)) {
            if (resolveTargetUri(inc.file, inc, { constants: constantsHook })?.toString() === childUri) {
                referencesChild = true;
                break;
            }
        }
        if (!referencesChild) {
            for (const ws of AstUtils.streamAllContents(root).filter(isWorkspace)) {
                if (!ws.extendsUri) continue;
                if (resolveTargetUri(ws.extendsUri, ws, { constants: constantsHook })?.toString() === childUri) {
                    referencesChild = true;
                    break;
                }
            }
        }

        if (referencesChild && (!best || docUri < bestUri)) {
            best = doc;
            bestUri = docUri;
        }
    }
    return best;
}

// Cached per shared-services instance and auto-invalidated on workspace changes
// (see the constants cache above for the same pattern).
const ancestorChainCaches = new WeakMap<LangiumSharedCoreServices, WorkspaceCache<string, string[]>>();

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
            const parent = findParentDocument(shared, current);
            if (!parent) break;
            const parentUri = parent.uri.toString();
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
// CONSTANTS (!constant / !const / !var) - single shared implementation used by
// the scope provider, the document-link provider, the validator and the builder.
// ─────────────────────────────────────────────────────────────────────────────

/** Collects all !constant/!const/!var declarations from the given root AST node into a map. */
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
 * Returns the constants (!constant/!const/!var) declared in the document with the
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
