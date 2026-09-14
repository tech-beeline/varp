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

import { AstUtils, LangiumSharedCoreServices, type AstNode, type CompositeCstNode } from 'langium';
import { Buffer } from 'buffer';
import { URI } from 'vscode-uri';
import { isInclude } from '../generated/ast';
import * as includeResolver from './c4-include-resolver';

/**
 * Reconstructs the "full DSL" text of a Structurizr workspace the same way the
 * original Java `StructurizrDslParser` does: the parser reads the root `.dsl`
 * file and, before parsing, resolves every `!include "<path>"` by substituting
 * the included file's content at the position of the directive (recursively).
 *
 * We already have the Langium AST + CST and the document graph, so instead of
 * re-parsing text we perform the same inlining using the CST ranges of each
 * `Include` node.
 *
 * - The ROOT document's text is taken as-is.
 * - Every `!include ...` node is replaced (in the output) by the expanded text
 *   of its target document (resolved through the shared include resolver, so
 *   `${CONST}` paths, relative paths and http(s) URLs all work).
 * - Expansion is recursive, cycle-safe and depth-capped so a malformed include
 *   graph (a.g. A includes B, B includes A) cannot hang the server.
 *
 * Returns the reassembled full DSL text; the extension encodes it as base64
 * (UTF-8) for the Structurizr-compatible `workspace.dsl` field.
 */

/** Maximum include nesting depth before expansion stops (cycle protection). */
const MAX_INCLUDE_DEPTH = 100;

/**
 * Builds the fully-expanded DSL text for the workspace whose root document is
 * `rootUri`.
 *
 * @param shared  shared Langium services (document index + file system provider)
 * @param rootUri URI string of the ROOT workspace document (the one that
 *                declares the `workspace`, owns includes, etc.)
 * @param maxDepth optional recursion cap (defaults to MAX_INCLUDE_DEPTH)
 */
export function reconstructFullDsl(
	shared: LangiumSharedCoreServices,
	rootUri: string,
	maxDepth: number = MAX_INCLUDE_DEPTH,
): string {
	const doc = shared.workspace.LangiumDocuments.getDocument(URI.parse(rootUri));
	if (!doc) return '';
	return expandDocumentText(shared, doc, new Set([doc.uri.toString()]), maxDepth);
}

/**
 * Expands every `!include` in a single document's text by recursively inlining
 * the target documents, returning the expanded text.
 */
function expandDocumentText(
	shared: LangiumSharedCoreServices,
	doc: import('langium').LangiumDocument,
	stack: Set<string>,
	maxDepth: number,
): string {
	const text = doc.textDocument.getText();

	// Collect every !include directive with its CST range and resolved target.
	const replacements: { start: number; end: number; text: string }[] = [];
	const root = doc.parseResult.value;
	for (const inc of AstUtils.streamAllContents(root).filter(isInclude)) {
		const cst = inc.$cstNode as CompositeCstNode | undefined;
		if (!cst) continue;

		// Resolve the included document (shared pipeline: quotes/constants/relative/url).
		const target = includeResolver.resolveIncludedDocument(shared, inc.file, inc, {
			withDslFallback: true,
		});
		if (!target) continue; // unresolvable -> leave the directive as-is

		const targetUri = target.uri.toString();
		if (stack.has(targetUri)) continue; // include cycle -> leave the directive as-is
		if (stack.size >= maxDepth) continue; // too deep -> leave the directive as-is

		const expanded = expandDocumentText(shared, target, new Set(stack).add(targetUri), maxDepth);
		replacements.push({ start: cst.offset, end: cst.end, text: expanded });
	}

	if (replacements.length === 0) return text;

	// Splice replacements from the END so earlier absolute offsets stay valid.
	replacements.sort((a, b) => b.start - a.start);
	let result = text;
	for (const r of replacements) {
		result = result.slice(0, r.start) + r.text + result.slice(r.end);
	}
	return result;
}

/** Visitor-free helper to detect whether an AST root contains any !include (tests). */
export function containsIncludes(shared: LangiumSharedCoreServices, rootUri: string): boolean {
	const doc = shared.workspace.LangiumDocuments.getDocument(URI.parse(rootUri));
	if (!doc || !doc.parseResult?.value) return false;
	for (const _inc of AstUtils.streamAllContents(doc.parseResult.value).filter(isInclude)) {
		return true;
	}
	return false;
}

/** AST-based streaming helper for callers that want to iterate includes. */
export function streamIncludes(root: AstNode): Iterable<import('langium').AstNode & { file?: string }> {
	return AstUtils.streamAllContents(root).filter(isInclude) as any;
}

/**
 * Encodes a UTF-8 string as base64 exactly like the original library:
 * `Base64.getEncoder().encodeToString(dsl.getBytes(StandardCharsets.UTF_8))`.
 * Uses the portable `buffer` package (already in the dependency tree via
 * safe-buffer/crypto-browserify, and Node's native `buffer` in Node builds):
 * `Buffer.from(text, 'utf8').toString('base64')` works in both Node and the
 * browser (esbuild resolves `buffer` to the polyfill in web builds).
 */
export function base64EncodeUtf8(text: string): string {
	return Buffer.from(text, 'utf8').toString('base64');
}
