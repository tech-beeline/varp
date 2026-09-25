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

/**
 * Documentation images are embedded as their raw file bytes (base64), with SVG taken
 * as-is and bitmaps not re-encoded, so an animated GIF keeps all of its frames. This
 * is accepted on purpose: the embedded content is only rendered as a data URI, so
 * re-encoding would not change the result.
 */

import { AstUtils, LangiumSharedCoreServices, type AstNode, type FileSystemNode } from 'langium';
import { base64EncodeBytes } from './c4-base64';
import { Utils, URI } from 'vscode-uri';
import { flatId } from './c4-utils';
import { base64EncodeUtf8, reconstructFullDsl } from './c4-dsl-reconstructor';
import {
    AdrsDirective,
    AdrsFilter,
    DocsDirective,
    isAdrsDirective,
    isDocsDirective,
    isC4Document,
    isComponent,
    isContainer,
    isSoftwareSystem,
    isWorkspace,
    type Component,
    type Container,
    type SoftwareSystem,
} from '../generated/ast';

/** The documentation importers with a behaviour implemented here; a Java importer cannot run in TS. */
const DEFAULT_DOCS_IMPORTER = 'com.structurizr.importer.documentation.DefaultDocumentationImporter';
const RECURSIVE_DOCS_IMPORTER = 'com.structurizr.importer.documentation.RecursiveDefaultDocumentationImporter';

// FormatFinder: Markdown and AsciiDoc extensions, compared case-sensitively.
const MARKDOWN_EXTENSIONS = ['.md', '.markdown', '.text'];
const ASCIIDOC_EXTENSIONS = ['.asciidoc', '.adoc', '.asc'];

/** Whether FormatFinder accepts the file as documentation (extension is case-sensitive). */
function isDocumentationFileName(name: string): boolean {
    const dot = name.lastIndexOf('.');
    if (dot < 0) return false;
    const extension = name.substring(dot);
    return MARKDOWN_EXTENSIONS.includes(extension) || ASCIIDOC_EXTENSIONS.includes(extension);
}

/** Image MIME types by lower-case extension, as URLConnection.guessContentTypeFromName resolves them. */
const IMAGE_CONTENT_TYPES: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml'
};

/** FormatFinder.findFormat: Markdown unless the extension is an AsciiDoc one. */
function documentationFormat(name: string): 'Markdown' | 'AsciiDoc' {
    const dot = name.lastIndexOf('.');
    const extension = dot < 0 ? '' : name.substring(dot);
    return ASCIIDOC_EXTENSIONS.includes(extension) ? 'AsciiDoc' : 'Markdown';
}

/**
 * Collects the documentation files of a directory tree, as
 * RecursiveDefaultDocumentationImporter does: each directory is listed in name order,
 * dot-files are skipped and subdirectories are walked (including dot-directories).
 * The relative path is kept for the section filename.
 */
async function collectDocumentationEntries(
    fs: any,
    dirUri: URI,
    prefix: string = ''
): Promise<{ uri: URI; name: string; relative: string }[]> {
    const dirents = (await fs.readDirectory(dirUri)) as FileSystemNode[];
    const sorted = [...dirents].sort((a, b) => {
        const an = a.uri.path.split('/').pop() ?? '';
        const bn = b.uri.path.split('/').pop() ?? '';
        return an < bn ? -1 : an > bn ? 1 : 0;
    });

    const entries: { uri: URI; name: string; relative: string }[] = [];
    for (const dirent of sorted) {
        const name = dirent.uri.path.split('/').pop() ?? dirent.uri.toString();
        const relative = prefix ? `${prefix}/${name}` : name;
        if (dirent.isDirectory) {
            entries.push(...await collectDocumentationEntries(fs, dirent.uri, relative));
        } else if (dirent.isFile && !name.startsWith('.')) {
            entries.push({ uri: dirent.uri, name, relative });
        }
    }
    return entries;
}

/**
 * Enriches generated render JSON with the documentation fields the render
 * pipeline does not produce. The render JSON is generated once by C4JsonGenerator
 * and cached; rather than re-generating it, this module takes that cached JSON
 * and injects the missing fields in the positions the JSON format expects.
 *
 * Currently this covers `documentation` from `!adrs` / `!decisions`:
 *
 *  - `!adrs` / `!decisions` declared inside a `workspace` -> root-level
 *    `documentation.decisions` (a sibling of `model` / `views`).
 *  - `!adrs` / `!decisions` declared inside a SoftwareSystem / Container /
 *    Component -> a nested `documentation.decisions` on that element in the
 *    model (each documentable element carries its own `Documentation`).
 *
 * Future additions (e.g. per-element properties/url/perspectives, view order,
 * interactionStyle) should be added here so this stays the single enrichment
 * point. The render pipeline itself is left unchanged.
 *
 * AdrTools decision format:
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
     * scoping it to its documentable owner (the workspace or an element).
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

        // Workspace-level `dsl`: base64(UTF-8) of the FULL DSL text with
        // `!include` expanded.
        if (json && typeof json.dsl !== 'string') {
            const fullDsl = reconstructFullDsl(this.services, rootUri);
            json.dsl = base64EncodeUtf8(fullDsl);
        }

        // Documentation is collected per documentable owner: the workspace itself, or
        // an element addressed by its chain of names ("Software System/Web App").
        const workspaceDocumentation: DocumentationHolder = { sections: [], decisions: [], images: [] };
        const elementDocumentation = new Map<string, DocumentationHolder>();

        const directives = AstUtils.streamAllContents(root).filter((node) => isAdrsDirective(node) || isDocsDirective(node));
        for (const directive of directives) {
            const owner = this.resolveOwner(directive);
            const target = owner.kind === 'workspace'
                ? workspaceDocumentation
                : this.documentationHolder(owner.pathKey, elementDocumentation);
            // Paths are relative to the file that declares the directive.
            const baseUri = this.directiveBaseUri(directive, rootUri);

            if (isAdrsDirective(directive)) {
                this.mergeUnique(target.decisions, await this.importAdrs(directive, baseUri));
            } else {
                target.sections.push(...await this.importDocs(directive, baseUri));
            }
            // Images are imported from the directive's directory, but only those the
            // documentation or decisions content references (reluctant mode).
            this.mergeImages(target.images, await this.importImages(directive, baseUri, target));
        }

        this.addDocumentation(json, workspaceDocumentation);
        for (const [pathKey, documentation] of elementDocumentation) {
            if (documentation.sections.length === 0 && documentation.decisions.length === 0 && documentation.images.length === 0) continue;
            const holder = this.findElementInModel(json?.model, pathKey.split('/'));
            if (holder) {
                this.addDocumentation(holder, documentation);
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
        // Element object with an id.
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
            (node?.techProps && Array.isArray(node.techProps) && node.techProps.length > 0) ||
            (Array.isArray(node?.healthChecks) && node.healthChecks.length > 0)
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
        if (target.healthChecks === undefined) {
            const healthChecks = this.collectHealthChecks(node.healthChecks);
            if (healthChecks) target.healthChecks = healthChecks;
        }
        // The DSL identifier is recorded as a `structurizr.dsl.identifier`
        // property for every element registered with an explicit identifier.
        // Merge it into (or create) the properties map without clobbering other
        // properties.
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

    /**
     * Reads the health checks of an instance. The interval defaults to 60 seconds and
     * the timeout to 0 milliseconds, the (name, url) pair is unique, and the result is
     * ordered by name then url.
     */
    private collectHealthChecks(checks: any[] | undefined): any[] | undefined {
        if (!Array.isArray(checks) || checks.length === 0) return undefined;
        const unquote = (value: any) => (typeof value === 'string' ? value.replace(/^["']|["']$/g, '') : '');
        const result: any[] = [];
        const seen = new Set<string>();
        for (const check of checks) {
            const name = unquote(check?.name);
            const url = unquote(check?.url);
            // A TreeSet keyed by name and url keeps the first check for each pair.
            const key = `${name}\u0000${url}`;
            if (seen.has(key)) continue;
            seen.add(key);
            const interval = Number.parseInt(String(check?.interval ?? ''), 10);
            const timeout = Number.parseInt(String(check?.timeout ?? ''), 10);
            result.push({
                name,
                url,
                interval: Number.isInteger(interval) && interval >= 1 ? interval : 60,
                timeout: Number.isInteger(timeout) && timeout >= 0 ? timeout : 0
            });
        }
        result.sort((a, b) => (a.name !== b.name
            ? (a.name < b.name ? -1 : 1)
            : (a.url < b.url ? -1 : a.url > b.url ? 1 : 0)));
        return result;
    }

    /** Reads the first PerspectivesBlock items into plain JSON objects. */
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
     * of names). `!adrs` is only permitted in Workspace, SoftwareSystem,
     * Container and Component contexts.
     */
    private resolveOwner(directive: AdrsDirective | DocsDirective): { kind: 'workspace' } | { kind: 'element'; pathKey: string } {
        const names: string[] = [];
        let node = directive.$container as any;
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
     * Returns the child element arrays of a JSON model node, in nesting order:
     * softwareSystems, then containers, then components.
     */
    private jsonChildren(node: any): any[] | undefined {
        if (Array.isArray(node?.softwareSystems)) return node.softwareSystems;
        if (Array.isArray(node?.containers)) return node.containers;
        if (Array.isArray(node?.components)) return node.components;
        return undefined;
    }

    /** Adds images that are not already present, keeping the first one per name (a TreeSet). */
    private mergeImages(target: DocumentationImage[], additions: DocumentationImage[]): void {
        const names = new Set(target.map((image) => image.name));
        for (const image of additions) {
            if (names.has(image.name)) continue;
            names.add(image.name);
            target.push(image);
        }
    }

    /**
     * Names of the images referenced by the documentation content: Markdown
     * `![alt](path)` and AsciiDoc `image:path[alt]`, matched against the image's path
     * relative to the imported directory.
     */
    private referencedImages(documentation: DocumentationHolder): Set<string> {
        const referenced = new Set<string>();
        const collect = (content: string | undefined, format: string | undefined) => {
            if (!content) return;
            // The same greedy patterns DocumentationContent.findImages uses.
            const pattern = format === 'AsciiDoc' ? /image:{1,2}(.*)\[.*]/g : /!\[.*]\((.*)\)/g;
            for (const match of content.matchAll(pattern)) {
                if (match[1] !== undefined) referenced.add(match[1]);
            }
        };
        for (const section of documentation.sections) collect(section.content, section.format);
        for (const decision of documentation.decisions) collect(decision.content, decision.format);
        return referenced;
    }

    /**
     * Imports the images of a directive's directory, as DefaultImageImporter does in
     * reluctant mode: only images referenced by the documentation content are added,
     * directories are walked recursively (hidden ones are skipped) and the raw file
     * bytes are base64 encoded. The reference imports images only when the
     * documentation path is a directory.
     */
    private async importImages(directive: AdrsDirective | DocsDirective, baseUri: string, documentation: DocumentationHolder): Promise<DocumentationImage[]> {
        const path = (directive.path ?? '').replace(/^["']|["']$/g, '');
        if (!path) return [];

        const fs: any = this.services.workspace.FileSystemProvider;
        if (!fs || typeof fs.readDirectory !== 'function' || typeof fs.readBinary !== 'function') {
            // A provider without directory/binary access (e.g. a bare EmptyFileSystem
            // without the web bridge) cannot import images.
            return [];
        }

        const targetUri = Utils.resolvePath(Utils.dirname(URI.parse(baseUri)), path);
        let dirents: FileSystemNode[];
        try {
            dirents = await fs.readDirectory(targetUri) as FileSystemNode[];
        } catch {
            return []; // a single file, not a directory: the reference imports no images
        }

        const referenced = this.referencedImages(documentation);
        if (referenced.size === 0) return [];

        const images: DocumentationImage[] = [];
        await this.collectImages(fs, dirents, '', referenced, images);
        return images;
    }

    /** Recursively collects the referenced images of a directory into `images`. */
    private async collectImages(fs: any, dirents: FileSystemNode[], prefix: string, referenced: Set<string>, images: DocumentationImage[]): Promise<void> {
        for (const entry of dirents) {
            const name = entry.uri.path.split('/').pop() ?? '';
            if (entry.isDirectory) {
                if (name.startsWith('.')) continue; // hidden directories are skipped
                let children: FileSystemNode[];
                try {
                    children = await fs.readDirectory(entry.uri) as FileSystemNode[];
                } catch {
                    continue;
                }
                await this.collectImages(fs, children, prefix ? `${prefix}/${name}` : name, referenced, images);
                continue;
            }
            if (!entry.isFile) continue;
            const dot = name.lastIndexOf('.');
            const contentType = dot < 0 ? undefined : IMAGE_CONTENT_TYPES[name.substring(dot).toLowerCase()];
            if (!contentType) continue;

            const relativeName = prefix ? `${prefix}/${name}` : name;
            if (!referenced.has(relativeName)) continue;

            let bytes: Uint8Array;
            try {
                bytes = await fs.readBinary(entry.uri);
            } catch {
                continue; // unreadable file - skip
            }
            images.push({ content: base64EncodeBytes(bytes), name: relativeName, type: contentType });
        }
    }

    /** Documentation of one documentable owner, collected from its directives. */
    private documentationHolder(pathKey: string, map: Map<string, DocumentationHolder>): DocumentationHolder {
        const existing = map.get(pathKey);
        if (existing) return existing;
        const holder: DocumentationHolder = { sections: [], decisions: [], images: [] };
        map.set(pathKey, holder);
        return holder;
    }

    /**
     * Attaches collected documentation to a JSON holder (the workspace or a model
     * element). Section order is the position within the owner's documentation, as
     * Documentation.calculateOrder numbers them.
     */
    private addDocumentation(holder: any, documentation: DocumentationHolder): void {
        if (!holder) return;
        if (documentation.sections.length === 0 && documentation.decisions.length === 0 && documentation.images.length === 0) return;
        const target = holder.documentation ?? (holder.documentation = {});
        // Keys follow the reference serialization (Jackson sorts properties alphabetically).
        if (documentation.decisions.length > 0) {
            // Documentation.decisions is a TreeSet ordered by id, and each decision's
            // links are a TreeSet ordered by the linked decision id.
            target.decisions = [...documentation.decisions]
                .sort(byDecisionId)
                .map((decision) => decision.links
                    ? { ...decision, links: [...decision.links].sort(byDecisionId) }
                    : decision);
        }
        if (documentation.images.length > 0) {
            // Documentation.images is a TreeSet ordered by image name.
            target.images = [...documentation.images].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
        }
        if (documentation.sections.length > 0) {
            target.sections = documentation.sections.map((section, index) => ({ ...section, order: index + 1 }));
        }
    }

    /** Directory the directive's path is relative to: the document declaring it. */
    private directiveBaseUri(directive: AdrsDirective | DocsDirective, fallbackUri: string): string {
        const document = AstUtils.getDocument(directive as AstNode);
        return document?.uri?.toString() ?? fallbackUri;
    }

    /**
     * Imports documentation sections from a `!docs` directive: one Markdown/AsciiDoc
     * file, or every Markdown/AsciiDoc file of a directory (sorted, dot-files skipped).
     * The directory listing is flat for DefaultDocumentationImporter and recursive for
     * RecursiveDefaultDocumentationImporter. An importer that cannot be run here (any
     * other class) falls back to the default. A single-file import leaves the filename
     * empty because the imported path is trimmed away.
     */
    private async importDocs(docs: DocsDirective, baseUri: string): Promise<Section[]> {
        const path = (docs.path ?? '').replace(/^["']|["']$/g, '');
        if (!path) return [];

        const importer = (docs.importer ?? '').trim();
        const recursive = importer === RECURSIVE_DOCS_IMPORTER;
        if (importer && importer !== DEFAULT_DOCS_IMPORTER && !recursive) {
            // A custom Java importer cannot be executed here, so the default importer
            // (non-recursive) is used instead.
            console.warn(`[C4 Docs] Unsupported documentation importer ${importer}, using the default importer for ${path}`);
        }

        const fs: any = this.services.workspace.FileSystemProvider;
        if (!fs || typeof fs.readFile !== 'function') return [];

        const excluded = this.buildFilter(docs);
        const targetUri = Utils.resolvePath(Utils.dirname(URI.parse(baseUri)), path);
        const nameOf = (uri: URI) => uri.path.split('/').pop() ?? uri.toString();

        let entries: { uri: URI; name: string; relative: string }[] | undefined;
        if (typeof fs.readDirectory === 'function') {
            try {
                entries = recursive
                    ? await collectDocumentationEntries(fs, targetUri)
                    : (await fs.readDirectory(targetUri) as FileSystemNode[])
                        .filter((entry) => entry.isFile && !nameOf(entry.uri).startsWith('.'))
                        .map((entry) => ({ uri: entry.uri, name: nameOf(entry.uri), relative: nameOf(entry.uri) }))
                        // Java sorts the directory listing by path, i.e. by file name here.
                        .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
            } catch {
                entries = undefined; // not a directory (or unreadable)
            }
        }
        const singleFile = entries === undefined;
        if (singleFile) {
            const name = nameOf(targetUri);
            if (!isDocumentationFileName(name)) return [];
            entries = [{ uri: targetUri, name, relative: name }];
        }

        const sections: Section[] = [];
        for (const entry of entries!) {
            if (!isDocumentationFileName(entry.name) || excluded(entry.name)) continue;
            let content: string;
            try {
                // DocumentationContent.setContent normalizes line endings.
                content = (await fs.readFile(entry.uri)).replace(/\r\n|\r|\n/g, '\n');
            } catch {
                continue; // unreadable file - skip
            }
            sections.push({
                // Section.getTitle() returns an empty string, always serialized.
                title: '',
                // The filename is relative to the imported directory (a sub-path in the
                // recursive case); a single-file import trims it away entirely.
                filename: singleFile ? '' : entry.relative,
                content,
                format: documentationFormat(entry.name),
                order: 0 // assigned when the sections are attached to their owner
            });
        }
        return sections;
    }

    /**
     * Imports decisions from a single `!adrs`/`!decisions` directive: resolves the
     * path relative to the root document, reads the decision files (honoring exclude
     * filters) and parses them with the importer selected by the directive.
     */
    private async importAdrs(adrs: AdrsDirective, rootUri: string): Promise<Decision[]> {
        const rawPath = adrs.path ?? '';
        const path = rawPath.replace(/^["']|["']$/g, '');
        if (!path) return [];

        const importer = resolveDecisionImporter(adrs.importer);
        if (!importer) {
            console.warn(`[C4 Docs] Unsupported decision importer ${adrs.importer}, skipping ${path}`);
            return [];
        }

        const excluded = this.buildFilter(adrs);
        const dirUri = Utils.resolvePath(Utils.dirname(URI.parse(rootUri)), path);
        const fs: any = this.services.workspace.FileSystemProvider;
        if (!fs || typeof fs.readFile !== 'function' || typeof fs.readDirectory !== 'function') {
            return [];
        }

        let entries: { uri: URI; name: string }[];
        try {
            const dirents = await fs.readDirectory(dirUri) as FileSystemNode[];
            entries = dirents
                .filter((e) => e.isFile && decisionFileNameMatches(importer, e.uri.path.split('/').pop() ?? ''))
                .map((e) => ({ uri: e.uri, name: e.uri.path.split('/').pop() ?? e.uri.toString() }));
        } catch {
            return []; // directory missing/unreadable - nothing to import
        }

        // madr and log4brains sort the directory listing by file name; adrtools does not.
        if (importer !== 'adrtools') {
            entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
        }

        const decisions: Decision[] = [];
        const byFilename = new Map<string, Decision>();
        let log4brainsId = 1;

        for (const entry of entries) {
            if (excluded(entry.name)) continue;
            let content: string;
            try {
                content = await fs.readFile(entry.uri);
            } catch {
                continue; // unreadable file - skip
            }
            const decision = importer === 'adrtools'
                ? parseAdrMarkdown(content, entry.name)
                : importer === 'madr'
                    ? parseMadrMarkdown(content, entry.name)
                    : parseLog4brainsMarkdown(content, entry.name, String(log4brainsId++));
            if (decision) {
                decisions.push(decision);
                byFilename.set(entry.name, decision);
            }
        }

        // Resolve inter-decision links and rewrite file references ("NNNN-slug.md" -> "#id").
        for (const decision of decisions) {
            if (importer === 'adrtools') {
                extractDecisionLinks(decision, byFilename);
            } else if (importer === 'madr') {
                extractMadrLinks(decision, byFilename);
            } else {
                extractLog4brainsLinks(decision, byFilename);
            }
            let rewritten = decision.content ?? '';
            for (const [filename, target] of byFilename) {
                if (rewritten.includes(filename)) {
                    rewritten = rewritten.split(filename).join(`#${target.id}`);
                }
            }
            decision.content = rewritten;
        }

        return decisions;
    }

    /**
     * Builds the exclude predicate of a directive: an exact file name, or a regex
     * that has to match the whole name (Java's String.matches anchors the pattern).
     */
    private buildFilter(directive: AdrsDirective | DocsDirective): (name: string) => boolean {
        const excludes: string[] = [];
        for (const f of directive.filters ?? []) {
            if (!isExcludeFilter(f)) continue;
            for (const p of f.patterns ?? []) {
                const pattern = typeof p === 'string' ? p.replace(/^["']|["']$/g, '') : String(p);
                if (pattern) excludes.push(pattern);
            }
        }
        return (name: string) => excludes.some((pattern) => {
            if (name === pattern) return true;
            try {
                return new RegExp(`^(?:${pattern})$`).test(name);
            } catch {
                return false; // an invalid regex never matches, as in Java
            }
        });
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
            const date = extractIsoDate(line.substring('Date: '.length));
            if (date) return date;
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

/** Orders decisions and links by their id, as the reference TreeSets do. */
function byDecisionId(a: { id: string }, b: { id: string }): number {
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** The decision formats a `!adrs`/`!decisions` directive can select. */
type DecisionImporter = 'adrtools' | 'madr' | 'log4brains';

/**
 * Resolves the directive's importer: a short type (`adrtools`, `madr`,
 * `log4brains`), the matching fully qualified class name, or the default (adrtools).
 * Returns undefined for an importer that cannot be run here.
 */
function resolveDecisionImporter(value: string | undefined): DecisionImporter | undefined {
    const raw = (value ?? '').trim();
    if (!raw) return 'adrtools';
    const lower = raw.toLowerCase();
    if (lower === 'adrtools' || lower === 'com.structurizr.importer.documentation.adrtoolsdecisionimporter') return 'adrtools';
    if (lower === 'madr' || lower === 'com.structurizr.importer.documentation.madrdecisionimporter') return 'madr';
    if (lower === 'log4brains' || lower === 'com.structurizr.importer.documentation.log4brainsdecisionimporter') return 'log4brains';
    return undefined;
}

/** The file name each importer accepts (case-sensitive, like the reference). */
function decisionFileNameMatches(importer: DecisionImporter, name: string): boolean {
    if (importer === 'madr') return /^\d{4}-.+\.md$/.test(name);
    if (importer === 'log4brains') return /^\d{8}-.+\.md$/.test(name);
    return name.endsWith('.md');
}

/**
 * A "yyyy-MM-dd" value as an ISO instant at UTC midnight, or undefined when the text
 * is not such a date. UTC midnight keeps the value deterministic and portable.
 */
function extractIsoDate(value: string | undefined): string | undefined {
    const candidate = (value ?? '').trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(candidate) ? `${candidate}T00:00:00Z` : undefined;
}

/** Splits a leading Markdown front matter block ("--- ... ---") from the body. */
function splitFrontMatter(content: string): { frontMatter: string[]; body: string } {
    const lines = content.split('\n');
    if (lines[0] !== '---') return { frontMatter: [], body: content };
    const end = lines.indexOf('---', 1);
    if (end < 0) return { frontMatter: [], body: content };
    return { frontMatter: lines.slice(1, end), body: lines.slice(end + 1).join('\n') };
}

/**
 * Parses a single MADR Markdown file into a Decision (pure function, no I/O).
 *
 * MADR format:
 *   Filename: {DECISION_ID:0000}-*.md
 *   Content:
 *     ---
 *     status: {DECISION_STATUS}
 *     date: {DECISION_DATE:YYYY-MM-DD}
 *     ---
 *     # {DECISION_TITLE}
 *     ...
 */
export function parseMadrMarkdown(content: string, filename: string): Decision | undefined {
    const normalized = String(content ?? '').replace(/\r/g, '');
    const id = filename.match(/^\d{4}/)?.[0];
    if (!id) return undefined;

    const { frontMatter, body } = splitFrontMatter(normalized);
    const frontMatterValue = (prefix: string) => {
        const line = frontMatter.find((candidate) => candidate.startsWith(prefix));
        return line?.substring(prefix.length);
    };

    return {
        id: String(parseInt(id, 10)),
        title: extractMadrTitle(body),
        date: extractIsoDate(frontMatterValue('date: ')),
        status: frontMatterValue('status: ') ?? 'accepted',
        content: body,
        format: 'Markdown',
    };
}

/** MADR title: the first "# " line, defaulting to "Title". */
function extractMadrTitle(body: string): string {
    for (const line of body.split('\n')) {
        if (line.startsWith('# ')) return line.substring(2);
    }
    return 'Title';
}

/**
 * Parses a single Log4brains Markdown file into a Decision (pure function, no I/O).
 *
 * Log4brains format:
 *   Filename: {YYYYMMDD}-*.md
 *   Content:
 *     # {DECISION_TITLE}
 *     - Date: {DECISION_DATE:YYYY-MM-DD}
 *     - Status: {DECISION_STATUS}
 */
export function parseLog4brainsMarkdown(content: string, filename: string, id: string): Decision | undefined {
    const normalized = String(content ?? '').replace(/\r/g, '');
    const lines = normalized.split('\n');

    const statusLine = lines.find((line) => line.startsWith('- Status: '));
    const statusValue = statusLine?.substring('- Status: '.length) ?? '';

    const dateLine = lines.find((line) => line.startsWith('- Date: '));
    const date = extractIsoDate(dateLine?.substring('- Date: '.length)) ?? extractIsoDate(log4brainsFileDate(filename));

    const firstLine = lines[0] ?? '';
    return {
        id,
        title: firstLine.length >= 2 ? firstLine.substring(2) : firstLine,
        date,
        // An empty status is omitted (NON_EMPTY serialization).
        status: statusValue ? (statusValue.startsWith('superseded') ? 'superseded' : statusValue) : undefined,
        content: normalized,
        format: 'Markdown',
    };
}

/** Date from a Log4brains file name ("yyyyMMdd-slug.md" -> "yyyy-MM-dd"). */
function log4brainsFileDate(filename: string): string | undefined {
    const head = filename.slice(0, 8);
    if (!/^\d{8}$/.test(head)) return undefined;
    return `${head.slice(0, 4)}-${head.slice(4, 6)}-${head.slice(6, 8)}`;
}

/** MADR links: every Markdown link to another decision, described as "Links to". */
export function extractMadrLinks(decision: Decision, byFilename: Map<string, Decision>): void {
    const links: DecisionLink[] = [];
    const seen = new Set<string>();
    for (const line of (decision.content ?? '').split('\n')) {
        for (const match of line.matchAll(/\[.*]\((.*)\)/g)) {
            const target = byFilename.get(match[1].trim());
            if (target && target.id !== decision.id && !seen.has(target.id)) {
                seen.add(target.id);
                links.push({ id: target.id, description: 'Links to' });
            }
        }
    }
    if (links.length > 0) decision.links = links;
}

/** Log4brains links: from the "- Status:" line and the "## Links" section. */
export function extractLog4brainsLinks(decision: Decision, byFilename: Map<string, Decision>): void {
    const links: DecisionLink[] = [];
    const seen = new Set<string>();
    const add = (description: string, file: string) => {
        const target = byFilename.get(file.trim());
        if (target && target.id !== decision.id && !seen.has(target.id)) {
            seen.add(target.id);
            links.push({ id: target.id, description: description.trim() });
        }
    };

    let inLinksSection = false;
    for (const line of (decision.content ?? '').split('\n')) {
        const statusMatch = /- Status: (.*) \[.*]\((.*)\)/.exec(line);
        if (statusMatch) add(statusMatch[1], statusMatch[2]);

        if (line.startsWith('## Links')) inLinksSection = true;
        if (inLinksSection) {
            const linkMatch = /- (.*) \[.*]\((.*)\)/.exec(line);
            if (linkMatch) add(linkMatch[1], linkMatch[2]);
        }
    }
    if (links.length > 0) decision.links = links;
}

/** A documentation section: one imported Markdown/AsciiDoc file. */
export interface Section {
    title: string;
    filename: string;
    content: string;
    format: 'Markdown' | 'AsciiDoc';
    order: number;
}

/** Documentation collected for one documentable owner. */
interface DocumentationHolder {
    sections: Section[];
    decisions: Decision[];
    images: DocumentationImage[];
}

/** A documentation image: base64 content, its path relative to the imported directory and MIME type. */
export interface DocumentationImage {
    content: string;
    name: string;
    type: string;
}

/** A decision record. */
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
