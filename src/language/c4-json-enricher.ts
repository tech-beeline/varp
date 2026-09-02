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

import { AstUtils, LangiumSharedCoreServices, type AstNode, type FileSystemNode } from 'langium';
import { Utils, URI } from 'vscode-uri';
import { flatId } from './c4-utils';
import {
    AdrsDirective,
    AdrsFilter,
    isAdrsDirective,
    isC4Document,
    isComponent,
    isContainer,
    isSoftwareSystem,
    isWorkspace,
    type Component,
    type Container,
    type SoftwareSystem,
} from '../generated/ast';

/**
 * Enriches generated render JSON with the Structurizr-only fields the render
 * pipeline does not produce. The render JSON is generated once by C4JsonGenerator
 * and cached; rather than re-generating it, this module takes that cached JSON
 * and injects the missing Structurizr-compatible fields, placing them EXACTLY
 * where the original Structurizr library places them.
 *
 * Currently this covers `documentation` from `!adrs` / `!decisions`:
 *
 *  - `!adrs` / `!decisions` declared inside a `workspace` -> root-level
 *    `documentation.decisions` (a sibling of `model` / `views`).
 *  - `!adrs` / `!decisions` declared inside a SoftwareSystem / Container /
 *    Component -> a nested `documentation.decisions` on that element in the
 *    model (mirroring the Java `Documentable` interface, where each documentable
 *    carries its own `Documentation`).
 *
 * Future additions (e.g. per-element properties/url/perspectives, view order,
 * interactionStyle) should be added here so this stays the single enrichment
 * point. The render pipeline itself is left unchanged.
 *
 * AdrTools format (the default importer in the original Structurizr):
 *   Filename: {DECISION_ID:0000}-*.md
 *   Content:
 *     # {DECISION_ID}. {DECISION_TITLE}
 *     Date: {DECISION_DATE:YYYY-MM-DD}
 *     ## Status
 *     {DECISION_STATUS and links}
 *     ## Context
 *     ...
 */
export class C4JsonEnricher {
    private readonly services: LangiumSharedCoreServices;

    constructor(services: LangiumSharedCoreServices) {
        this.services = services;
    }

    /**
     * Reads all `!adrs` / `!decisions` directives reachable from the root
     * workspace document and injects `documentation` into the given JSON,
     * exactly mirroring how the original library scopes documentation to its
     * documentable (workspace or element owner).
     *
     * The passed JSON is mutated. The caller is expected to hand in a clone of
     * the cached render JSON (see C4GeneratorHandler.getFullContentForUri).
     *
     * @param rootUri  the URI string of the root workspace document
     * @param json     the (cloned) render JSON to enrich
     */
    public async enrich(rootUri: string, json: any): Promise<void> {
        const doc = this.services.workspace.LangiumDocuments.getDocument(URI.parse(rootUri));
        if (!doc) return;
        const root = doc.parseResult.value;
        if (!root) return;

        // workspace-level decisions -> json.documentation.decisions
        const workspaceDecisions: Decision[] = [];
        // element-level decisions, keyed by the name path
        // ("Software System/Web App") of the documentable element.
        const elementDecisions = new Map<string, Decision[]>();

        for (const adrs of AstUtils.streamAllContents(root).filter(isAdrsDirective)) {
            const owner = this.resolveOwner(adrs);
            const decisions = await this.importAdrs(adrs, rootUri);
            if (decisions.length === 0) continue;

            if (owner.kind === 'workspace') {
                this.mergeUnique(workspaceDecisions, decisions);
            } else {
                const existing = elementDecisions.get(owner.pathKey);
                if (existing) {
                    this.mergeUnique(existing, decisions);
                } else {
                    elementDecisions.set(owner.pathKey, decisions);
                }
            }
        }

        if (workspaceDecisions.length > 0) {
            json.documentation = { decisions: workspaceDecisions };
        }

        for (const [pathKey, decisions] of elementDecisions) {
            if (decisions.length === 0) continue;
            const holder = this.findElementInModel(json?.model, pathKey.split('/'));
            if (holder) {
                holder.documentation = { decisions };
            }
        }

        // Inject per-element fields (url/properties/perspectives/technology) that
        // the render pipeline drops when defined directly on the DSL element.
        this.enrichElementFields(root, json?.model, rootUri);
    }

    /** Deduplicates decisions by id (all owner-scoped decisions share one scope). */
    private mergeUnique(target: Decision[], additions: Decision[]): void {
        const existing = new Set(target.map((d) => d.id));
        for (const d of additions) {
            if (!existing.has(d.id)) {
                existing.add(d.id);
                target.push(d);
            }
        }
    }

    /**
     * Injects the per-element fields the render pipeline drops when they are
     * defined directly on the DSL element (url, properties, perspectives,
     * technology). Elements are matched to their JSON counterpart by ID using the
     * same flat-id function the generator uses, so the match is deterministic and
     * unambiguous (no name-path matching).
     */
    private enrichElementFields(root: AstNode, model: any, rootUri: string): void {
        if (!model) return;

        // Build an index of the JSON model: element id -> JSON element object.
        const byId = new Map<string, any>();
        this.indexModel(model, byId);

        for (const node of AstUtils.streamAllContents(root)) {
            if (!this.hasEnrichableFields(node)) continue;
            const nodeId = flatId(node, rootUri);
            const target = byId.get(nodeId);
            if (!target) continue;
            this.applyElementFields(target, node);
        }
    }

    /** Recursively indexes JSON model elements by their id. */
    private indexModel(node: any, byId: Map<string, any>): void {
        if (!node || typeof node !== 'object') return;
        if (Array.isArray(node)) {
            node.forEach((child) => this.indexModel(child, byId));
            return;
        }
        // Structurizr-style element object with an id.
        if (typeof node.id === 'string' && !byId.has(node.id)) {
            byId.set(node.id, node);
        }
        for (const key of Object.keys(node)) {
            if (key.startsWith('$')) continue;
            this.indexModel(node[key], byId);
        }
    }

    private hasEnrichableFields(node: any): boolean {
        return (
            this.astIdentifier(node) !== undefined ||
            (Array.isArray(node?.urlProps) && node.urlProps.length > 0) ||
            (Array.isArray(node?.properties) && node.properties.length > 0) ||
            (Array.isArray(node?.perspectivesBlocks) && node.perspectivesBlocks.length > 0) ||
            (node?.techProps && Array.isArray(node.techProps) && node.techProps.length > 0)
        );
    }

    private applyElementFields(target: any, node: any): void {
        if (target.url === undefined) {
            const url = this.firstPropValue(node.urlProps);
            if (url !== undefined) target.url = url;
        }
        if (target.properties === undefined) {
            const props = this.collectProperties(node.properties);
            if (props) target.properties = props;
        }
        if (target.perspectives === undefined) {
            const perspectives = this.collectPerspectives(node.perspectivesBlocks);
            if (perspectives && perspectives.length > 0) target.perspectives = perspectives;
        }
        if (target.technology === undefined) {
            const tech = this.firstPropValue(node.techProps);
            if (tech !== undefined) target.technology = tech;
        }
        // Structurizr implicitly records the DSL identifier as a property
        // (element.addProperty("structurizr.dsl.identifier", ...)) for every
        // element that is registered with an explicit identifier. Merge it into
        // (or create) the properties map without clobbering other properties.
        const identifier = this.astIdentifier(node);
        if (identifier !== undefined) {
            if (target.properties === undefined) target.properties = {};
            if (target.properties['structurizr.dsl.identifier'] === undefined) {
                target.properties['structurizr.dsl.identifier'] = identifier;
            }
        }
    }

    /** Returns the user-declared DSL identifier of an element/relationship, or undefined. */
    private astIdentifier(node: any): string | undefined {
        const id = node?.id;
        if (id === undefined || id === null) return undefined;
        // ElementAssignment carries the ASSIGNMENT terminal ("name = ..."); keep
        // the raw identifier text (strip only a trailing '=' and surrounding quotes).
        return String(id).replace(/^["']|["']$/g, '').replace(/=\s*$/, '').trim();
    }

    /** Returns the value of the first property-array element, or undefined. */
    private firstPropValue(props: any[] | undefined): string | undefined {
        const first = props?.at(0);
        if (!first) return undefined;
        const value = first.value;
        return typeof value === 'string' ? value.replace(/^["']|["']$/g, '') : undefined;
    }

    /** Reads the first PropertiesBlock items into a flat record. */
    private collectProperties(blocks: any[] | undefined): Record<string, string> | undefined {
        const items = blocks?.at(0)?.items;
        if (!Array.isArray(items) || items.length === 0) return undefined;
        const props: Record<string, string> = {};
        for (const item of items) {
            const name = typeof item?.name === 'string' ? item.name.replace(/^["']|["']$/g, '') : undefined;
            const value = typeof item?.value === 'string' ? item.value.replace(/^["']|["']$/g, '') : undefined;
            if (name && value) props[name] = value;
        }
        return Object.keys(props).length > 0 ? props : undefined;
    }

    /** Reads the first PerspectivesBlock items into Structurizr-compatible objects. */
    private collectPerspectives(blocks: any[] | undefined): any[] | undefined {
        const items = blocks?.at(0)?.items;
        if (!Array.isArray(items) || items.length === 0) return undefined;
        const result: any[] = [];
        for (const item of items) {
            const name = typeof item?.name === 'string' ? item.name.replace(/^["']|["']$/g, '') : undefined;
            if (!name) continue;
            const perspective: any = { name };
            const desc = typeof item?.description === 'string' ? item.description.replace(/^["']|["']$/g, '') : undefined;
            if (desc) perspective.description = desc;
            const value = typeof item?.value === 'string' ? item.value.replace(/^["']|["']$/g, '') : undefined;
            if (value) perspective.value = value;
            const url = this.firstPropValue(item?.urlProps);
            if (url) perspective.url = url;
            result.push(perspective);
        }
        return result.length > 0 ? result : undefined;
    }

    /**
     * Determines the documentable owner of a directive: the workspace itself,
     * or a SoftwareSystem/Container/Component element (identified by its chain
     * of names). Mirrors the Java parser, where `!adrs` is only permitted in
     * Workspace/SoftwareSystem/Container/Component contexts.
     */
    private resolveOwner(adrs: AdrsDirective): { kind: 'workspace' } | { kind: 'element'; pathKey: string } {
        const names: string[] = [];
        let node = adrs.$container as any;
        while (node) {
            if (isWorkspace(node) || isC4Document(node)) {
                return names.length > 0
                    ? { kind: 'element', pathKey: names.join('/') }
                    : { kind: 'workspace' };
            }
            if (isSoftwareSystem(node) || isContainer(node) || isComponent(node)) {
                names.unshift(this.elementName(node));
                node = node.$container;
                continue;
            }
            node = node.$container;
        }
        // No documentable ancestor found - treat as workspace-level (safe default).
        return names.length > 0
            ? { kind: 'element', pathKey: names.join('/') }
            : { kind: 'workspace' };
    }

    /** Returns the AST name of a model element, with quotes stripped. */
    private elementName(node: SoftwareSystem | Container | Component): string {
        const name = (node as any).name;
        return typeof name === 'string' ? name.replace(/^["']|["']$/g, '') : '';
    }

    /**
     * Navigates the render JSON model by a chain of element names:
     * model -> softwareSystems[].containers[].components[]. Elements are matched
     * by name within the correct nesting level (names are unique per level).
     */
    private findElementInModel(model: any, names: string[]): any | undefined {
        let current: any = model;
        for (const name of names) {
            const children = this.jsonChildren(current);
            if (!children) return undefined;
            const next = children.find((c) => c && c.name === name);
            if (!next) return undefined;
            current = next;
        }
        return current;
    }

    /**
     * Returns the child element arrays of a JSON model node, in Structurizr
     * nesting order: softwareSystems, then containers, then components.
     */
    private jsonChildren(node: any): any[] | undefined {
        if (Array.isArray(node?.softwareSystems)) return node.softwareSystems;
        if (Array.isArray(node?.containers)) return node.containers;
        if (Array.isArray(node?.components)) return node.components;
        return undefined;
    }

    /**
     * Imports decisions from a single `!adrs`/`!decisions` directive: resolves
     * the path relative to the root document, reads *.md files (honoring
     * exclude filters) and parses them in the adr-tools format.
     */
    private async importAdrs(adrs: AdrsDirective, rootUri: string): Promise<Decision[]> {
        const rawPath = adrs.path ?? '';
        const path = rawPath.replace(/^["']|["']$/g, '');
        if (!path) return [];

        // Only adrtools is implemented (the default importer). madr/log4brains
        // importers are intentionally left as a follow-up.
        const importer = (adrs.importer ?? '').trim().toLowerCase();
        if (importer && importer !== 'adrtools' && importer !== 'com.structurizr.importer.documentation.AdrToolsDecisionImporter') {
            return [];
        }

        const filters = this.buildFilters(adrs);
        const dirUri = Utils.resolvePath(Utils.dirname(URI.parse(rootUri)), path);
        const fs: any = this.services.workspace.FileSystemProvider;
        if (!fs || typeof fs.readFile !== 'function' || typeof fs.readDirectory !== 'function') {
            return [];
        }

        let entries: { uri: URI; name: string }[];
        try {
            const dirents = await fs.readDirectory(dirUri) as FileSystemNode[];
            entries = dirents
                .filter((e) => e.isFile && e.uri.path.toLowerCase().endsWith('.md'))
                .map((e) => ({ uri: e.uri, name: e.uri.path.split('/').pop() ?? e.uri.toString() }));
        } catch {
            return []; // directory missing/unreadable - nothing to import
        }

        const decisions: Decision[] = [];
        const byFilename = new Map<string, Decision>();

        for (const entry of entries) {
            if (filters.excluded(entry.name)) continue;
            let content: string;
            try {
                content = await fs.readFile(entry.uri);
            } catch {
                continue; // unreadable file - skip
            }
            const decision = parseAdrMarkdown(content, entry.name);
            if (decision) {
                decisions.push(decision);
                byFilename.set(entry.name, decision);
            }
        }

        // Resolve inter-decision links and rewrite file references, mirroring
        // AdrToolsDecisionImporter.
        for (const decision of decisions) {
            extractDecisionLinks(decision, byFilename);
            // Replace "{NNNN}-{slug}.md" references with "#{NNNN}" links.
            let rewritten = decision.content ?? '';
            for (const [filename, target] of byFilename) {
                if (rewritten.includes(filename)) {
                    const href = `#${target.id}`;
                    rewritten = rewritten.split(filename).join(href);
                }
            }
            decision.content = rewritten;
        }

        return decisions;
    }

    /** Builds the exclude filter set from the directive's AdrsFilter nodes. */
    private buildFilters(adrs: AdrsDirective): { excluded: (name: string) => boolean } {
        const excludes: string[] = [];
        for (const f of adrs.filters ?? []) {
            if (!isExcludeFilter(f)) continue;
            for (const p of f.patterns ?? []) {
                const pattern = typeof p === 'string' ? p.replace(/^["']|["']$/g, '') : String(p);
                if (pattern) excludes.push(pattern);
            }
        }
        return {
            excluded: (name: string) =>
                excludes.some((pattern) => name === pattern || name.match(pattern) !== null),
        };
    }
}

function isExcludeFilter(f: AdrsFilter): boolean {
    return /^exclude$/i.test((f.mode ?? '').trim());
}

/**
 * Parses a single adr-tools Markdown file into a Decision (pure function, no I/O).
 *
 * AdrTools format:
 *   Filename: {DECISION_ID:0000}-*.md
 *   Content:
 *     # {DECISION_ID}. {DECISION_TITLE}
 *     Date: {DECISION_DATE:YYYY-MM-DD}
 *     ## Status
 *     {DECISION_STATUS and links}
 *     ## Context
 *     ...
 */
export function parseAdrMarkdown(content: string, filename: string): Decision | undefined {
    const normalized = String(content ?? '').replace(/\r/g, '');
    const lines = normalized.split('\n');

    // ID: first 4 chars of the filename must be numeric (0000-9999).
    let id: string | undefined;
    const head = filename.slice(0, 4);
    if (/^\d{4}$/.test(head)) {
        id = String(parseInt(head, 10));
    } else {
        // AdrTools requires a 4-digit prefix; a leading number without padding is
        // still parseable (e.g. "1-foo.md" -> id "1").
        const m = filename.match(/^(\d+)-/);
        if (m) id = String(parseInt(m[1], 10));
    }
    if (id === undefined) return undefined;

    const titleLine = lines[0] ?? '';
    const title = extractAdrTitle(titleLine);
    if (title === undefined) return undefined;

    return {
        id,
        title,
        date: extractAdrDate(lines),
        status: extractAdrStatus(lines),
        content: normalized,
        format: 'Markdown',
    };
}

/** Title: the first line, "# {DECISION_ID}. {DECISION_TITLE}". */
function extractAdrTitle(titleLine: string): string | undefined {
    const trimmed = titleLine.trim();
    const idx = trimmed.indexOf('.');
    if (idx < 0) return undefined;
    return trimmed.substring(idx + 1).trim();
}

/** Date: a line starting with "Date: " formatted YYYY-MM-DD. */
function extractAdrDate(lines: string[]): string | undefined {
    for (const line of lines) {
        if (line.startsWith('Date: ')) {
            const candidate = line.substring('Date: '.length).trim();
            if (/^\d{4}-\d{2}-\d{2}$/.test(candidate)) return candidate;
        }
    }
    return undefined;
}

/** Status: first non-empty token after "## Status", defaulting to "Proposed". */
function extractAdrStatus(lines: string[]): string {
    let inStatus = false;
    for (const line of lines) {
        if (!inStatus) {
            if (line.startsWith('## Status')) inStatus = true;
        } else {
            const value = line.trim();
            if (value) {
                const status = value.split(/\s+/)[0];
                if (status === 'Superceded') return 'Superseded'; // old adr-tools spelling
                return status;
            }
        }
    }
    return 'Proposed';
}

/** Extracts inter-decision links ("(.*) [.*](...)") from the ## Status section. */
export function extractDecisionLinks(decision: Decision, byFilename: Map<string, Decision>): void {
    const lines = (decision.content ?? '').split('\n');
    let inStatus = false;
    const linkPattern = /(.*) \[.*\]\((.*)\)/;
    const links: DecisionLink[] = [];
    for (const line of lines) {
        if (!inStatus) {
            if (line.startsWith('## Status')) inStatus = true;
            continue;
        }
        if (line.startsWith('## Context')) break;
        const value = line.trim();
        if (!value) continue;
        const m = linkPattern.exec(value);
        if (m) {
            const description = m[1].trim();
            const target = m[2].trim();
            // Map the link target (filename or #id) to a decision id.
            let targetId: string | undefined;
            if (target.startsWith('#')) {
                targetId = target.slice(1);
            } else {
                const byFile = byFilename.get(target);
                targetId = byFile?.id;
            }
            if (targetId && targetId !== decision.id) {
                links.push({ id: targetId, description });
            }
        }
    }
    if (links.length > 0) decision.links = links;
}

/** A Structurizr-compatible decision record. */
export interface Decision {
    id: string;
    title?: string;
    date?: string;
    status?: string;
    content?: string;
    format?: string;
    links?: DecisionLink[];
}

export interface DecisionLink {
    id: string;
    description: string;
}
