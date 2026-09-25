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

import { AstUtils, type AstNode, type LangiumDocument, type LangiumSharedCoreServices } from 'langium';
import { Buffer } from 'buffer';
import { URI } from 'vscode-uri';
import {
	isAdrsDirective,
	isContainer,
	isDocsDirective,
	isIconProperty,
	isImageSource,
	isImpliedRelationshipsProperty,
	isInclude,
	isKrokiSource,
	isMermaidSource,
	isPlantUMLSource,
	isScriptDirective,
	isThemeProperty,
	isThemesProperty,
	isWorkspace,
	type ImageSource,
	type KrokiSource,
	type MermaidSource,
	type PlantUMLSource,
} from '../generated/ast';
import * as includeResolver from './c4-include-resolver';

/**
 * The Structurizr DSL parser retains a workspace's DSL source as the
 * `structurizr.dsl` workspace property (base64 of the UTF-8 text), but only for
 * "portable" workspaces. A workspace stops being portable as soon as it depends
 * on something outside the DSL text: a local file include or extend, local
 * assets (icons, themes, image views), documentation/decision imports, plugins,
 * scripts or a custom implied-relationships strategy.
 *
 * The retained text is the root document's own lines, rejoined with the host
 * line separator and without a trailing line break. Included documents are not
 * inlined, and the parent of an `extends` is never part of the text.
 */

/** Fully-qualified implied-relationships strategies that keep a workspace portable. */
const BUILT_IN_IMPLIED_RELATIONSHIPS_STRATEGIES = new Set([
	'com.structurizr.model.DefaultImpliedRelationshipsStrategy',
	'com.structurizr.model.CreateImpliedRelationshipsUnlessAnyRelationshipExistsStrategy',
	'com.structurizr.model.CreateImpliedRelationshipsUnlessSameRelationshipExistsStrategy',
]);

/** Line separator of the host running the parser, used to rejoin the retained DSL. */
export function lineSeparator(): string {
	const platform = typeof process !== 'undefined' ? process.platform : undefined;
	if (platform) return platform === 'win32' ? '\r\n' : '\n';
	if (typeof navigator !== 'undefined' && /Windows/i.test(navigator.userAgent)) return '\r\n';
	return '\n';
}

/** Encodes a UTF-8 string as base64, working in both Node and browser builds. */
export function base64EncodeUtf8(text: string): string {
	return Buffer.from(text, 'utf8').toString('base64');
}

/**
 * Reconstructs the retained DSL text of the workspace rooted at `rootUri`: the
 * root document's lines, rejoined with the host line separator, without a
 * trailing line break. Returns an empty string when the document is unknown.
 */
export function retainedDslText(shared: LangiumSharedCoreServices, rootUri: string): string {
	const doc = shared.workspace.LangiumDocuments.getDocument(URI.parse(rootUri));
	if (!doc) return '';
	const lines = doc.textDocument.getText().split(/\r?\n/);
	if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
	return lines.join(lineSeparator());
}

/** True when the `structurizr.dsl.source` workspace property allows retaining the source. */
export function isDslSourceRetained(properties: unknown): boolean {
	if (!properties || typeof properties !== 'object') return true;
	const value = (properties as Record<string, unknown>)['structurizr.dsl.source'];
	if (value === undefined || value === null) return true;
	return String(value).toLowerCase() === 'true';
}

/**
 * True when the workspace rooted at `rootUri` is portable and therefore keeps
 * its DSL source. Walks the root document and every document it includes, since
 * constructs inside an included fragment also make the workspace non-portable.
 */
export function isDslPortable(shared: LangiumSharedCoreServices, rootUri: string): boolean {
	const doc = shared.workspace.LangiumDocuments.getDocument(URI.parse(rootUri));
	if (!doc) return false;
	return documentIsPortable(shared, doc, new Set([doc.uri.toString()]));
}

function documentIsPortable(shared: LangiumSharedCoreServices, doc: LangiumDocument, visited: Set<string>): boolean {
	const root = doc.parseResult.value;
	if (!root) return true;

	const nodes: AstNode[] = [root, ...AstUtils.streamAllContents(root)];
	for (const node of nodes) {
		if (isWorkspace(node) && node.extendsUri && isLocalTarget(shared, node.extendsUri, node)) {
			return false;
		}
		if (isInclude(node)) {
			if (isLocalTarget(shared, node.file, node)) return false;
			const target = includeResolver.resolveIncludedDocument(shared, node.file, node, { withDslFallback: true });
			if (target) {
				const targetUri = target.uri.toString();
				if (!visited.has(targetUri)) {
					visited.add(targetUri);
					if (!documentIsPortable(shared, target, visited)) return false;
				}
			}
		}
		if (isDocsDirective(node) || isAdrsDirective(node) || isScriptDirective(node)) {
			return false;
		}
		// `!plugin` is parsed as a plain string, so it is detected through the array
		// that holds it rather than by node type. `!components` is only valid inside a
		// container; `ElementExtension.components` holds real component nodes and must
		// not be mistaken for it.
		if (hasEntries(node, 'plugins') || (isContainer(node) && node.components.length > 0)) return false;
		if (isImpliedRelationshipsProperty(node) && !isBuiltInImpliedRelationshipsStrategy(node.value)) {
			return false;
		}
		if (isIconProperty(node) && isLocalAsset(shared, node.value, node)) return false;
		if (isThemeProperty(node) && isLocalTheme(shared, node.value, node)) return false;
		if (isThemesProperty(node) && node.values.some((value) => isLocalTheme(shared, value, node))) return false;
		if (isImageSourceNode(node) && isLocalImageSource(shared, node.value, node)) return false;
	}
	return true;
}

function isImageSourceNode(node: AstNode): node is PlantUMLSource | MermaidSource | KrokiSource | ImageSource {
	return isPlantUMLSource(node) || isMermaidSource(node) || isKrokiSource(node) || isImageSource(node);
}

/** True when the node carries a non-empty string array under the given field. */
function hasEntries(node: AstNode, field: string): boolean {
	const value = (node as unknown as Record<string, unknown>)[field];
	return Array.isArray(value) && value.length > 0;
}

function isBuiltInImpliedRelationshipsStrategy(value: string): boolean {
	const option = includeResolver.stripPathQuotes(String(value ?? ''));
	if (/^(true|false)$/i.test(option)) return true;
	return BUILT_IN_IMPLIED_RELATIONSHIPS_STRATEGIES.has(option);
}

/** Resolves a path for gate checks: quotes stripped, ${CONST} substituted. */
function resolvedPath(shared: LangiumSharedCoreServices, raw: unknown, node: AstNode): string {
	let value = includeResolver.stripPathQuotes(String(raw ?? ''));
	try {
		value = includeResolver.substituteConstants(shared, value, node);
	} catch {
		// constant lookup failed (e.g. unparsed document) - keep the raw path
	}
	return value;
}

function isUrl(value: string): boolean {
	return /^https?:\/\//i.test(value);
}

/** True for a local file/directory target; http(s) targets are portable. */
function isLocalTarget(shared: LangiumSharedCoreServices, raw: unknown, node: AstNode): boolean {
	return !isUrl(resolvedPath(shared, raw, node));
}

/** True for a local asset (icon): data URIs and http(s) URLs are portable. */
function isLocalAsset(shared: LangiumSharedCoreServices, raw: unknown, node: AstNode): boolean {
	const value = resolvedPath(shared, raw, node);
	return !value.startsWith('data:image/') && !isUrl(value);
}

/** True for a file-based theme; `default`, installed and http(s) themes are portable. */
function isLocalTheme(shared: LangiumSharedCoreServices, raw: unknown, node: AstNode): boolean {
	const value = resolvedPath(shared, raw, node);
	return value.toLowerCase() !== 'default' && !isUrl(value);
}

/** True for a file-based image-view source; inline text blocks and URLs are portable. */
function isLocalImageSource(shared: LangiumSharedCoreServices, raw: unknown, node: AstNode): boolean {
	if (String(raw ?? '').trimStart().startsWith('"""')) return false;
	const value = resolvedPath(shared, raw, node);
	return !value.startsWith('data:') && !isUrl(value);
}
