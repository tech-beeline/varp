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

import { AstNode, AstUtils, Reference, isReference } from 'langium';
import { URI } from 'vscode-uri';
import { flatId, C4Utils, archetypeChain, archetypeInstanceType, declaredIdentifier, type FlatIdResolvers } from './c4-utils';
import { parseQuotedFilterText, type QuotedFilterParseResult } from './c4-quoted-filter';
import { encodePlantUml } from './plantuml-encoder';
import { layoutDot } from './graphviz-layout';

import {
    Workspace, Container,
    Relationship, isSoftwareSystem, isContainer, isComponent,
    isPerson, isRelationship, NamedElement, isNamedElement,
    ViewExpression,
    isSingleElementExpression,
    isElementTypeExpression, isElementParentExpression, isElementTagExpression,
    isElementTechnologyExpression, isElementPropertiesExpression, isElementGroupExpression,
    isRelationshipTagExpression, isRelationshipSourceExpression, isRelationshipDestinationExpression,
    isRelationshipPropertiesExpression, isRelationshipEqExpression,
    isAfferentCouplingExpression, isEfferentCouplingExpression, isAfferentEfferentExpression,
    isStarToElementExpression, isStarFromElementExpression, isStarStarExpression,
    isDirectCouplingExpression,
    isElementEqAfferentExpression, isElementEqEfferentExpression, isElementEqAfferentEfferentExpression,
    isElementEqExpression, isElementNotEqExpression,
    ImplicitRelationship,
    isImplicitRelationship, isInfrastructureNode,
    isSoftwareSystemInstance, isContainerInstance, isGenericInstance,
    isNoRelationship,
    isDeploymentEnvironment, DeploymentNode,
    ViewsBlock, SystemContextView, isWorkspace, isC4Document,
    isViewsBlock, ElementStyle, RelationshipStyle, isStylesBlock,
    PropertiesBlock, TerminologyBlock,
    StylesBlock, isModelBlock, isConstant, Constant, Include, isInclude, isGroup, isDeploymentNode,
    isArchetypesBlock, ArchetypesBlock, isArchetypeInstance, isArchetypeNamed, ArchetypeDefinition, isImageView, isPlantUMLSource, isImageSource,
    isDeploymentView, DynamicMember, isDynamicStep, isParallelStepBlock,
    DynamicView, isContainerView,
    isSystemLandscapeView, isSystemContextView,
    C4Document,
    SoftwareSystem,
    Component,
    RelationshipMember,
    isRelationshipMember,
    isComponentView,
    isDynamicView,
    isCustomElement,
    SoftwareSystemInstance,
    GenericInstance,
    ContainerInstance,
    InfrastructureNode,
    Group,
    isFilteredView,
    isCustomView,
    Person,
    CustomElement,
    DeploymentView,
    ModelBlock,
    IncludeProperty,
    ExcludeProperty,
    isIncludeProperty,
    isImpliedRelationshipsProperty,
    isBinaryExpression,
    isElementsDirective,
    ElementsDirective,
    isRelationshipsDirective,
    RelationshipsDirective,
    isRelationshipExtension,
    RelationshipExtension,
    ElementExtension,
    isElementExtension,
    isStringLiteralExpression} from '../generated/ast';
import { C4Services } from './c4-module';
import * as includeResolver from './c4-include-resolver';
import { SHAPE_NORMALIZE, BORDER_NORMALIZE, ROUTING_NORMALIZE, ICON_POSITION_NORMALIZE } from './c4-validator';

// Default theme constants
const DEFAULT_THEME_URL = "https://static.structurizr.com/themes/default/theme.json";
const DEFAULT_THEME_NAME = "default";

/** Compares strings by UTF-16 code unit, matching the ordering of the model's style set. */
function compareCodeUnits(a: string, b: string): number {
    if (a < b) return -1;
    if (a > b) return 1;
    return 0;
}

/**
 * Orders element/relationship styles the way the model serialises them: styles
 * without a colour scheme first (by tag), then styles with one (by scheme/tag).
 */
function compareStylesByTag(a: any, b: any): number {
    const aScheme = a?.colorScheme ?? null;
    const bScheme = b?.colorScheme ?? null;
    if (aScheme === null && bScheme === null) return compareCodeUnits(String(a?.tag ?? ''), String(b?.tag ?? ''));
    if (aScheme === null) return -1;
    if (bScheme === null) return 1;
    return compareCodeUnits(`${aScheme}/${a?.tag ?? ''}`, `${bScheme}/${b?.tag ?? ''}`);
}

/** Paper margin kept around the diagram on every side (px). */
const PAPER_MARGIN = 400;

/**
 * Sizes the view's paper to its content the same way the graphviz layout does: the
 * content bounds (element boxes, frame boxes and relationship vertices) plus
 * {@link PAPER_MARGIN} on every side, with the content shifted so every margin is
 * equal. Used when element coordinates are set outside the graphviz layout (drawio
 * import, text measurement).
 *
 * `frameBounds` are the auto-drawn frames (deployment nodes, groups, scope boundaries);
 * the frame elements carry no size, so their boxes are passed in explicitly.
 */
export function fitViewToContent(view: any, frameBounds: { x: number; y: number; width: number; height: number }[] = []): void {
    // Leaf elements carry a size; frames do not (the renderer derives them from their
    // children), so they are only measured through `frameBounds`.
    const isSized = (el: any) => typeof el?.x === 'number' && typeof el?.y === 'number'
        && typeof el?.width === 'number' && typeof el?.height === 'number';

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const include = (x: number, y: number, w: number, h: number) => {
        minX = Math.min(minX, x); minY = Math.min(minY, y);
        maxX = Math.max(maxX, x + w); maxY = Math.max(maxY, y + h);
    };
    for (const el of view?.elements ?? []) {
        if (!isSized(el)) continue;
        include(el.x, el.y, el.width, el.height);
    }
    for (const frame of frameBounds) include(frame.x, frame.y, frame.width, frame.height);
    for (const rel of view?.relationships ?? []) {
        for (const v of rel?.vertices ?? []) {
            if (typeof v?.x === 'number' && typeof v?.y === 'number') include(v.x, v.y, 0, 0);
        }
    }
    if (minX === Infinity) { minX = PAPER_MARGIN; minY = PAPER_MARGIN; maxX = PAPER_MARGIN; maxY = PAPER_MARGIN; }

    const paperW = Math.max(2 * PAPER_MARGIN, (maxX - minX) + 2 * PAPER_MARGIN);
    const paperH = Math.max(2 * PAPER_MARGIN, (maxY - minY) + 2 * PAPER_MARGIN);
    const shiftX = PAPER_MARGIN - minX;
    const shiftY = PAPER_MARGIN - minY;

    for (const el of view?.elements ?? []) {
        if (!isSized(el)) continue;
        el.x = Math.floor(el.x + shiftX);
        el.y = Math.floor(el.y + shiftY);
    }
    for (const rel of view?.relationships ?? []) {
        for (const v of rel?.vertices ?? []) {
            if (typeof v?.x === 'number') v.x = Math.round(v.x + shiftX);
            if (typeof v?.y === 'number') v.y = Math.round(v.y + shiftY);
        }
    }

    view.dimensions = { width: Math.ceil(paperW), height: Math.ceil(paperH) };
}


const DEFAULT_ELEMENT_FONT_SIZE = 24;

// Minimum deviation (in points) of a polyline point from the straight source->target
// line for an edge to be treated as bent and get vertices. Generous on purpose:
// graphviz fans near-parallel edges (e.g. two edges from one node to two targets
// that are almost aligned) across the nodesep gap with a small (~15-30pt) deviation;
// those small "separation" bends are suppressed so the webview draws the edge as a
// clean straight line, while genuinely routed bends (cross-cluster detours) remain.
const BEND_DEVIATION_THRESHOLD = 35;

// Webview frame padding: a frame
// wraps its content with clusterPadding (50) on every side plus a bottom footer for
// the name/metadata text - 50 + margin(15) + nameFontSize + metadataFontSize + 15.
// nameFontSize/metadataFontSize are the element's fontSize (default 24) times the
// name/metadata difference ratios, exactly like the webview (parseInt truncates
// 24*1.4 = 33.6 -> 33 and 24*0.7 = 16.8 -> 16). Groups have no metadata footer.
const WEBVIEW_CLUSTER_PADDING = 50;
const WEBVIEW_FRAME_MARGIN = 15;
// Structurizr diagrams are laid out for 300dpi, so one graphviz point is 300/72px.
const GRAPHVIZ_POINTS_PER_PX = 72 / 300;
// Visual gap between two frames the default cluster margin already produces: the
// graphviz separation is max(nodesep, 2 * margin) points while each frame extends
// 50px beyond its content on every side (2 * 25pt - 2 * 50px in this space).
const DOT_FRAME_GAP_PX = 108;
const NAME_FONT_SIZE_DIFFERENCE_RATIO = 1.4;
const METADATA_FONT_SIZE_DIFFERENCE_RATIO = 0.7;

interface Styles {
    elements: ElementStyle [];
    relationships: RelationshipStyle[];
}

interface ImpliedRelationship {
    relationship: Relationship;
    linked: Relationship | undefined;
    source: RelationshipMember;
    target: RelationshipMember;
    /**
     * Marks a relationship replicated onto a deployment instance. Unlike implied
     * relationships of the static structure, these are not subject to the
     * one-relationship-per-pair rule: the reference library copies the parent
     * element's relationship set onto every instance and deduplicates by
     * source/destination/description only.
     */
    projected?: boolean;
}

/**
 * A text the renderer draws inside a frame and measures to size it. The frame of a
 * software system, container, group or deployment node is sized from its name and
 * metadata, so the auto-layout has to know those widths before it can place
 * neighbouring elements without an overlap.
 */
interface TextMeasurementCandidate {
    /** Unique across the workspace: view key, cluster id and text kind. */
    key: string;
    kind: 'element-name' | 'element-metadata' | 'group-name';
    /** Element whose name/metadata is drawn (element-* kinds). */
    elementId?: string;
    /** Metadata candidates: whether the renderer appends the element technology. */
    withTechnology?: boolean;
    /** Group path segment drawn as the frame name (group-name kind). */
    groupName?: string;
}

/** Measurement candidates of one view plus the cluster structure needed to apply them. */
interface ViewTextMeasurements {
    candidates: TextMeasurementCandidate[];
    /** Cluster id → keys of the texts drawn inside that cluster. */
    clusters: Record<string, string[]>;
    /** Cluster/node id → child ids (the cluster tree of the DOT graph). */
    children: Record<string, string[]>;
    /** Node id → rendered width in px (lower bound for a frame's content width). */
    nodeWidths: Record<string, number>;
}

/**
 * The frame (cluster) tree of a laid-out view, mirroring the renderer's embedded
 * cells: `childrenOf` maps a cluster id to its children (cluster ids or element ids)
 * and `clusterKind` classifies each cluster. A group frame shows no metadata line, so
 * its bottom padding is smaller. Used to recompute the paper size when element
 * coordinates change outside the graphviz layout (drawio import).
 */
interface FrameTree {
    childrenOf: Record<string, string[]>;
    clusterKind: Record<string, 'scope' | 'group' | 'deploy'>;
}

/**
 * Bounded cache of Graphviz layout results keyed by the DOT graph. graphviz.layout()
 * is a pure function of the DOT, so the -Tjson result of an unchanged graph can be
 * reused across generate() calls: an edit that leaves a view's DOT untouched skips
 * the graphviz run for it.
 */
class GraphvizLayoutCache {
    private readonly entries = new Map<string, any>();

    constructor(private readonly limit = 32) {
    }

    get(dot: string): any | undefined {
        const layout = this.entries.get(dot);
        if (layout !== undefined) {
            // Promote on read, so the least recently used entry is evicted first.
            this.entries.delete(dot);
            this.entries.set(dot, layout);
        }
        return layout;
    }

    set(dot: string, layout: any): void {
        this.entries.delete(dot);
        this.entries.set(dot, layout);
        while (this.entries.size > this.limit) {
            const oldest = this.entries.keys().next().value;
            if (oldest === undefined) break;
            this.entries.delete(oldest);
        }
    }
}

class JsonGenerator {
    private readonly services: C4Services;
    private readonly constants: Map<string, string> = new Map<string, string>();
    private readonly styles: Styles = { elements: [], relationships: [] };
    private readonly themes: Set<string> = new Set<string>;
    /** DSL identifier → name of every DeploymentGroup declared in a deployment environment. */
    private readonly deploymentGroupsByIdentifier: Map<string, string> = new Map<string, string>();
    private readonly propertiesWorkspace: Record<string, string> = {};
    private readonly propertiesModel: Record<string, string> = {};
    private readonly propertiesViews: Record<string, string> = {};
    private readonly elements: NamedElement[] = [];
    /** Groups declared in the workspace; view filters address them by identifier. */
    private readonly groups: Group[] = [];
    private readonly relationships: Relationship[] = [];
    /** Index of relationships by resolved source element id (rebuilt after !elements synthetic pushes). */
    private readonly relationshipsBySource: Map<string, Relationship[]> = new Map();
    /** Explicit relationships indexed by their DSL identifier. */
    private readonly relationshipsByIdentifier: Map<string, Relationship> = new Map();
    /** Unnamed archetypes keyed by base type keyword (or '->' for relationships). */
    private readonly defaultArchetypes: Map<string, any> = new Map();
    /** NoRelationship (`-/>`) directives collected from deployment environments. */
    private readonly noRelationshipNodes: any[] = [];
    /** Relationships declared directly in a deployment environment/node (or a `-/>` body) before instance projection. */
    private readonly deploymentContextRelationships: Array<{ rel: any; noRelationship?: any }> = [];
    /** Static relationship each `-/>` directive removed, used for description/technology inheritance. */
    private readonly noRelationshipInheritance: Map<any, Relationship | undefined> = new Map();
    /** Resolved `-/>` suppressions: projected instance relationships matching these are not emitted. */
    private readonly noRelationshipSuppressions: Array<{ env: string; sourceIds: Set<string>; targetIds: Set<string>; description?: string }> = [];
    /** URI string of the root workspace document - elements defined there keep the short id hash. */
    private rootDocUri: string | undefined;
    /** Document URI → depth in the workspace `extends` chain (entry = 0, extended base = 1, ...). */
    private extendsDepths: Map<string, number> = new Map();
    /** Element → source position within its extends block, for instance id tie-breaking. */
    private elementSourcePositions: Map<AstNode, number> = new Map();
    /** Maps include file URI → list of Include directives that reference it (for resolving !elements/!relationships context) */
    private readonly includeContexts: Map<string, Include[]> = new Map();
    /** Range-based impliedRelationships flags per document URI: URI → sorted list of {fromOffset, toOffset, enabled} */
    private readonly impliedRangesByDoc: Map<string, Array<{ from: number; to: number; enabled: boolean }>> = new Map();
    /** Group separator character, defaults to "/". Can be configured via structurizr.groupSeparator property */
    private groupSeparator: string = '/';
    /** Maps element ID (via getId) → group path string. Replaces mutation of AST $cstNode.groupPath */
    private readonly groupPathMap: Map<string, string> = new Map();
    /** ArchetypeInstance AST node → the base-type element materialised from it. */
    private readonly materialized: Map<any, any> = new Map();
    /** Overlay modifications applied by !elements directives: element ID → modifications */
    private readonly elementOverlays: Map<string, {
        description?: string;
        technology?: string;
        tags?: string[];
        url?: string;
        properties?: Record<string, string>;
        perspectives?: any[];
    }> = new Map();
    /** Overlay modifications applied by !relationships directives: relationship ID → modifications */
    private readonly relationshipOverlays: Map<string, {
        tags?: string[];
        url?: string;
        technology?: string;
        properties?: Record<string, string>;
        perspectives?: any[];
    }> = new Map();
    /**
     * Children/overlays contributed by `!element` directives (ElementExtension),
     * keyed by the TARGET AST node (NOT mutated) so extraction functions can look
     * up what to add to a generated element. Added in generate() before model
     * extraction, so transform* methods can fold them in.
     */
    private readonly elementExtensionsByTarget: Map<NamedElement, ElementExtension[]> = new Map();

    /**
     * Cache for quoted view filters, keyed by filter
     * text. The filter content is re-parsed on demand.
     */
    private readonly quotedFilterExpressions: Map<string, QuotedFilterParseResult> = new Map();
    /** References that belong to unlinked quoted-filter expressions; resolved by $refText, never by .ref. */
    private readonly quotedFilterReferences = new WeakSet<object>();

    /** Terminology overrides for diagram rendering (person, softwareSystem, container, etc.), populated from workspace terminology blocks */
    private terminology: Record<string, string> = {};
    /** Metadata symbol style (MetadataSymbols enum name), defaulting to SquareBrackets. */
    private metadataSymbols: string | undefined;

    /**
     * Global view order and auto-key flag, keyed by the view AST node. Views are
     * numbered in creation order across every view type, starting at 1.
     */
    private readonly viewOrderByNode = new Map<any, { order: number; generatedKey: boolean }>();

    /**
     * DOT graph and measurement candidates of every auto-laid-out view. Kept after the
     * first layout so applyTextMeasurements can re-run the layout with the widths the
     * renderer measured, without rebuilding the DOT from the AST.
     */
    private readonly viewLayouts: Map<string, { dot: string; measurements: ViewTextMeasurements }> = new Map();

    /** Frame (cluster) tree per view key, kept so the paper can be refitted after an import. */
    private readonly frameTrees: Map<string, FrameTree> = new Map();

    /** Maps the `metadata` directive keyword to its MetadataSymbols enum name. */
    private static readonly METADATA_SYMBOLS: Record<string, string> = {
        'square': 'SquareBrackets',
        'round': 'RoundBrackets',
        'curly': 'CurlyBrackets',
        'angle': 'AngleBrackets',
        'double-angle': 'DoubleAngleBrackets',
        'none': 'None'
    };
    /** Element styles loaded from external themes (!theme), mirroring structurizr.ui.themes. */
    private readonly themeStyles: any[] = [];
    /** Relationship styles loaded from external themes (!theme), mirroring structurizr.ui.themes[].relationships. */
    private readonly themeRelationshipStyles: any[] = [];
    /** Merged element style map (theme + workspace) keyed by tag, built lazily for Graphviz node sizing. */
    private elementStyleMap: Record<string, any> | undefined = undefined;
    /** Shared across every generate() call, so an unchanged DOT is laid out once. */
    private readonly layoutCache?: GraphvizLayoutCache;

    constructor(services: C4Services, layoutCache?: GraphvizLayoutCache) {
        this.services = services;
        this.layoutCache = layoutCache;
    }

    /**
     * Entry point: generates the complete Structurizr-compatible JSON for the given workspace.
     * Orchestrates all collection phases (constants, styles, themes, properties, terminology,
     * elements, relationships) and then assembles the final model + views output.
     */
    public async generate(workspace: Workspace): Promise<any> {
        this.rootDocUri = AstUtils.getDocument(workspace)?.uri.toString();
        this.collectConstants(workspace);
        this.collectStyles(workspace);
        this.collectThemes(workspace);

        // Download external theme files (!theme) so element sizes defined by
        // themes are reflected in the Graphviz layout (the webview downloads the
        // same files at render time via loadTheme).
        await this.collectThemeStyles();
        this.collectProperties(workspace);
        this.collectTerminology(workspace);
        this.collectDefaultArchetypes(workspace);

        // Read group separator from model properties, default is "/"
        this.groupSeparator = this.propertiesModel["structurizr.groupSeparator"]
            ? C4Utils.stripQuotes(this.propertiesModel["structurizr.groupSeparator"])
            : '/';

        this.collectElementsRelationships(workspace);
        // Extends depths (base-first instance ordering) and source positions within
        // each extends block (same-depth instance ordering), computed in one walk.
        const extendsInfo = this.computeExtendsInfo(workspace);
        this.extendsDepths = extendsInfo.depths;
        this.elementSourcePositions = extendsInfo.positions;
        // Resolve `-/>` directives and project deployment-context relationships onto
        // instances before indexing relationships by source.
        this.buildNoRelationshipSuppressions();
        this.expandDeploymentContextRelationships();
        // Index relationships by their resolved source element so the per-element
        // extractRelationshipsFor* lookups don't scan the whole relationship list.
        this.buildRelationshipsBySource();
        this.collectImpliedFlags(workspace);

        // Resolve DeploymentGroupOrTag ambiguity for instance nodes (ContainerInstance,
        // SoftwareSystemInstance, GenericInstance). Must happen after collectLocal() fills
        // this.elements, so all DeploymentGroups are known. If the ambiguous value matches
        // a known DeploymentGroup name, it stays as a group reference; otherwise it's added
        // to node.tags.
        this.resolveAllInstanceValues();

        // Process !elements and !relationships directives after all elements/relationships are collected
        this.processElementsDirectives(workspace);
        this.processRelationshipsDirectives(workspace);

        // Collect !element (ElementExtension) contributions keyed by target AST node.
        this.collectElementExtensions(workspace);

        const themesArray = Array.from(this.themes);

        const model = {
            properties: Object.keys(this.propertiesModel).length > 0 ? this.propertiesModel : undefined,
            customElements: this.extractCustomElements(),
            people: this.extractPeople(),
            softwareSystems: this.extractSystems(),
            deploymentNodes: this.extractAllRootDeploymentNodes()
        };

        // Number views in creation order across every view type (1-based).
        this.assignViewOrder(workspace);

        // Assemble the final JSON output object in Structurizr-compatible format
        const jsonOutput = {
            // A DSL workspace has no server-side id. The renderer treats id 0 as the
            // playground and prints the current date, so any other value keeps the
            // diagram metadata block on the workspace's own timestamp.
            id: 1,
            name: this.workspaceName(workspace),
            description: this.workspaceDescription(workspace),
            // Documentable nodes always carry a documentation object (empty when the
            // workspace has none), because clients read `documentation.sections`.
            documentation: {},
            properties: Object.keys(this.propertiesWorkspace).length > 0 ? this.propertiesWorkspace : undefined,
            configuration: this.workspaceConfiguration(workspace),
            // lastModifiedDate/lastModifiedAgent are added by the extension host, which
            // is the only side that can read the file timestamp in the web build too.
            model: model,
            views: {
                systemLandscapeViews: this.extractSystemLandscapeViews(workspace, model),
                systemContextViews: this.extractSystemContextViews(workspace, model),
                containerViews: this.extractContainerViews(workspace, model),
                componentViews: this.extractComponentViews(workspace, model),
                deploymentViews: this.extractDeploymentViews(workspace, model),
                dynamicViews: this.extractDynamicViews(workspace),
                filteredViews: this.extractFilteredViews(workspace),
                customViews:  this.extractCustomViews(workspace),
                imageViews: this.extractImageViews(workspace),
                configuration: {
                    properties: Object.keys(this.propertiesViews).length > 0 ? this.propertiesViews : undefined,
                    themes: themesArray.length > 0 ? themesArray : undefined,
                    // Styles and terminology are always serialized, even when empty.
                    styles: this.styles.elements.length > 0 || this.styles.relationships.length > 0
                        ? {
                            elements: [...this.styles.elements].sort(compareStylesByTag),
                            relationships: [...this.styles.relationships].sort(compareStylesByTag)
                        }
                        : {},
                    terminology: this.terminology,
                    metadataSymbols: this.metadataSymbols
                }
            }
        };

        // Run Graphviz in the plugin (full model context) and bake the resulting
        // coordinates/sizes directly into the view JSON. The webview then renders
        // at these positions instead of re-running a layout itself.
        await this.applyGraphvizAutoLayouts(jsonOutput);

        return jsonOutput;
    }

    /**
     * Collect terminology overrides from workspace configuration.
     * Maps type keys (person, softwareSystem, container, etc.) to custom display terms.
     * Used by Structurizr renderer to replace default type labels in diagrams.
     */
    private collectTerminology(node: AstNode | undefined, visited: Set<string> = new Set()): void {
        if (!node) return;
        const nodeUri = AstUtils.getDocument(node)?.uri.toString();
        if (nodeUri && visited.has(nodeUri)) return;
        if (nodeUri) visited.add(nodeUri);

        // Terminology blocks live inside `views` blocks, so inspect the node itself
        // plus any wrapped workspaces (a C4Document root wraps its workspaces).
        const containers: (C4Document | Workspace)[] = [];
        if (isC4Document(node)) containers.push(node, ...node.workspaces);
        else if (isWorkspace(node)) containers.push(node);
        for (const container of containers) {
            if (isC4Document(container)) {
                this.extractTerminologyBlock(container.terminology);
            }
            container.viewsBlocks.forEach((views) => {
                if (views.terminology) {
                    this.extractTerminologyBlock(views.terminology);
                }
            });
        }

        // Recurse into includes
        const includes = isC4Document(node) || isWorkspace(node) ? node.includes : undefined;
        if (includes) {
            for (const inc of includes) {
                if (!inc.file) continue;
                const resolved = this.resolveIncludedRoot(node, inc.file);
                if (resolved) {
                    this.collectTerminology(resolved, visited);
                }
            }
        }
    }

    /**
     * Extract terminology values from TerminologyBlock arrays.
     * Maps Structurizr keys: person, softwareSystem, container, component,
     * deploymentNode, infrastructureNode, relationship. The metadata symbol is
     * not part of terminology: it maps to configuration.metadataSymbols.
     */
    private extractTerminologyBlock(blocks: TerminologyBlock[]): void {
        const term = (value: string) => C4Utils.stripQuotes(value);
        for (const termBlock of blocks) {
            if (termBlock.person?.length > 0) {
                this.terminology['person'] = term(termBlock.person[0]);
            }
            if (termBlock.softwareSystem?.length > 0) {
                this.terminology['softwareSystem'] = term(termBlock.softwareSystem[0]);
            }
            if (termBlock.container?.length > 0) {
                this.terminology['container'] = term(termBlock.container[0]);
            }
            if (termBlock.component?.length > 0) {
                this.terminology['component'] = term(termBlock.component[0]);
            }
            if (termBlock.deploymentNode?.length > 0) {
                this.terminology['deploymentNode'] = term(termBlock.deploymentNode[0]);
            }
            if (termBlock.infrastructureNode?.length > 0) {
                this.terminology['infrastructureNode'] = term(termBlock.infrastructureNode[0]);
            }
            if (termBlock.relationship?.length > 0) {
                this.terminology['relationship'] = term(termBlock.relationship[0]);
            }
            if (termBlock.metadata?.length > 0) {
                const mapped = JsonGenerator.METADATA_SYMBOLS[String(termBlock.metadata[0]).toLowerCase()];
                if (mapped) {
                    this.metadataSymbols = mapped;
                }
            }
        }
    }

    /**
     * Collects !impliedRelationships flags as CST-offset ranges across all documents.
     * Each !impliedRelationships {true|false} directive creates a range from its offset
     * to the next directive's offset (or end of file). Propagates through !include and extends.
     */
    private collectImpliedFlags(
        node: AstNode | undefined,
        visited: Set<string> = new Set<string>(),
        inheritedFlag?: boolean,
        inheritFromOffset: number = 0
    ): void {
        if (!node) return;
        
        const docUri = AstUtils.getDocument(node)?.uri.toString();
        if (docUri) {
            if (visited.has(docUri)) return;
            visited.add(docUri);
        }

        // Get or create the ranges array for this document; the visited guard above
        // guarantees the first visit per document, so no has() check is needed here
        if (docUri) {
            this.impliedRangesByDoc.set(docUri, []);
        }
        const ranges = docUri ? this.impliedRangesByDoc.get(docUri)! : null;

        // Current flag value
        let currentFlag = inheritedFlag ?? true;
        let currentOffset = inheritFromOffset;
        // Every descendant node of this document (Langium streams feature children,
        // not cross-reference targets, so the set matches the structural tree). The
        // traversal order is irrelevant: directives are sorted by offset and the
        // document end is a max over all nodes.
        const allNodes: AstNode[] = [...AstUtils.streamAllContents(node)];

        // Collect all ImpliedRelationshipsProperty nodes with their offset and value
        const directiveOffsets: Array<{ offset: number; enabled: boolean }> = [];
        for (const currentNode of allNodes) {
            if (isImpliedRelationshipsProperty(currentNode)) {
                const rawVal = currentNode.value;
                const val = this.substitute(rawVal);
                const enabled = val === 'true';
                const offset = currentNode.$cstNode?.offset ?? 0;
                directiveOffsets.push({ offset, enabled });
            }
        }

        // Sort by offset
        directiveOffsets.sort((a, b) => a.offset - b.offset);

        // Determine document range: from start to the last node's end
        const docEndOffset = allNodes.length > 0
            ? Math.max(...allNodes.map(n => (n.$cstNode?.offset ?? 0) + (n.$cstNode?.length ?? 0)))
            : 0;

        // If there's an inherited flag, create range from inheritFromOffset to first directive (or end)
        if (inheritedFlag !== undefined && ranges) {
            const firstDirective = directiveOffsets[0];
            const rangeEnd = firstDirective ? firstDirective.offset : docEndOffset;
            if (rangeEnd > inheritFromOffset) {
                ranges.push({ from: inheritFromOffset, to: rangeEnd, enabled: inheritedFlag });
            }
        } else if (ranges) {
            // Without inheritance, use default flag (true) from the start
            const firstDirective = directiveOffsets[0];
            const rangeEnd = firstDirective ? firstDirective.offset : docEndOffset;
            if (rangeEnd > 0) {
                ranges.push({ from: 0, to: rangeEnd, enabled: true });
            }
        }

        // Create ranges between consecutive directives
        if (ranges) {
            for (let i = 0; i < directiveOffsets.length; i++) {
                const current = directiveOffsets[i];
                const next = directiveOffsets[i + 1];
                const rangeTo = next ? next.offset : docEndOffset;
                if (rangeTo > current.offset) {
                    ranges.push({ from: current.offset, to: rangeTo, enabled: current.enabled });
                }
            }
        }

        // Process !include files with the current flag
        const includes = isC4Document(node) || isWorkspace(node) ? node.includes : undefined;
        if (includes) {
            for (const includeDirective of includes) {
                if (includeDirective.file) {
                    const includedRoot = this.resolveIncludedRoot(node, includeDirective.file);
                    if (includedRoot) {
                        const includeOffset = includeDirective.$cstNode?.offset ?? 0;
                        // Find the flag active at the include point
                        let flagAtInclude = currentFlag;
                        for (const d of directiveOffsets) {
                            if (d.offset <= includeOffset) {
                                flagAtInclude = d.enabled;
                            }
                        }
                        this.collectImpliedFlags(includedRoot, visited, flagAtInclude, includeOffset);
                    }
                }
            }
        }

        // Process extends
        if (isWorkspace(node) && node.extendsUri) {
            const parentWs = this.resolveParentWorkspace(node, node.extendsUri);
            if (parentWs) {
                this.collectImpliedFlags(parentWs, visited, currentFlag);
            }
        }
    }

    /**
     * Checks whether implied relationships should be generated for a node at the given CST offset.
     * Looks up the range containing the offset and returns its flag value.
     * Returns true (generate) if no range is found (backward compatibility).
     */
    private isImpliedEnabledForOffset(docUri: string, cstOffset: number): boolean {
        const ranges = this.impliedRangesByDoc.get(docUri);
        if (!ranges) return true;
        for (const range of ranges) {
            if (cstOffset >= range.from && cstOffset < range.to) {
                return range.enabled;
            }
        }
        return true; // Default: enabled
    }

    /**
     * Determines whether implied relationships should be generated for the given AST node.
     * Checks by CST offset (source code position) within its document.
     */
    private shouldGenerateImplied(node: AstNode | undefined): boolean {
        if (!node) return false;
        const docUri = AstUtils.getDocument(node)?.uri.toString();
        const offset = node.$cstNode?.offset;
        if (offset !== undefined && docUri) {
            return this.isImpliedEnabledForOffset(docUri, offset);
        }
        return true; // fallback: generate implied relationships
    }

    /**
     * Nodes of one document that several collection phases need: constants, default
     * archetypes, includes and named elements, gathered in one traversal per document.
     */
    private readonly documentScans = new Map<string, {
        constants: Constant[];
        archetypes: ArchetypesBlock[];
        includes: Include[];
        namedElements: NamedElement[];
    }>();

    private scanDocument(root: AstNode): {
        constants: Constant[];
        archetypes: ArchetypesBlock[];
        includes: Include[];
        namedElements: NamedElement[];
    } {
        const doc = AstUtils.getDocument(root);
        const key = doc?.uri.toString() ?? '';
        const cached = this.documentScans.get(key);
        if (cached) return cached;
        const scan = { constants: [] as Constant[], archetypes: [] as ArchetypesBlock[], includes: [] as Include[], namedElements: [] as NamedElement[] };
        for (const content of AstUtils.streamAllContents(doc?.parseResult?.value ?? root)) {
            if (isConstant(content)) scan.constants.push(content);
            else if (isInclude(content) && content.file) scan.includes.push(content);
            else if (isArchetypesBlock(content)) scan.archetypes.push(content);
            else if (isNamedElement(content)) scan.namedElements.push(content);
        }
        this.documentScans.set(key, scan);
        return scan;
    }

    /**
     * Unified method for collecting constants (!const directives) across documents and includes.
     */
    private collectConstants(node: AstNode | undefined, visited: Set<string> = new Set<string>()): void {
        if (!node) return;

        // Always start from the document root (C4Document) so constants declared
        // OUTSIDE the workspace block (top-level !const) are collected too.
        // Matches the scope provider's substituteConstants, which scans the
        // document's parse result rather than the workspace node.
        const root = AstUtils.getDocument(node)?.parseResult?.value ?? node;

        const docUri = AstUtils.getDocument(root)?.uri.toString();
        if (docUri) {
            if (visited.has(docUri)) return;
            visited.add(docUri);
        }

        // Constants may be declared at document, workspace, model, or element level,
        // and !include directives may appear top-level, inside model blocks, or nested
        // in elements. Gather both in a single walk of the document subtree, then apply
        // constants first (so they take precedence over included ones) and recurse into
        // the includes — matching the original two-pass order.
        const scan = this.scanDocument(root);
        for (const c of scan.constants) {
            const name = (c.name ?? '').toString().replace(/['"]/g, '');
            const rawValue = (c.value ?? '').toString();
            const value = rawValue.trimStart().startsWith('"""')
                ? C4Utils.textBlockValue(rawValue)
                : (typeof rawValue === 'string' ? rawValue.replace(/^['"]|['"]$/g, '') : rawValue);
            if (name && !this.constants.has(name)) this.constants.set(name, value);
        }
        for (const inc of scan.includes) {
            const includedRoot = this.resolveIncludedRoot(inc, inc.file);
            if (includedRoot) this.collectConstants(includedRoot, visited);
        }

        // Constants and variables are inherited from an extended workspace.
        const workspace = isWorkspace(root) ? root
            : (isC4Document(root) ? root.workspaces.find(isWorkspace) : undefined);
        if (workspace?.extendsUri) {
            const parent = this.resolveParentWorkspace(workspace, workspace.extendsUri);
            if (parent) this.collectConstants(parent, visited);
        }
    }

    /**
     * Resolves the root AST node of an included file by its relative path from the context node.
     * Substitutes ${CONST} placeholders (matching resolvePathToUri in the scope provider) and
     * falls back to appending a missing .dsl extension (matching C4DocumentBuilder.loadIncludeFile).
     * Looks up the target document in LangiumDocuments and returns its parsed AST root.
     */
    private resolveIncludedRoot(contextNode: AstNode, relativePath: string): AstNode | undefined {
        // Single shared resolution pipeline (quotes, ${CONST} from the document
        // index, http(s), relative paths, .dsl fallback) - matches the document
        // builder, validator and scope provider, so remote and ${CONST}-based
        // includes resolve to the SAME URI the builder loaded (unlike the
        // generator's own output-templating substitute).
        return includeResolver.resolveIncludedRoot(this.services.shared, relativePath, contextNode, {
            withDslFallback: true,
            constants: (path, node) => includeResolver.substituteConstants(this.services.shared, path, node),
        });
    }

    /**
     * Collects unnamed archetype definitions, which act as defaults for every
     * element/relationship declared with the matching type keyword. Included and
     * extended documents are searched too; the extending workspace wins.
     */
    private collectDefaultArchetypes(node: AstNode | undefined, visited: Set<string> = new Set<string>()): void {
        if (!node) return;
        const docUri = AstUtils.getDocument(node)?.uri.toString();
        if (docUri && visited.has(docUri)) return;
        if (docUri) visited.add(docUri);

        // Gather archetype blocks and !include directives in a single walk, then apply
        // archetypes first (so they take precedence over included ones) and recurse into
        // the includes — matching the original two-pass order.
        const scan = this.scanDocument(node);
        for (const block of scan.archetypes) {
            for (const definition of block.definitions ?? []) {
                if (isArchetypeNamed(definition)) continue;
                const key = this.archetypeTypeKey(definition);
                if (key && !this.defaultArchetypes.has(key)) {
                    this.defaultArchetypes.set(key, definition);
                }
            }
        }
        for (const inc of scan.includes) {
            const includedRoot = this.resolveIncludedRoot(node, inc.file);
            if (includedRoot) this.collectDefaultArchetypes(includedRoot, visited);
        }

        if (isWorkspace(node) && node.extendsUri) {
            const parent = this.resolveParentWorkspace(node, node.extendsUri);
            if (parent) this.collectDefaultArchetypes(parent, visited);
        }
    }

    /** Base type keyword ('softwaresystem', ...) or '->' an unnamed archetype applies to. */
    private archetypeTypeKey(definition: ArchetypeDefinition | undefined): string | undefined {
        if (typeof definition?.baseType === 'string' && definition.baseType) {
            return definition.baseType.toLowerCase();
        }
        if (definition?.baseArrow) return '->';
        return undefined;
    }

    /** Effective type keyword of a node, used to look up its default archetype. */
    private effectiveArchetypeType(node: AstNode | undefined): string | undefined {
        if (isRelationship(node) || isImplicitRelationship(node)) return '->';
        if (isArchetypeInstance(node)) {
            const type = archetypeInstanceType(node);
            return type === 'Relationship' ? '->' : type?.toLowerCase();
        }
        if (isPerson(node)) return 'person';
        if (isSoftwareSystem(node)) return 'softwaresystem';
        if (isContainer(node)) return 'container';
        if (isComponent(node)) return 'component';
        if (isGroup(node)) return 'group';
        if (isCustomElement(node)) return 'element';
        if (isDeploymentNode(node)) return 'deploymentnode';
        if (isInfrastructureNode(node)) return 'infrastructurenode';
        return undefined;
    }

    /**
     * Archetypes applying to a node: its own archetype chain from the nearest
     * definition outward, followed by the type's default archetype when that
     * default was declared before the chain's outermost definition.
     */
    private archetypeChainFor(node: AstNode | undefined): any[] {
        const chain = archetypeChain(node);
        const key = this.effectiveArchetypeType(node);
        const fallback = key ? this.defaultArchetypes.get(key) : undefined;
        if (fallback && !chain.includes(fallback)) {
            const anchor = chain.length > 0 ? chain[chain.length - 1] : node;
            if (this.archetypePrecedes(fallback, anchor)) chain.push(fallback);
        }
        return chain;
    }

    /** Whether an archetype definition appears before another node in the same document. */
    private archetypePrecedes(archetype: any, node: any): boolean {
        const archetypeDoc = AstUtils.getDocument(archetype)?.uri.toString();
        const nodeDoc = AstUtils.getDocument(node)?.uri.toString();
        if (!archetypeDoc || !nodeDoc || archetypeDoc !== nodeDoc) return true;
        const archetypeOffset = archetype.$cstNode?.offset ?? -1;
        const nodeOffset = node.$cstNode?.offset ?? -1;
        return archetypeOffset < nodeOffset;
    }

    /** Perspectives contributed by the node's nearest archetype. */
    private archetypePerspectives(node: AstNode | undefined): any[] | undefined {
        const archetype = this.archetypeChainFor(node)[0];
        return archetype ? this.perspectivesToJson(archetype.perspectivesBlocks) : undefined;
    }

    /** Properties contributed by the node's nearest archetype. */
    private archetypeProperties(node: AstNode | undefined): Record<string, string> | undefined {
        const archetype = this.archetypeChainFor(node)[0];
        if (!archetype) return undefined;
        const properties: Record<string, string> = {};
        for (const block of archetype.properties ?? []) {
            for (const item of block?.items ?? []) {
                const name = C4Utils.stripQuotes(String(item?.name ?? ''));
                if (name) properties[name] = C4Utils.stripQuotes(String(item?.value ?? ''));
            }
        }
        return Object.keys(properties).length > 0 ? properties : undefined;
    }

    /**
     * Collects element and relationship styles from workspace, views, and C4Document nodes.
     * Recursively processes styles from included files.
     */
    private collectStyles(node: AstNode | undefined, visited: Set<string> = new Set<string>) {
        if (!node) return;
        const docUri = AstUtils.getDocument(node)?.uri.toString();
        if (docUri && visited.has(docUri)) return;
        if (docUri) visited.add(docUri);
        // Styles of an extended workspace come before the extending workspace's own.
        if (isWorkspace(node) && node.extendsUri) {
            const parent = this.resolveParentWorkspace(node, node.extendsUri);
            if (parent) this.collectStyles(parent, visited);
        }
        if (isStylesBlock(node)) {
            this.processStylesBlock(node, visited);
        } else if (isViewsBlock(node)) {
            const stylesBlock = node.stylesProps?.at(0);
            if (stylesBlock) {
                this.processStylesBlock(stylesBlock, visited);
            }
        } else if (isWorkspace(node)) {
            const views = node.viewsBlocks?.at(0);
            if (views) {
                const stylesBlock = views.stylesProps?.at(0);
                if (stylesBlock) {
                    this.processStylesBlock(stylesBlock, visited);
                }
            }
        } else if (isC4Document(node)) {
            const views = node.viewsBlocks?.at(0);
            if (views) {
                const stylesBlock = views.stylesProps?.at(0);
                if (stylesBlock) {
                    this.processStylesBlock(stylesBlock, visited);
                }
            }
            // Process stylesProps directly at document root
            const stylesBlock = node.stylesProps?.at(0);
            if(stylesBlock) this.processStylesBlock(stylesBlock, visited);
            // Process flat element styles at file root
            node.elementStyles?.forEach(style => this.styles.elements.push(this.transformElementStyle(style)));
            // Process flat relationship styles at file root
            node.relationshipStyles?.forEach(style => this.styles.relationships.push(this.transformRelationshipStyle(style)));
            // Process root-level light/dark style blocks
            for (const light of node.lightBlocks ?? []) this.addStyleBlock(light, 'Light');
            for (const dark of node.darkBlocks ?? []) this.addStyleBlock(dark, 'Dark');
        }
        const includes = isC4Document(node) || isWorkspace(node) ? node.includes : undefined;
        includes?.forEach((includeDirective: Include) => {
            if (includeDirective.file) {
                const includedRoot = this.resolveIncludedRoot(node, includeDirective.file);
                if (includedRoot) {
                    this.collectStyles(includedRoot, visited);
                }
            }
        });
    }
    
    /**
     * Processes a StylesBlock: transforms element styles and relationship styles
     * (including the light/dark colour-scheme variants), then recurses into any
     * include directives within the block.
     */
    private processStylesBlock(block: StylesBlock, visited: Set<string>) {
        this.addStyleBlock(block, undefined);
        for (const light of block.lightBlocks ?? []) this.addStyleBlock(light, 'Light');
        for (const dark of block.darkBlocks ?? []) this.addStyleBlock(dark, 'Dark');
        if (block.includes && Array.isArray(block.includes)) {
            for (const inc of block.includes) {
                if (inc.file) {
                    const root = this.resolveIncludedRoot(block, inc.file);
                    this.collectStyles(root, visited);
                }
            }
        }
    }

    /** Transforms the element and relationship styles of a styles/light/dark block. */
    private addStyleBlock(block: { elementStyles?: ElementStyle[]; relationshipStyles?: RelationshipStyle[] }, colorScheme: string | undefined): void {
        block.elementStyles?.forEach(style => this.styles.elements.push(this.transformElementStyle(style, colorScheme)));
        block.relationshipStyles?.forEach(style => this.styles.relationships.push(this.transformRelationshipStyle(style, colorScheme)));
    }

    /**
     * Reads the text a style property node holds: the `value` of its single child,
     * with surrounding quotes removed. Returns undefined when the property is absent.
     */
    private stylePropertyText(prop: any[] | string | undefined): string | undefined {
        if (typeof prop === 'string') return C4Utils.stripQuotes(prop);
        const val = prop?.at(0);
        if (val === undefined || val === null) return undefined;
        const raw = (typeof val === 'object' && 'value' in val) ? val.value : val;
        if (raw === undefined || raw === null) return undefined;
        return C4Utils.stripQuotes(String(raw));
    }

    /** Adds a string style property, with surrounding quotes removed. */
    private addStringIfDefined(target: any, key: string, prop: any[] | string | undefined): void {
        const value = this.stylePropertyText(prop);
        if (value !== undefined && value !== '') target[key] = value;
    }

    /** Adds an integer style property. */
    private addNumberIfDefined(target: any, key: string, prop: any[] | string | undefined): void {
        const value = this.stylePropertyText(prop);
        if (value === undefined || value === '') return;
        const parsed = Number.parseInt(value, 10);
        if (Number.isFinite(parsed)) target[key] = parsed;
    }

    /** Adds an integer style property clamped to the given inclusive range. */
    private addClampedNumberIfDefined(target: any, key: string, prop: any[] | string | undefined, min: number, max: number): void {
        const value = this.stylePropertyText(prop);
        if (value === undefined || value === '') return;
        const parsed = Number.parseInt(value, 10);
        if (!Number.isFinite(parsed)) return;
        target[key] = Math.min(max, Math.max(min, parsed));
    }

    /** Adds a hex colour style property, lower-cased. */
    private addColorIfDefined(target: any, key: string, prop: any[] | string | undefined): void {
        const value = this.stylePropertyText(prop);
        if (value !== undefined && value !== '') target[key] = value.toLowerCase();
    }

    /** Adds a style property normalised through the given enum name map. */
    private addEnumIfDefined(target: any, key: string, prop: any[] | string | undefined, map: Record<string, string>): void {
        const value = this.stylePropertyText(prop);
        if (value === undefined || value === '') return;
        target[key] = map[value.toLowerCase()] ?? value;
    }

    /**
     * Adds a boolean style property, reading the 'true'/'false' text the DSL stores and
     * writing the JSON boolean the viewer expects.
     */
    private addBooleanIfDefined(target: any, key: string, prop: any[] | undefined): void {
        const value = this.stylePropertyText(prop);
        if (value === undefined || value === '') return;
        target[key] = value.toLowerCase() === 'true';
    }

    /**
     * Collects a list of properties blocks into a flat record; a later line wins
     * on a key collision and entries with an empty name or value are skipped.
     */
    private propertiesToRecord(blocks: Array<{ items?: Array<{ name?: string; value?: string }> }> | undefined): Record<string, string> | undefined {
        if (!Array.isArray(blocks) || blocks.length === 0) return undefined;
        const props: Record<string, string> = {};
        for (const block of blocks) {
            for (const item of block?.items ?? []) {
                const name = C4Utils.stripQuotes(item?.name);
                const value = C4Utils.stripQuotes(item?.value);
                if (name && value) props[name] = value;
            }
        }
        return Object.keys(props).length > 0 ? props : undefined;
    }

    /** Collects a style's user properties; a later line wins on a key collision. */
    private styleProperties(style: { properties?: Array<{ items?: Array<{ name?: string; value?: string }> }> }): Record<string, string> | undefined {
        return this.propertiesToRecord(style?.properties);
    }

    /**
     * Transforms an ElementStyle AST node into the JSON object the viewer expects:
     * integer fields stay numbers, hex colours are lower-cased, and shape/border/icon
     * position are normalised to the PascalCase the model serialises.
     */
    private transformElementStyle(style: ElementStyle, colorScheme?: string) {
        const result: any = {};
        this.addStringIfDefined(result, 'tag', style.tag);
        if (colorScheme) result.colorScheme = colorScheme;
        this.addNumberIfDefined(result, 'width', style.widthProps);
        this.addNumberIfDefined(result, 'height', style.heightProps);
        this.addColorIfDefined(result, 'background', style.backgroundProps);
        this.addColorIfDefined(result, 'stroke', style.strokeProps);
        this.addClampedNumberIfDefined(result, 'strokeWidth', style.strokeWidthProps, 1, 10);
        this.addColorIfDefined(result, 'color', style.colorProps);
        this.addNumberIfDefined(result, 'fontSize', style.fontSizeProps);
        this.addEnumIfDefined(result, 'shape', style.shapeProps, SHAPE_NORMALIZE);
        this.addStringIfDefined(result, 'icon', style.iconProps);
        this.addEnumIfDefined(result, 'iconPosition', style.iconPositionProps, ICON_POSITION_NORMALIZE);
        this.addEnumIfDefined(result, 'border', style.borderProps, BORDER_NORMALIZE);
        this.addClampedNumberIfDefined(result, 'opacity', style.opacityProps, 0, 100);
        this.addBooleanIfDefined(result, 'metadata', style.metadataProps);
        this.addBooleanIfDefined(result, 'description', style.descriptionProp);
        const props = this.styleProperties(style);
        if (props) result.properties = props;
        return result;
    }

    /**
     * Transforms a RelationshipStyle AST node into the JSON object the viewer expects:
     * integer fields stay numbers, colours are lower-cased, and routing/line style are
     * normalised to the PascalCase the model serialises.
     */
    private transformRelationshipStyle(style: RelationshipStyle, colorScheme?: string) {
        const result: any = {};
        this.addStringIfDefined(result, 'tag', style.tag);
        if (colorScheme) result.colorScheme = colorScheme;
        this.addNumberIfDefined(result, 'thickness', style.thicknessProps);
        this.addColorIfDefined(result, 'color', style.colorProps);
        this.addNumberIfDefined(result, 'fontSize', style.fontSizeProps);
        this.addNumberIfDefined(result, 'width', style.widthProps);
        this.addBooleanIfDefined(result, 'dashed', style.dashedProp);
        this.addEnumIfDefined(result, 'routing', style.routingProps, ROUTING_NORMALIZE);
        this.addClampedNumberIfDefined(result, 'position', style.positionProps, 0, 100);
        this.addClampedNumberIfDefined(result, 'opacity', style.opacityProps, 0, 100);
        this.addBooleanIfDefined(result, 'jump', style.jumpProps);
        this.addEnumIfDefined(result, 'style', style.styleProps, BORDER_NORMALIZE);
        this.addBooleanIfDefined(result, 'metadata', style.metadataProps);
        this.addBooleanIfDefined(result, 'description', style.descriptionProp);
        const props = this.styleProperties(style);
        if (props) result.properties = props;
        return result;
    }
    
    /**
     * Collects theme URLs from !theme and !themes directives across all documents and includes.
     * Resolves theme names: "default" → DEFAULT_THEME_URL, others → URL as-is.
     */
    private collectThemes(node: AstNode | undefined, visited: Set<string> = new Set<string>) {
        if (!node) return;
        const docUri = AstUtils.getDocument(node)?.uri.toString();
        if (docUri && visited.has(docUri)) return;
        if (docUri) visited.add(docUri);

        // Themes of an extended workspace come before the extending workspace's own.
        if (isWorkspace(node) && node.extendsUri) {
            const parent = this.resolveParentWorkspace(node, node.extendsUri);
            if (parent) this.collectThemes(parent, visited);
        }

        // Reads !theme / !themes from a views, styles or root block.
        const extractThemes = (holder: any) => {
            const single = C4Utils.stripQuotes(holder.themeProps?.at(0)?.value);
            if (single) this.themes.add(single === DEFAULT_THEME_NAME ? DEFAULT_THEME_URL : single);
            holder.themesProps?.at(0)?.values?.forEach((value: string) => {
                const theme = C4Utils.stripQuotes(value);
                if (theme) this.themes.add(theme === DEFAULT_THEME_NAME ? DEFAULT_THEME_URL : theme);
            });
        };

        if (isViewsBlock(node) || isStylesBlock(node) || isC4Document(node)) {
            extractThemes(node);
        } else if (isWorkspace(node)) {
            const views = node.viewsBlocks?.at(0);
            if (views) extractThemes(views);
        }
        if (isC4Document(node)) {
            const views = node.viewsBlocks?.at(0);
            if (views) extractThemes(views);
        }

        // Recurse into includes
        const includes = isC4Document(node) || isWorkspace(node) || isViewsBlock(node) || isStylesBlock(node)
            ? node.includes : undefined;
        includes?.forEach((includeDirective : Include) => {
            if (includeDirective.file) {
                const includedRoot = this.resolveIncludedRoot(node, includeDirective.file);
                if (includedRoot) {
                    this.collectThemes(includedRoot, visited);
                }
            }
        });
    }

    /**
     * Downloads external theme files (!theme) and collects their element styles so
     * Graphviz plans for the sizes the webview will render after downloading the
     * same theme files. Absolute http(s) URLs are fetched; relative/local paths are
     * skipped (the webview resolves them against its own base URL).
     */
    private async collectThemeStyles(): Promise<void> {
        // A fresh JsonGenerator is created per generate() call, so clear defensively.
        this.themeStyles.length = 0;
        this.themeRelationshipStyles.length = 0;
        if (this.themes.size === 0) return;
        // Reading through the (patched) FileSystemProvider reuses the fetchCache in
        // main.ts / main.browser.ts (60s TTL) that already serves !include and
        // extendsUri remote URLs - no separate theme cache is needed.
        const fs = this.services.shared.workspace.FileSystemProvider;
        if (!fs || typeof fs.readFile !== 'function') return;
        for (const themeUrl of this.themes) {
            if (!/^https?:\/\//i.test(themeUrl)) continue;
            try {
                const text = await fs.readFile(URI.parse(themeUrl));
                const theme = JSON.parse(text);
                if (theme && Array.isArray(theme.elements)) {
                    for (const style of theme.elements) this.themeStyles.push(style);
                }
                // The webview merges theme.relationships into the relationship
                // style lookup, so collect them too - otherwise themed
                // relationship fontSize/width would not be reflected in the layout.
                if (theme && Array.isArray(theme.relationships)) {
                    for (const style of theme.relationships) this.themeRelationshipStyles.push(style);
                }
            } catch (err) {
                // One-line, stack-less: the failure is either a remote-cache hit
                // ("Cached document is invalid") or a network/TLS error. A full
                // stack trace here is pure noise, repeated on every rebuild.
                const reason = (err instanceof Error) ? err.message : String(err);
                // No file system (e.g. Langium's EmptyFileSystem in unit tests):
                // themes are simply not merged, so skip the warning entirely.
                if (reason === 'No file system is available.') continue;
                console.warn(`[C4 Graphviz] Could not load theme ${themeUrl}: ${reason}`);
            }
        }
    }

    /**
     * Collects properties from model and views configuration blocks across all documents and includes.
     * Properties are stored as flat key-value records (propertiesModel and propertiesViews).
     */
    private collectProperties(node: AstNode | undefined, visited: Set<string> = new Set<string>): void {
        if (!node) return;

        const docUri = AstUtils.getDocument(node)?.uri.toString();
        if (docUri) {
            if (visited.has(docUri)) return;
            visited.add(docUri);
        }
        
        // Workspace-level `properties { }` belong to the workspace itself
        // (WorkspaceParser), so they are emitted at the JSON root.
        const workspaceProperties = isWorkspace(node) ? node.properties?.[0] : undefined;
        if (workspaceProperties && Array.isArray(workspaceProperties.items)) {
            for (const prop of workspaceProperties.items) {
                if (prop.name && prop.value) {
                    const name = C4Utils.stripQuotes(prop.name);
                    const value = C4Utils.stripQuotes(prop.value);
                    if (name && value) {
                        this.propertiesWorkspace[name] = value;
                    }
                }
            }
        }

        let modelBlock : ModelBlock | undefined = undefined;
        if(isModelBlock(node)) {
            modelBlock = node;
        } else if(isWorkspace(node) || isC4Document(node)) {
            modelBlock = node.modelBlocks[0];
        }
        let firstPropertyBlock = modelBlock?.properties?.[0];

        // Extract key-value pairs from the properties block
        if (firstPropertyBlock && Array.isArray(firstPropertyBlock.items)) {
            for (const prop of firstPropertyBlock.items) {
                if (prop.name && prop.value) {
                    const name = C4Utils.stripQuotes(prop.name);
                    const value = C4Utils.stripQuotes(prop.value);
                    if (name && value) {
                        this.propertiesModel[name] = value;
                    }
                }
            }
        }

        let viewsBlock : ViewsBlock | undefined = undefined;
        if(isViewsBlock(node)) {
            viewsBlock = node;
        } else if(isWorkspace(node) || isC4Document(node)) {
            viewsBlock = node.viewsBlocks[0];
        }
        firstPropertyBlock = viewsBlock?.properties?.[0];

        // Extract key-value pairs from the views properties block
        if (firstPropertyBlock && Array.isArray(firstPropertyBlock.items)) {
            for (const prop of firstPropertyBlock.items) {
                if (prop.name && prop.value) {
                    const name = C4Utils.stripQuotes(prop.name);
                    const value = C4Utils.stripQuotes(prop.value);
                    if (name && value) {
                        this.propertiesViews[name] = value;
                    }
                }
            }
        }

        // Recurse into included files
        const includes = isModelBlock(node) || isWorkspace(node) || isC4Document(node) || isViewsBlock(node)
            ? node.includes : undefined;
        if (includes) {
            for (const includeDirective of includes) {
                if (includeDirective.file) {
                    const includedRoot = this.resolveIncludedRoot(node, includeDirective.file);
                    if (includedRoot) {
                        this.collectProperties(includedRoot, visited);
                    }
                }
            }
        }
    }
    
    /**
     * Collects elements, relationships, and deployment nodes from the current AST node.
     * Handles C4Document/Workspace root wrappers, processes groups with stack tracking
     * for group paths, converts implicit relationships to synthetic ones.
     */
    private collectLocal(node: any, groupStack: string[] = [], visitedDocs: Set<string> = new Set()) {
        // Handle C4Document root wrapper: delegate to workspace or model block, but
        // in a bare include fragment (no owns workspace/model) the elements and
        // relationships live directly on the C4Document root — keep processing them.
        if (isC4Document(node)) {
            if (node.workspaces.at(0)) {
                this.collectLocal(node.workspaces.at(0), groupStack, visitedDocs);
                return;
            }
            if (node.modelBlocks.at(0)) {
                this.collectLocal(node.modelBlocks.at(0), groupStack, visitedDocs);
                return;
            }
        }
        if(isWorkspace(node)) {
            if (node.modelBlocks.at(0)) {
                this.collectLocal(node.modelBlocks.at(0), groupStack, visitedDocs);
            }
            return;
        }
        // --- Bare fragment root (C4Document with only top-level fragments) ---
        // Straight-through: process this node's own collections (elements,
        // relationships, includes) before returning to the caller.
        // Process !include directives on this node — works for model blocks
        // (`model { !include ... }`) and element blocks (e.g. a softwareSystem or
        // container with `!include "..."`). ModelBlocks and element blocks are not
        // visited by collectElementsRelationships, so included elements must be
        // collected here — otherwise they are missing from the emitted model while
        // references (e.g. deployment instances, container views) still point to ids.
        const followInclude = (owner: any, inc: any): void => {
            if (!inc.file) return;
            const root = this.resolveIncludedRoot(owner, inc.file);
            if (!root) return;
            const docUri = AstUtils.getDocument(root)?.uri.toString();
            if (docUri) {
                if (visitedDocs.has(docUri)) return;
                visitedDocs.add(docUri);
                // Register the include context so parent resolution
                // (resolveContainerParent / resolveComponentParent) can
                // climb from the Include directive to the logical parent.
                const existing = this.includeContexts.get(docUri) || [];
                existing.push(inc);
                this.includeContexts.set(docUri, existing);
            }
            this.collectLocal(root, groupStack, visitedDocs);
        };
        // Universal collection handler: processes a group, a relationship or a named element
        const processItem = (item: any): void => {
            if (isGroup(item)) {
                this.groups.push(item);
                // Groups add another recursion level with an extended group stack
                this.collectLocal(item, [...groupStack, this.substitute(item.name) || ""], visitedDocs);
            }
            else if (isRelationship(item)) {
                this.addRelationship(item);
            }
            else if (isImplicitRelationship(item)) {
                this.relationships.push(this.createSyntheticRelationship(item));
            }
            else if (isNamedElement(item)) {
                // An ArchetypeInstance is materialised as an element of its
                // archetype's base type; relationship-typed archetypes
                // (`a --https-> b`) stay as instances.
                const element = this.materializeArchetypeInstance(item)
                    ?? this.materializeGenericInstance(item)
                    ?? item;
                // A `group` archetype instance behaves like a Group: it is not an
                // element itself, it just contributes a group level for its children.
                if (isGroup(element)) {
                    this.collectLocal(element, [...groupStack, this.substitute(element.name) || ""], visitedDocs);
                    return;
                }
                // Store group path in the map instead of mutating AST
                if (groupStack.length > 0) {
                    this.groupPathMap.set(this.getId(element), groupStack.join(this.groupSeparator));
                }
                this.elements.push(element);
                // Recurse into element children (SoftwareSystem → Containers, etc.) with empty group stack
                this.collectLocal(element, [], visitedDocs);
            }
        };
        // Deployment groups are declared by the environment, not as elements, so they
        // are collected separately: their identifiers resolve the ambiguous single
        // value on an instance (see resolveAllInstanceValues).
        if (Array.isArray(node.deploymentGroups)) {
            for (const group of node.deploymentGroups) {
                const identifier = C4Utils.stripQuotes(group?.id);
                const name = this.substitute(group?.name);
                if (identifier && name) {
                    this.deploymentGroupsByIdentifier.set(identifier, name);
                }
            }
        }
        // Includes and items are processed in source order: an `!include` contributes
        // its elements and relationships at the position of the directive, which is the
        // order the reference library parses the workspace in.
        const offsetOf = (entry: any): number => entry?.$cstNode?.offset ?? Number.MAX_SAFE_INTEGER;
        const processEntries = (entries: any[], owner: any): void => {
            entries.sort((a, b) => offsetOf(a) - offsetOf(b));
            for (const entry of entries) {
                if (isInclude(entry)) followInclude(owner, entry);
                else if (isElementExtension(entry)) processElementExtension(entry);
                else processItem(entry);
            }
        };
        // Process !element (ElementExtension) contributions. Their children
        // (containers/components/nodes/...) are REAL model elements that must be
        // collected so relationships targeting them (e.g. Parent.Child -> Sibling)
        // resolve and appear in the generated JSON. The ElementExtension itself is
        // a directive, not an element - only its child collections are processed.
        const processElementExtension = (ext: any): void => {
            const extEntries: any[] = Array.isArray(ext.includes) ? [...ext.includes] : [];
            for (const collection of [
                ext.containers, ext.components, ext.nodes, ext.infrastructureNodes,
                ext.softwareSystemInstances, ext.containerInstances, ext.genericInstances,
                ext.groups, ext.relationships
            ]) {
                if (Array.isArray(collection)) extEntries.push(...collection);
            }
            processEntries(extEntries, ext);
        };
        const entries: any[] = Array.isArray(node.includes) ? [...node.includes] : [];
        for (const collection of [
            node.nodes, node.groups, node.children, node.infrastructureNodes,
            node.softwareSystemInstances, node.containerInstances, node.genericInstances,
            node.elements, node.containers, node.components, node.archetypeInstances,
            node.relationships, node.elementExtensions
        ]) {
            if (Array.isArray(collection)) entries.push(...collection);
        }
        processEntries(entries, node);
        // `-/>` directives suppress projected instance relationships between the
        // resolved instances; the body relationships are collected separately.
        if (Array.isArray(node.noRelationships)) {
            const collectNoRelationships = (list: any[]) => {
                for (const noRelationship of list) {
                    this.noRelationshipNodes.push(noRelationship);
                    if (Array.isArray(noRelationship.relationships)) {
                        for (const relationship of noRelationship.relationships) {
                            this.addRelationship(relationship, noRelationship);
                        }
                    }
                    if (Array.isArray(noRelationship.noRelationships)) {
                        collectNoRelationships(noRelationship.noRelationships);
                    }
                }
            };
            collectNoRelationships(node.noRelationships);
        }
    }

    /** Overlay tags as a comma-separated string (deduplicated), for implied relationships. */
    private overlayTagsOnly(overlay: { tags?: string[] } | undefined): string | undefined {
        if (!overlay?.tags || overlay.tags.length === 0) return undefined;
        const merged = Array.from(new Set(overlay.tags.map(t => t.trim()).filter(Boolean)));
        return merged.length > 0 ? merged.join(',') : undefined;
    }

    /**
     * Converts an ImpliedRelationship into a JSON object. Applies overlay modifications
     * from !relationships directives (tags, URL, properties, perspectives).
     * Falls back to linked relationship properties when overlay values are not specified.
     */
    private relationshipToJson(relationship: ImpliedRelationship) {
        const relId = this.getId(relationship.relationship);
        const overlay = this.relationshipOverlays.get(relId);
        const result: any = {
            id: relId,
            sourceId: this.getId(this.resolveSource(relationship.relationship)),
            destinationId: this.getId(this.resolveTarget(relationship.relationship)),
            description: this.description(relationship.relationship),
            technology: overlay?.technology ?? this.technology(relationship.relationship),
            // Implied relationships carry no default tags, only the ones an
            // overlay (!relationships/!relationship) contributed.
            tags: relationship.linked ? this.overlayTagsOnly(overlay) : this.extractTags(relationship.relationship, 'Relationship'),
            url: this.url(relationship.relationship),
            linkedRelationshipId: relationship.linked ? this.getId(relationship.linked) : undefined
        };
        // Perspectives and properties contributed by the relationship's archetype.
        const archetypePerspectives = this.archetypePerspectives(relationship.relationship);
        if (archetypePerspectives) {
            result.perspectives = archetypePerspectives;
        }
        const archetypeProperties = this.archetypeProperties(relationship.relationship);
        if (archetypeProperties) {
            result.properties = archetypeProperties;
        }
        // The relationship's own `properties { }` block overrides inherited
        // archetype properties; a `!relationships`/`!relationship` overlay (below)
        // overrides both. Relationships are not elements, so this cannot live in
        // applyElementOverlay.
        const ownProperties = this.propertiesToRecord((relationship.relationship as any)?.properties);
        if (ownProperties) {
            result.properties = { ...(result.properties ?? {}), ...ownProperties };
        }
        // Apply overlay URL
        if (overlay?.url) {
            result.url = overlay.url;
        }
        // Apply overlay properties
        if (overlay?.properties && Object.keys(overlay.properties).length > 0) {
            result.properties = { ...(result.properties ?? {}), ...overlay.properties };
        }
        // Apply overlay perspectives
        if (overlay?.perspectives) {
            result.perspectives = overlay.perspectives;
        }
        return result;
    }

    /**
     * Creates an ImpliedRelationship wrapper for a synthetic (implied) relationship.
     * The implied relationship is derived from an explicit relationship, projected
     * up/down the container hierarchy (e.g. Container → SoftwareSystem, Component → Container).
     * 
     * The original explicit relationship is stored in the `linked` field for traceability.
     * The synthetic relationship inherits its type, description from the linked relationship,
     * but uses abstract source/target elements.
     */
    private createRelationshipEx(source: RelationshipMember, target: RelationshipMember, linked: Relationship): ImpliedRelationship {
        // preserve $document from the linked relationship so that shouldGenerateImplied()
        // can call AstUtils.getDocument() without throwing "AST node has no document"
        const linkedDoc = AstUtils.getDocument(linked);
        const relationship: any = {
            $type: 'Relationship', // override type for isRelationship type guard checks
            $cstNode: linked.$cstNode, // preserve CST from linked relationship for !impliedRelationships flag checking
            source: {
                ref: source,
                $refText: ""
            } as Reference<RelationshipMember>,
            target: {
                ref: target,
                $refText: ""
            } as Reference<RelationshipMember>,
            description: this.description(linked),
            technology: this.technology(linked),
        };
        if (linkedDoc) {
            relationship.$document = linkedDoc;
        }
        return {
            relationship: relationship as unknown as Relationship,
            linked: linked,
            source: source,
            target: target
        };
    }

    /**
     * Creates a synthetic Relationship object from an ImplicitRelationship (-> target).
     * This is needed because implicit relationships in Langium have a different AST type
     * (ImplicitRelationship) than regular relationships (Relationship), but the downstream
     * code expects Relationship objects.
     * 
     * The method preserves the CST node from the original implicit relationship so that
     * shouldGenerateImplied() can correctly determine the CST offset for !impliedRelationships
     * flag checking.
     * 
     * @param implicit The ImplicitRelationship AST node from the parser
     * @returns A synthetic Relationship object that mimics the original implicit relationship
     */
    private createSyntheticRelationship(implicit: ImplicitRelationship): Relationship {
        const source = this.resolveSource(implicit);
        // preserve $document from the implicit node so that shouldGenerateImplied()
        // can call AstUtils.getDocument() without throwing "AST node has no document"
        const result: any = {
            ...implicit,
            $type: 'Relationship', // override type for isRelationship type guard checks
            source: {
                ref: source,
                $refText: (source as any)?.name ?? ""
            },
            target: implicit.target,
            targetThis: implicit.targetThis,
            description: implicit.description,
            technology: implicit.technology,
            tags: implicit.tags
        };
        // ensure $cstNode and $document are preserved (they may not be enumerable via spread)
        result.$cstNode = implicit.$cstNode;
        result.$document = AstUtils.getDocument(implicit);
        return result as unknown as Relationship;
    }

    /**
     * Collects all elements and relationships from the workspace AST recursively.
     * Handles inline nodes, !include files with context tracking, and workspace extendsUri.
     * Uses visited set to prevent infinite cycles across document references.
     */
    private collectElementsRelationships(node: AstNode | undefined, visited: Set<string> = new Set<string>) {
        if (!node) return;
        // Prevent infinite cycles via document URI tracking
        const docUri = AstUtils.getDocument(node)?.uri.toString();
        if (docUri) {
            if (visited.has(docUri)) return;
            visited.add(docUri);
        }
        // A document/workspace/model/element root may carry nested `elements` and
        // `!include` directives; the set of node types that do is open, so read them
        // through a structural shape.
        const anyNode = node as any;
        // Collect elements and relationships from the current node (works for Workspace, ModelBlock, included files)
        this.collectLocal(anyNode);
        // Recursively process nested elements (SoftwareSystem → Containers, etc.)
        if (anyNode.elements) {
            for (const el of anyNode.elements) {
                this.collectElementsRelationships(el, visited);
            }
        }
        // Universal include processing (works for any root type)
        if (anyNode.includes) {
            for (const includeDirective of anyNode.includes) {
                if (includeDirective.file) {
                    const includedRoot = this.resolveIncludedRoot(node, includeDirective.file);
                    if (includedRoot) {
                        // Store context: included file URI → Include directive (for parent resolution fallbacks)
                        const includedDocUri = AstUtils.getDocument(includedRoot)?.uri.toString();
                        if (includedDocUri) {
                            const existing = this.includeContexts.get(includedDocUri) || [];
                            existing.push(includeDirective);
                            this.includeContexts.set(includedDocUri, existing);
                        }
                        this.collectElementsRelationships(includedRoot, visited);
                    }
                }
            }
        }
        // Workspace inheritance via extendsUri
        if (isWorkspace(node) && node.extendsUri) {
            const parentWs = this.resolveParentWorkspace(node, node.extendsUri);
            this.collectElementsRelationships(parentWs, visited);
        }
    }

    /**
     * Resolves a parent workspace via extendsUri by looking up the target document
     * in the Langium document index. Works in both Node.js and browser environments.
     *
     * Unlike the old Utils.resolvePath(..., rawPath) implementation, this goes
     * through the shared includeResolver pipeline, which strips quotes, resolves
     * ${CONST} placeholders, and adds the .dsl fallback - matching exactly the
     * URIs the document builder loaded (so `extends "path.dsl"` resolves).
     */
    private resolveParentWorkspace(currentWs: Workspace, relativePath: string): Workspace | undefined {
        const root = this.resolveIncludedRoot(currentWs, relativePath);
        if (isWorkspace(root)) return root;
        if (isC4Document(root)) return root.workspaces.at(0);
        return undefined;
    }

    /**
     * Generates a stable, deterministic flat ID for any AST element.
     * 
     * The ID is composed of:
     * 1. A type prefix (e.g. "relationship", "softwaresystem", "container", "deploymentnode", etc.)
     * 2. A hash derived from the element's identity (CST offset, source/target refs, etc.)
     * 
     * This produces IDs like: `element_a1b2c3d4`, `relationship_e5f6g7h8`, `softwaresystem_9i0j1k2l`
     * that are stable across editor sessions but unique within the workspace.
     * 
     * Relationships (explicit and implicit) encode both source and target element IDs
     * into the hash to ensure uniqueness when the same file defines multiple
     * relationships with the same offset pattern (e.g. in !include'd files).
     */
    /**
     * Returns a stable generated ID for any element or relationship.
     *
     * Delegates to the shared `flatId()` implementation so the JSON enricher
     * (which matches AST nodes to already-emitted JSON by id) computes the SAME
     * ids. The source/target resolvers for relationship ids are the generator's
     * own (they understand implicit relationships and include contexts).
     */
    private getId(element: any): string {
        if (!element) return 'unknown';
        // Resolve through el() so a reference to an ArchetypeInstance and its
        // materialised element produce the same id.
        const resolved = this.el(element);
        if (resolved !== null && typeof resolved === 'object') {
            const cached = this.idCache.get(resolved);
            if (cached !== undefined) return cached;
            const id = this.computeId(resolved);
            this.idCache.set(resolved, id);
            return id;
        }
        return this.computeId(resolved);
    }

    /** Per-generate id cache, keyed by the resolved AST node. */
    private readonly idCache = new WeakMap<object, string>();

    private computeId(resolved: any): string {
        return flatId(resolved, this.rootDocUri ?? '', {
            source: (rel) => this.resolveSource(rel),
            target: (rel) => this.resolveTarget(rel),
        });
    }

    /**
     * Returns the element materialised for a node, or the node itself.
     */
    private el<T>(node: T): T {
        return (this.materialized.get(node) ?? node) as T;
    }

    /**
     * Display name of a resolved element. Only some element types declare a `name`
     * (instances and the like carry none), so read it through the common shape.
     */
    private displayName(node: NamedElement | undefined): string {
        if (!node) return '';
        return (node as any).name ?? '';
    }

    /** The element's declared `id` (a string), when the type declares one. */
    private elementId(node: NamedElement | undefined): string | undefined {
        return (node as any)?.id;
    }

    /** The element's first `properties` block, when the type declares one. */
    private firstProperties(node: NamedElement | undefined): PropertiesBlock | undefined {
        return (node as any)?.properties?.at(0);
    }

    /** Whether a relationship declares a property with the given (unquoted) name and value. */
    private relationshipHasProperty(rel: Relationship | undefined, name: string, value: string): boolean {
        const props = (rel as any)?.properties;
        if (!props) return false;
        return props.some((block: any) => block.items.some((item: any) =>
            C4Utils.stripQuotes(item.name) === name && C4Utils.stripQuotes(item.value) === value));
    }

    /**
     * Materialises an ArchetypeInstance as an element of its archetype's base
     * type. The AST node is left untouched: a shallow copy carries the new $type,
     * with $cstNode, $container and $document copied explicitly because they are
     * non-enumerable. The copy is registered in `materialized` so `el()` maps the
     * original back to it.
     *
     * Archetypes whose base is a relationship are not materialised.
     */
    private materializeArchetypeInstance(inst: NamedElement): any | undefined {
        const cached = this.materialized.get(inst);
        if (cached) return cached;
        const effective = archetypeInstanceType(inst);
        if (!effective || effective === 'Relationship') return undefined;

        const materialized: any = Object.assign({}, inst);
        materialized.$type = effective;
        materialized.$cstNode = inst.$cstNode;
        // Resolve the parent through el() so $container climbs see base-type nodes.
        materialized.$container = this.el(inst.$container);
        const doc = AstUtils.getDocument(inst);
        if (doc) materialized.$document = doc;

        this.materialized.set(inst, materialized);
        return materialized;
    }

    /**
     * Materialises an `instanceOf` (GenericInstance) as a ContainerInstance or
     * SoftwareSystemInstance, depending on the referenced element type. The
     * reference is copied onto the field the concrete instance type expects.
     */
    private materializeGenericInstance(inst: NamedElement): any | undefined {
        const cached = this.materialized.get(inst);
        if (cached) return cached;
        if (!isGenericInstance(inst)) return undefined;
        const ref = inst.element?.ref;
        const effective = isSoftwareSystem(ref) ? 'SoftwareSystemInstance'
            : isContainer(ref) ? 'ContainerInstance'
            : undefined;
        if (!effective) return undefined;

        const materialized: any = Object.assign({}, inst);
        materialized.$type = effective;
        materialized.$cstNode = inst.$cstNode;
        materialized.$container = this.el(inst.$container);
        const doc = AstUtils.getDocument(inst);
        if (doc) materialized.$document = doc;
        if (effective === 'SoftwareSystemInstance') {
            materialized.softwareSystem = inst.element;
        } else {
            materialized.container = inst.element;
        }

        this.materialized.set(inst, materialized);
        return materialized;
    }

    /**
     * Applies overlay URL, properties, and perspectives from !elements directives
     * to the element JSON output object. Tags are handled separately in extractTags().
     */
    private applyElementOverlay(result: any, node: any): void {
        // Perspectives and properties contributed by the element's archetype.
        const archetypePerspectives = this.archetypePerspectives(node);
        if (archetypePerspectives) {
            result.perspectives = result.perspectives ?? archetypePerspectives;
        }
        const archetypeProperties = this.archetypeProperties(node);
        if (archetypeProperties) {
            result.properties = { ...archetypeProperties, ...(result.properties ?? {}) };
        }
        // The element's own `properties { }` block overrides inherited archetype
        // properties; a `!elements` overlay (below) overrides both. Emitting it here
        // keeps the render JSON complete, so consumers that never run the enricher
        // (e.g. the MCP tools) still see the declared properties.
        const ownProperties = this.propertiesToRecord(node?.properties);
        if (ownProperties) {
            result.properties = { ...(result.properties ?? {}), ...ownProperties };
        }

        const nodeId = this.getId(node);
        const overlay = this.elementOverlays.get(nodeId);
        if (!overlay) return;

        if (overlay.url) {
            result.url = overlay.url;
        }
        if (overlay.properties && Object.keys(overlay.properties).length > 0) {
            // Overlay properties override the values set so far (archetype and own
            // properties); keys the overlay does not touch are kept.
            result.properties = { ...(result.properties ?? {}), ...overlay.properties };
        }
        if (overlay.perspectives) {
            result.perspectives = overlay.perspectives;
        }
    }

    /**
     * Substitutes ${constantName} placeholders in the given string with resolved constant values.
     * Also strips surrounding quotes.
     */
    private substitute(value: string | undefined): string | undefined {
        return (value) ? C4Utils.stripQuotes(value.replace(/\$\{([^}]+)\}/g, (match, varName) => this.constants.get(varName) ?? match)) : undefined;
    }

    /**
     * Collects description, technology and tags an ArchetypeInstance inherits from
     * its archetype chain. The nearest definition wins per field; non-instance
     * nodes yield empty defaults.
     */
    private archetypeDefaults(node: AstNode | undefined): { description?: string; technology?: string; metadata?: string; tags: string[] } {
        const chain = this.archetypeChainFor(node);
        if (chain.length === 0) {
            return { tags: [] };
        }
        const tags: string[] = [];
        let description: string | undefined;
        let technology: string | undefined;
        let metadata: string | undefined;
        // Walk from the nearest archetype outward so the closest definition wins.
        for (const arch of chain) {
            if (description === undefined) {
                const d = arch.description ?? arch.descriptionProps?.[0]?.value;
                if (d !== undefined && d !== null && d !== '') description = d;
            }
            if (technology === undefined) {
                const t = arch.technology ?? arch.techProps?.[0]?.value;
                if (t !== undefined && t !== null && t !== '') technology = t;
            }
            if (metadata === undefined) {
                const m = arch.metadataProps?.[0]?.value;
                if (m !== undefined && m !== null && m !== '') metadata = m;
            }
        }
        // Tags are collected from the outermost archetype inward, so parent
        // archetype tags come before child archetype tags.
        for (const arch of [...chain].reverse()) {
            for (const tp of arch.tagsProps ?? []) {
                for (const raw of tp.values ?? []) {
                    for (const tag of this.parseDslTagValue(String(raw))) {
                        tags.push(tag);
                    }
                }
            }
        }
        return { description, technology, metadata, tags };
    }

    /** Returns the metadata text for an element, inherited from its archetype. */
    private metadata(node: AstNode | undefined): string | undefined {
        const value = (node as any).metadata ?? this.archetypeDefaults(node).metadata;
        return this.substitute(value);
    }

    /** Converts `perspectives { ... }` blocks into plain JSON, dropping AST internals. */
    private perspectivesToJson(blocks: any[] | undefined): any[] | undefined {
        const perspectives: any[] = [];
        for (const block of blocks ?? []) {
            for (const item of block?.items ?? []) {
                const perspective: any = {
                    name: this.substitute(item.name),
                    description: this.description(item)
                };
                const value = item.valueProps?.[0]?.value;
                if (value !== undefined) perspective.value = this.substitute(value);
                const url = item.urlProps?.[0]?.value;
                if (url !== undefined) perspective.url = this.substitute(url);
                perspectives.push(perspective);
            }
        }
        return perspectives.length > 0 ? perspectives : undefined;
    }

    /** Returns the description text for a node, with constant substitution applied. */
    private description(node: AstNode | undefined) {
        const overlay = this.elementOverlays.get(this.getId(node))?.description;
        const own = overlay ?? (node as any)?.description ?? (node as any)?.descriptionProps?.[0]?.value;
        const value = own ?? this.archetypeDefaults(node).description;
        if (value === undefined || value === null || value === '') {
            return undefined;
        }
        const substituted = this.substitute(value);
        return substituted === '' ? undefined : substituted;
    }

    /**
     * URL declared by a `url ...` line, if any. Elements, relationships and dynamic
     * view steps accept one; a group does not, as in the reference parser.
     * Overlay URLs (`!elements`, `!relationships`) are applied separately.
     */
    private url(node: AstNode | undefined): string | undefined {
        // DynamicStep declares `urlProp`, every other rule declares `urlProps`.
        const props = (node as any)?.urlProps ?? (node as any)?.urlProp;
        const value = Array.isArray(props) ? props[0]?.value : props?.value;
        const substituted = this.substitute(value);
        return substituted === '' ? undefined : substituted;
    }

    /**
     * Auto-generated view name. A view name is never stored in the DSL: it is
     * always derived from the view type and its scope
     * (e.g. "System Context View: <software system>").
     */
    private viewName(view: any): string | undefined {
        if (isSystemLandscapeView(view)) {
            return 'System Landscape View';
        }
        if (isSystemContextView(view)) {
            const scope = this.el(view.softwareSystem?.ref);
            return scope ? `System Context View: ${this.substitute(scope.name)}` : undefined;
        }
        if (isContainerView(view)) {
            const scope = this.el(view.softwareSystem?.ref);
            return scope ? `Container View: ${this.substitute(scope.name)}` : undefined;
        }
        if (isComponentView(view)) {
            const container = this.el(view.container?.ref);
            const system = container ? this.resolveContainerParent(container as Container) : undefined;
            if (!container || !system) return undefined;
            return `Component View: ${this.substitute(system.name)} - ${this.substitute(container.name)}`;
        }
        if (isDeploymentView(view)) {
            const scope = this.el(view.softwareSystem?.ref);
            const environment = view.environment?.ref
                ? C4Utils.stripQuotes(view.environment.ref.name)
                : '*';
            return scope
                ? `Deployment View: ${this.substitute(scope.name)} - ${environment}`
                : `Deployment View: ${environment}`;
        }
        if (isDynamicView(view)) {
            const scope = this.el(view.element?.ref);
            if (scope && isContainer(scope)) {
                const system = this.resolveContainerParent(scope as Container);
                if (system) return `Dynamic View: ${this.substitute(system.name)} - ${this.substitute(scope.name)}`;
            }
            if (scope) return `Dynamic View: ${this.substitute(this.displayName(scope))}`;
            return 'Dynamic View';
        }
        if (isCustomView(view)) {
            return `Custom View: ${this.substitute(view.titleProps?.[0]?.value) ?? ''}`;
        }
        return undefined;
    }

    /**
     * Returns the technology text for a node, with constant substitution applied.
     * Comma-separated unquoted segments are stored as `technology` +
     * `technologyParts` and rejoined here with commas.
     */
    private technology(node: AstNode | undefined) {
        const parts: string[] = [];
        const overlay = this.elementOverlays.get(this.getId(node))?.technology;
        // An in-block `technology "..."` overwrites the positional technology
        // (ContainerParser.parseTechnology calls setTechnology).
        const declared = (node as any)?.techProps?.[0]?.value;
        const base = overlay ?? declared ?? (node as any)?.technology ?? this.archetypeDefaults(node).technology;
        if (base !== undefined && base !== null && base !== '') parts.push(base);
        // Positional comma-separated segments only apply when the block did not
        // declare a technology of its own.
        if (declared === undefined && Array.isArray((node as any)?.technologyParts)) {
            for (const p of (node as any).technologyParts) {
                const s = String(p ?? '').trim();
                if (s) parts.push(s);
            }
        }
        // Quoted segments lose their quotes in substitute(); an empty result
        // means no technology was declared.
        const joined = parts.length > 0 ? this.substitute(parts.join(',')) : undefined;
        return joined ? joined : undefined;
    }

    /** Helper to create a minimal element JSON stub with id and default position. */
    // Deployment nodes are drawn as frames whose box the renderer derives from their
    // children, so they carry no coordinates in the JSON.
    private readonly elementJson = (el: any) => isDeploymentNode(el)
        ? { id: this.getId(el) }
        : { id: this.getId(el), x: 0, y: 0 };

    /**
     * Relationship view: the vendor model has no position for a relationship, only the
     * id plus the geometry the layout adds (vertices, routing).
     */
    private readonly relationshipViewJson = (rel: any) => ({ id: this.getId(rel) });

    /** Returns undefined when the array is empty, so empty collections are never emitted in JSON. */
    private onlyIfNotEmpty<T>(arr: T[] | undefined): T[] | undefined {
        return arr && arr.length > 0 ? arr : undefined;
    }

    /** Extracts all Person elements from the collected elements list into JSON format. */
    private extractPeople() {
        const peoples = this.elements
            .filter(isPerson)
            .map(p => {
                const result: any = {
                    id: this.getId(p),
                    name: this.substitute(p.name),
                    group: this.extractGroup(p),
                    description: this.description(p),
                    tags: this.extractTags(p, 'Element', 'Person'),
                    url: this.url(p),
                    relationships: this.onlyIfNotEmpty(this.relationshipsOwnedBy(p).map(el => this.relationshipToJson(el)))
                };
                this.applyElementOverlay(result, p);
                this.applyElementExtensions(result, p);
                return result;
            });
        return peoples && peoples.length > 0 ? peoples : undefined;
    }

    /** Returns the group path for a given element/node, if it belongs to a group. */
    private extractGroup(node: AstNode | undefined) : string | undefined {
        return this.groupPathMap.get(this.getId(node));
    }

    private readonly resolveTarget = (rel : Relationship | ImplicitRelationship) => this.el((this.isThisReference(rel.target) || rel.targetThis) ? this.resolveContextElement(rel) : rel.target?.ref);
    private readonly resolveSource = (rel : Relationship | ImplicitRelationship) => this.el((isImplicitRelationship(rel) || this.isThisReference(rel.source) || rel.sourceThis) ? this.resolveContextElement(rel) : rel.source?.ref);

    /**
     * True when a relationship endpoint is the `this` keyword. The grammar consumes
     * `this` without storing it on the endpoint reference, so the reference is
     * either absent or carries the literal text `this`. An unresolved named
     * reference keeps its `$refText` and is therefore NOT treated as `this`.
     */
    private isThisReference(reference: Reference<NamedElement> | undefined): boolean {
        return reference === undefined || reference?.$refText?.toLowerCase() === 'this';
    }

    /**
     * Builds the relationship-by-source index once per generate() call. Maps each element id
     * (via getId of the resolved relationship source) to the list of relationships originating
     * from that element. The extractRelationshipsFor* methods then look up their relationships
     * directly instead of scanning this.relationships for every element - turning the per-view
     * O(elements x relationships) resolution into O(elements + relationships).
     */
    private buildRelationshipsBySource(): void {
        this.relationshipsBySource.clear();
        for (const rel of this.relationships) {
            const source = this.resolveSource(rel);
            if (!source) continue;
            const key = this.getId(source);
            const list = this.relationshipsBySource.get(key);
            if (list) {
                list.push(rel);
            } else {
                this.relationshipsBySource.set(key, [rel]);
            }
        }
    }

    /** Cached result of collectAllRelationships(). */
    private allRelationshipsCache?: ImpliedRelationship[];
    /** Cached declaration order of this.relationships. */
    private declaredRelationshipOrderCache?: Map<Relationship, number>;
    /**
     * The same result indexed by source element id, so relationshipsOwnedBy() is a
     * map lookup instead of a scan of every relationship per element.
     */
    private relationshipsBySourceImplied?: Map<string, ImpliedRelationship[]>;
    /**
     * Memoized per-element relationship extraction. Extraction is a pure function of
     * the model, so each element is extracted once even though the instance projection,
     * view resolution and JSON transform ask for the same element repeatedly.
     */
    private relationshipExtractionCache = new Map<NamedElement, ImpliedRelationship[]>();
    /**
     * Memoized parent-relationship sets for instance projection, keyed by the parent
     * system/container. Without this every deployment instance rebuilds the same set by
     * scanning the whole model.
     */
    private systemParentRelsCache = new Map<SoftwareSystem, Set<ImpliedRelationship>>();
    private containerParentRelsCache = new Map<Container, Set<ImpliedRelationship>>();
    /** Deployment instances (SoftwareSystemInstance/ContainerInstance) in element order. */
    private deploymentInstancesCache?: NamedElement[];
    /** Memoized instance deployment-group sets, keyed by node. */
    private instanceGroupNamesCache = new Map<AstNode, Set<string>>();
    /** Element indexes for instance projection, built once in element order. */
    private containersBySystemCache = new Map<SoftwareSystem, Container[]>();
    private componentsByContainerCache = new Map<Container, Component[]>();
    private relationshipIndexesReady = false;
    /**
     * View-scope relationship sets, memoized. View resolution only reads these sets, so
     * one instance is shared across all views of the same kind instead of being rebuilt
     * (by scanning every element) for each view.
     */
    private allRelationshipsSetCache?: Set<ImpliedRelationship>;
    private staticRelationshipsSetCache?: Set<ImpliedRelationship>;
    private customRelationshipsSetCache?: Set<ImpliedRelationship>;

    /**
     * Drops every cache derived from the relationship list, so none survives a mutation
     * of `this.relationships`. Called after `!elements` appends synthetic relationships,
     * because resolving the directive's expression builds the relationship graph first.
     * Element-derived caches (hierarchy indexes, group leaves, deployment targets,
     * canonical names) do not depend on the relationship list and are left untouched.
     */
    private invalidateAllRelationships(): void {
        this.allRelationshipsCache = undefined;
        this.declaredRelationshipOrderCache = undefined;
        this.relationshipsBySourceImplied = undefined;
        this.relationshipExtractionCache.clear();
        this.systemParentRelsCache.clear();
        this.containerParentRelsCache.clear();
        this.allRelationshipsSetCache = undefined;
        this.staticRelationshipsSetCache = undefined;
        this.customRelationshipsSetCache = undefined;
    }

    /**
     * Builds, once, the element indexes the instance projection needs: containers grouped
     * by their parent system and components grouped by their parent container. Component
     * relationships per system are derived via parentRelsForContainer, so no per-system
     * component index is kept. These depend only on the element hierarchy, so they survive
     * a relationship mutation. Without them, every deployment instance rescans the model.
     */
    private ensureRelationshipIndexes(): void {
        if (this.relationshipIndexesReady) return;
        for (const el of this.elements) {
            if (isContainer(el)) {
                const system = this.resolveContainerParent(el);
                if (system) {
                    const list = this.containersBySystemCache.get(system);
                    if (list) list.push(el); else this.containersBySystemCache.set(system, [el]);
                }
            } else if (isComponent(el)) {
                const container = this.resolveComponentParent(el);
                if (container) {
                    const list = this.componentsByContainerCache.get(container);
                    if (list) list.push(el); else this.componentsByContainerCache.set(container, [el]);
                }
            }
        }
        this.relationshipIndexesReady = true;
    }

    /**
     * All relationships in the model (direct + implied) as a set, memoized. View
     * resolution only reads it, so a single instance is shared across views instead of
     * being rebuilt for every view.
     */
    private allRelationshipsSet(): Set<ImpliedRelationship> {
        if (!this.allRelationshipsSetCache) {
            this.allRelationshipsSetCache = new Set(this.collectAllRelationships());
        }
        return this.allRelationshipsSetCache;
    }

    /** Memoized allRelationshipMembers() set. `this.elements` is fixed after collection, so the set never needs invalidation. */
    private allRelationshipMembersCache?: Set<RelationshipMember>;

    /**
     * All collected elements that are relationship members as a set, memoized. The
     * element list is immutable after collection, so a single instance is shared between
     * the element- and relationship-expression resolvers instead of being rebuilt per call.
     */
    private allRelationshipMembers(): Set<RelationshipMember> {
        if (!this.allRelationshipMembersCache) {
            const members = new Set<RelationshipMember>();
            this.elements.forEach(el => {
                if (isRelationshipMember(el)) members.add(el);
            });
            this.allRelationshipMembersCache = members;
        }
        return this.allRelationshipMembersCache;
    }

    /**
     * Relationships of the static-structure elements (software systems, people,
     * containers, components and custom elements — no deployment), memoized for
     * component views, which exclude deployment relationships.
     *
     * Taken from the deduplicated list the model emits, so a view references only
     * relationships the model keeps: the model keeps one relationship per
     * source/destination/description triple, as the reference library does in
     * Model.addRelationship.
     */
    private staticRelationshipsSet(): Set<ImpliedRelationship> {
        if (!this.staticRelationshipsSetCache) {
            const rels = new Set<ImpliedRelationship>();
            for (const rel of this.collectAllRelationships()) {
                if (isSoftwareSystem(rel.source) || isPerson(rel.source) || isComponent(rel.source)
                    || isContainer(rel.source) || isCustomElement(rel.source)) {
                    rels.add(rel);
                }
            }
            this.staticRelationshipsSetCache = rels;
        }
        return this.staticRelationshipsSetCache;
    }

    /** Relationships of custom elements, memoized for custom views. */
    private customRelationshipsSet(): Set<ImpliedRelationship> {
        if (!this.customRelationshipsSetCache) {
            const rels = new Set<ImpliedRelationship>();
            for (const rel of this.collectAllRelationships()) {
                if (isCustomElement(rel.source)) {
                    rels.add(rel);
                }
            }
            this.customRelationshipsSetCache = rels;
        }
        return this.customRelationshipsSetCache;
    }

    /** Containers directly under a software system, in element order (memoized index). */
    private containersOfSystem(system: SoftwareSystem): Container[] {
        this.ensureRelationshipIndexes();
        return this.containersBySystemCache.get(system) ?? [];
    }

    /** Components directly under a container, in element order (memoized index). */
    private componentsOfContainer(container: Container): Component[] {
        this.ensureRelationshipIndexes();
        return this.componentsByContainerCache.get(container) ?? [];
    }

    /**
     * Resolves each `-/>` directive into the set of instance ids it targets in its
     * deployment environment, and records the static relationship it removes so
     * that relationships inside the `-/>` body can inherit description/technology.
     */
    private buildNoRelationshipSuppressions(): void {
        for (const noRelationship of this.noRelationshipNodes) {
            const env = this.getEnvironment(noRelationship);
            if (!env) continue;
            this.noRelationshipInheritance.set(noRelationship, this.findInheritedRelationship(noRelationship));
            const sources = this.resolveDeploymentEndpoints(noRelationship, noRelationship.source?.ref, noRelationship.sourceThis, env, true);
            const targets = this.resolveDeploymentEndpoints(noRelationship, noRelationship.target?.ref, noRelationship.targetThis, env, true);
            if (sources.length === 0 || targets.length === 0) continue;
            this.noRelationshipSuppressions.push({
                env,
                sourceIds: new Set(sources.map(source => this.getId(source))),
                targetIds: new Set(targets.map(target => this.getId(target))),
                description: noRelationship.description !== undefined ? this.substitute(noRelationship.description) : undefined
            });
        }
    }

    /**
     * Resolves one deployment relationship endpoint to the elements it refers to in
     * the environment. Software systems and containers expand to their instances;
     * instances and other elements stay themselves. When `restrictToInstances` is
     * set, non-instance elements resolve to nothing (used by `-/>`).
     */
    private resolveDeploymentEndpoints(node: AstNode, ref: NamedElement | undefined, isThis: boolean, env: string, restrictToInstances: boolean): any[] {
        if (isThis || !ref) {
            const context = this.resolveContextElement(node);
            return context ? [context] : [];
        }
        const element = this.el(ref);
        if (isSoftwareSystemInstance(element) || isContainerInstance(element)) {
            return [element];
        }
        if (isSoftwareSystem(element)) {
            return this.elements.filter(candidate => isSoftwareSystemInstance(candidate)
                && candidate.softwareSystem.ref === element && this.getEnvironment(candidate) === env);
        }
        if (isContainer(element)) {
            return this.elements.filter(candidate => isContainerInstance(candidate)
                && candidate.container.ref === element && this.getEnvironment(candidate) === env);
        }
        return restrictToInstances ? [] : [element];
    }

    /** Static element behind a deployment endpoint: an instance unwraps to its software system/container. */
    private resolveStaticElement(node: AstNode, ref: NamedElement | undefined, isThis: boolean): any | undefined {
        if (isThis || !ref) {
            return this.resolveContextElement(node);
        }
        const element = this.el(ref);
        if (isSoftwareSystemInstance(element)) return this.el(element.softwareSystem.ref);
        if (isContainerInstance(element)) return this.el(element.container.ref);
        return element;
    }

    /** Finds the static relationship a `-/>` directive removes, for body inheritance. */
    private findInheritedRelationship(noRelationship: any): Relationship | undefined {
        const source = this.resolveStaticElement(noRelationship, noRelationship.source?.ref, noRelationship.sourceThis);
        const target = this.resolveStaticElement(noRelationship, noRelationship.target?.ref, noRelationship.targetThis);
        if (!source || !target) return undefined;
        const description = noRelationship.description !== undefined ? this.substitute(noRelationship.description) : undefined;
        return this.relationships.find(rel =>
            isRelationship(rel)
            && this.el(this.resolveSource(rel)) === source
            && this.el(this.resolveTarget(rel)) === target
            && (description === undefined || this.description(rel) === description));
    }

    /**
     * Stores an explicit relationship. Relationships declared directly in a
     * deployment environment/node (or a `-/>` body) are not emitted as-is: they are
     * projected onto the instances of that environment.
     */
    private addRelationship(rel: any, noRelationship?: any): void {
        // A relationship identifier lets view expressions reference the
        // relationship by that identifier.
        if (typeof rel?.id === 'string' && rel.id.length > 0) {
            this.relationshipsByIdentifier.set(C4Utils.stripQuotes(rel.id), rel);
        }
        const context = noRelationship ?? this.findDeploymentContext(rel);
        if (context === undefined) {
            this.relationships.push(rel);
        } else {
            this.deploymentContextRelationships.push({ rel, noRelationship: context === true ? undefined : context });
        }
    }

    /** Returns the enclosing `-/>` directive, `true` for a deployment env/node, or undefined. */
    private findDeploymentContext(rel: any): any | undefined {
        let current = rel.$container;
        while (current) {
            if (isNoRelationship(current)) return current;
            if (isDeploymentEnvironment(current) || isDeploymentNode(current)) return true;
            if (isGroup(current)) {
                current = current.$container;
                continue;
            }
            return undefined;
        }
        return undefined;
    }

    /**
     * Expands deployment-context relationships into one relationship per
     * (source instance, target instance) pair. `-/>` body relationships inherit
     * description/technology from the static relationship the directive removed.
     */
    private expandDeploymentContextRelationships(): void {
        for (const { rel, noRelationship } of this.deploymentContextRelationships) {
            const env = noRelationship ? this.getEnvironment(noRelationship) : this.getEnvironment(rel);
            if (!env) {
                this.relationships.push(rel);
                continue;
            }
            const inherited = noRelationship ? this.noRelationshipInheritance.get(noRelationship) : undefined;
            const sources = this.resolveDeploymentEndpoints(rel, rel.source?.ref, rel.sourceThis, env, false);
            const targets = this.resolveDeploymentEndpoints(rel, rel.target?.ref, rel.targetThis, env, false);
            for (const source of sources) {
                for (const target of targets) {
                    this.relationships.push(this.createProjectedRelationship(rel, source, target, inherited));
                }
            }
        }
    }

    /** Builds a synthetic relationship whose endpoints are concrete instances. */
    private createProjectedRelationship(rel: any, source: any, target: any, inherited: Relationship | undefined): Relationship {
        const relationship: any = {
            $type: 'Relationship',
            $cstNode: rel.$cstNode,
            source: { ref: source, $refText: '' },
            target: { ref: target, $refText: '' },
            description: rel.description ?? inherited?.description,
            technology: rel.technology ?? inherited?.technology,
            technologyParts: rel.technologyParts,
            tags: rel.tags,
            tagsProps: rel.tagsProps,
            url: rel.url,
            properties: rel.properties,
            perspectives: rel.perspectives
        };
        const doc = AstUtils.getDocument(rel);
        if (doc) relationship.$document = doc;
        return relationship as unknown as Relationship;
    }

    /** Whether a projected relationship between two instances is suppressed by a `-/>` directive. */
    private isRelationshipSuppressed(env: string | undefined, source: any, target: any, description: string | undefined): boolean {
        if (!env) return false;
        const sourceId = this.getId(source);
        const targetId = this.getId(target);
        return this.noRelationshipSuppressions.some(suppression =>
            suppression.env === env
            && suppression.sourceIds.has(sourceId)
            && suppression.targetIds.has(targetId)
            && (suppression.description === undefined || suppression.description === description));
    }

    /** Pushes a projected (linked) relationship unless a `-/>` directive removes it. */
    private addProjectedRelationship(list: ImpliedRelationship[], source: any, target: any, linked: Relationship): void {
        if (this.isRelationshipSuppressed(this.getEnvironment(source), source, target, this.description(linked))) {
            return;
        }
        if (this.instanceProjectionIsTooLate(source, linked)) {
            return;
        }
        const entry = this.createRelationshipEx(source, target, linked);
        entry.projected = true;
        list.push(entry);
    }

    /**
     * Instance relationships are replicated when the instance is created,
     * so a static relationship declared after the instance does not appear on it.
     * Only comparable within the same document.
     */
    private instanceProjectionIsTooLate(source: any, linked: any): boolean {
        if (!isSoftwareSystemInstance(source) && !isContainerInstance(source)) {
            return false;
        }
        const sourceDocument = AstUtils.getDocument(source)?.uri.toString();
        const linkedDocument = AstUtils.getDocument(linked)?.uri.toString();
        if (!sourceDocument || !linkedDocument || sourceDocument !== linkedDocument) {
            return false;
        }
        const sourceOffset = source.$cstNode?.offset;
        const linkedOffset = linked.$cstNode?.offset;
        if (sourceOffset === undefined || linkedOffset === undefined) {
            return false;
        }
        return linkedOffset > sourceOffset;
    }

    /**
     * Drops duplicate projected instance relationships. The same instance pair can
     * be reached from more than one parent relationship (e.g. a direct container
     * relationship and its implied software system counterpart), which otherwise
     * yields several entries with the same generated id.
     */
    private dedupeRelationships(list: ImpliedRelationship[]): ImpliedRelationship[] {
        const seen = new Set<string>();
        const result: ImpliedRelationship[] = [];
        for (const rel of list) {
            const id = this.getId(rel.relationship);
            if (seen.has(id)) continue;
            seen.add(id);
            result.push(rel);
        }
        return result;
    }

    /**
     * Mirrors AbstractImpliedRelationshipsStrategy.impliedRelationshipIsAllowed: an
     * implied relationship is only created when neither element is an ancestor of the
     * other. People have no parents, so they never appear as an ancestor.
     */
    private impliedRelationshipAllowed(source: any, target: any): boolean {
        if (!source || !target || source === target) return false;
        return !this.isAncestor(source, target) && !this.isAncestor(target, source);
    }

    /** True when `ancestor` is a logical parent (transitively) of `descendant`. */
    private isAncestor(ancestor: any, descendant: any): boolean {
        let current = this.logicalParent(descendant);
        while (current) {
            if (current === ancestor) return true;
            current = this.logicalParent(current);
        }
        return false;
    }

    /** Logical model parent of a static structure element. */
    private logicalParent(element: any): any {
        if (isComponent(element)) return this.resolveComponentParent(element);
        if (isContainer(element)) return this.resolveContainerParent(element);
        return undefined;
    }

    /**
     * Collects every relationship the model emits, in the order the reference library
     * creates them: the declared relationships are processed in declaration order, and
     * each one contributes the implied relationships derived from it (up the source and
     * destination hierarchies) as long as the source/destination pair does not carry a
     * relationship yet. A declared relationship that duplicates an earlier one is
     * dropped and contributes no implied relationships, as Model.addRelationship does.
     *
     * Relationships replicated onto deployment instances follow the parent element's
     * emitted set, so a relationship the model dropped never reaches an instance.
     */
    private collectAllRelationships(): ImpliedRelationship[] {
        if (this.allRelationshipsCache) return this.allRelationshipsCache;

        const declared: ImpliedRelationship[] = [];
        const projections: ImpliedRelationship[] = [];
        for (const element of this.elements) {
            for (const entry of this.extractRelationshipsForElement(element)) {
                if (entry.projected) projections.push(entry);
                else declared.push(entry);
            }
        }

        const ordered = this.reduceRelationships(this.groupByBase(declared));

        // Instance projections are replicas of the parent element's emitted relationships.
        const emittedBases = new Set<Relationship>();
        const keys = new Set<string>();
        for (const entry of ordered) {
            emittedBases.add(entry.relationship);
            if (entry.linked) emittedBases.add(entry.linked);
            keys.add(`${this.relationshipPairKey(entry)}|${this.description(entry.relationship)}`);
        }
        for (const entry of projections) {
            if (!entry.linked || !emittedBases.has(entry.linked)) continue;
            const key = `${this.relationshipPairKey(entry)}|${this.description(entry.relationship)}`;
            if (keys.has(key)) continue;
            keys.add(key);
            ordered.push(entry);
        }

        this.allRelationshipsCache = ordered;

        // Index the deduplicated result by source id, so relationshipsOwnedBy()
        // does not rescan every relationship (and recompute every source id) for
        // each element.
        const bySource = new Map<string, ImpliedRelationship[]>();
        for (const rel of ordered) {
            const sourceId = this.getId(rel.source);
            const bucket = bySource.get(sourceId);
            if (bucket) {
                bucket.push(rel);
            } else {
                bySource.set(sourceId, [rel]);
            }
        }
        this.relationshipsBySourceImplied = bySource;

        return ordered;
    }

    /**
     * Groups relationship entries by the declared relationship they come from, in
     * declaration order. A declared relationship and the implied relationships derived
     * from it form one group; an implied relationship whose base is declared elsewhere
     * forms a group of its own.
     */
    private groupByBase(entries: ImpliedRelationship[]): Array<{
        base: Relationship;
        direct?: ImpliedRelationship;
        implied: ImpliedRelationship[];
    }> {
        const groups = new Map<Relationship, { base: Relationship; direct?: ImpliedRelationship; implied: ImpliedRelationship[] }>();
        for (const entry of entries) {
            const base = entry.linked ?? entry.relationship;
            let group = groups.get(base);
            if (!group) {
                group = { base, implied: [] };
                groups.set(base, group);
            }
            if (entry.linked === undefined) {
                if (!group.direct) group.direct = entry;
            } else {
                group.implied.push(entry);
            }
        }
        return this.byDeclarationOrder(groups.values(), group => group.base);
    }

    /**
     * Reduces groups of relationships to the set the reference library keeps. A declared
     * relationship is dropped when it duplicates an earlier one and then contributes no
     * implied relationships, and an implied relationship is kept only when its
     * source/destination pair carries no relationship yet.
     */
    private reduceRelationships(groups: Array<{
        direct?: ImpliedRelationship;
        implied: ImpliedRelationship[];
    }>): ImpliedRelationship[] {
        const pairs = new Set<string>();
        const keys = new Set<string>();
        const result: ImpliedRelationship[] = [];
        for (const group of groups) {
            if (group.direct) {
                const pair = this.relationshipPairKey(group.direct);
                const key = `${pair}|${this.description(group.direct.relationship)}`;
                if (keys.has(key)) continue;
                keys.add(key);
                pairs.add(pair);
                result.push(group.direct);
            }
            for (const candidate of group.implied) {
                const candidatePair = this.relationshipPairKey(candidate);
                if (pairs.has(candidatePair)) continue;
                pairs.add(candidatePair);
                result.push(candidate);
            }
        }
        return result;
    }

    /**
     * Position of every relationship in declaration order. The relationships are collected
     * in document order, with includes followed at the point of the directive, so this is
     * the order in which the reference library parses them.
     */
    private declaredRelationshipOrder(): Map<Relationship, number> {
        if (!this.declaredRelationshipOrderCache) {
            this.declaredRelationshipOrderCache = new Map<Relationship, number>();
            this.relationships.forEach((rel, index) => this.declaredRelationshipOrderCache!.set(rel, index));
        }
        return this.declaredRelationshipOrderCache;
    }

    /**
     * Sorts entries by the declaration position of the relationship they are derived
     * from. Entries whose relationship is not part of the parsed model sort last.
     */
    private byDeclarationOrder<T>(entries: Iterable<T>, base: (entry: T) => Relationship): T[] {
        const order = this.declaredRelationshipOrder();
        const position = (entry: T): number => order.get(base(entry)) ?? Number.MAX_SAFE_INTEGER;
        return [...entries].sort((a, b) => position(a) - position(b));
    }

    /**
     * Reduces a parent element's relationships to the set the reference library replicates
     * onto its deployment instances: the same reduction the model applies to the whole
     * workspace, restricted to the relationships the parent element owns.
     */
    private dedupImpliedByPair(entries: ImpliedRelationship[]): ImpliedRelationship[] {
        return this.reduceRelationships(this.groupByBase(entries));
    }

    /** Source/destination pair key used to deduplicate relationships. */
    private relationshipPairKey(rel: ImpliedRelationship): string {
        return `${this.getId(rel.source)}|${this.getId(rel.target)}`;
    }

    /** Direct and implied relationships whose source is the given element. */
    private relationshipsOwnedBy(element: NamedElement): ImpliedRelationship[] {
        // Builds (and caches) the source index as a side effect; after it returns the
        // index is guaranteed to be set, only the per-element key may be missing.
        this.collectAllRelationships();
        return this.relationshipsBySourceImplied!.get(this.getId(element)) ?? [];
    }

    /** Extracts the relationships of an element, dispatching on its concrete type. */
    /**
     * Resolves the Container / Component / SoftwareSystem hierarchy of a relationship
     * target for implied-relationship projection. A Component target yields itself, its
     * parent Container and that Container's parent SoftwareSystem; a Container target
     * yields itself and its parent SoftwareSystem; a SoftwareSystem target yields only
     * itself. Other element kinds yield nothing.
     */
    private resolveTargetHierarchy(target: NamedElement): {
        component?: Component;
        container?: Container;
        softwareSystem?: SoftwareSystem;
    } {
        if (isComponent(target)) {
            const container = this.resolveComponentParent(target);
            return {
                component: target,
                container,
                softwareSystem: container ? this.resolveContainerParent(container) : undefined,
            };
        }
        if (isContainer(target)) {
            return { container: target, softwareSystem: this.resolveContainerParent(target) };
        }
        if (isSoftwareSystem(target)) {
            return { softwareSystem: target };
        }
        return {};
    }

    /**
     * Pushes an implied relationship from `source` to `impliedTarget` (built from `rel`)
     * when the target is present and impliedRelationshipAllowed passes. When `skipSelf`
     * is set, the push is suppressed if `impliedTarget` equals the relationship's own
     * direct target — the explicit relationship already covers that edge.
     */
    private pushImplied(
        rels: ImpliedRelationship[],
        rel: Relationship,
        source: RelationshipMember,
        impliedTarget: RelationshipMember | undefined,
        ownTarget?: NamedElement,
        skipSelf = false
    ): void {
        if (!impliedTarget) return;
        if (skipSelf && impliedTarget === ownTarget) return;
        if (!this.impliedRelationshipAllowed(source, impliedTarget)) return;
        rels.push(this.createRelationshipEx(source, impliedTarget, rel));
    }

    /**
     * Memoizes per-element relationship extraction. Extraction is a pure function of the
     * model, so the result is computed once and reused; the cache is dropped by
     * invalidateAllRelationships() whenever the model changes.
     */
    private memoExtract(key: NamedElement, compute: () => ImpliedRelationship[]): ImpliedRelationship[] {
        const cached = this.relationshipExtractionCache.get(key);
        if (cached !== undefined) return cached;
        const result = compute();
        this.relationshipExtractionCache.set(key, result);
        return result;
    }

    private extractRelationshipsForPerson(person: Person): ImpliedRelationship[] {
        return this.memoExtract(person, () => this.computeRelationshipsForPerson(person));
    }
    private extractRelationshipsForSoftwareSystem(softwareSystem: SoftwareSystem): ImpliedRelationship[] {
        return this.memoExtract(softwareSystem, () => this.computeRelationshipsForSoftwareSystem(softwareSystem));
    }
    private extractRelationshipsForContainer(container: Container): ImpliedRelationship[] {
        return this.memoExtract(container, () => this.computeRelationshipsForContainer(container));
    }
    private extractRelationshipsForComponent(component: Component): ImpliedRelationship[] {
        return this.memoExtract(component, () => this.computeRelationshipsForComponent(component));
    }
    private extractRelationshipsForCustom(custom: CustomElement): ImpliedRelationship[] {
        return this.memoExtract(custom, () => this.computeRelationshipsForCustom(custom));
    }
    private extractRelationshipsForDeploymentNode(deploymentNode: DeploymentNode): ImpliedRelationship[] {
        return this.memoExtract(deploymentNode, () => this.computeRelationshipsForDeploymentNode(deploymentNode));
    }
    private extractRelationshipsForInfrastructureNode(infrastructureNode: InfrastructureNode): ImpliedRelationship[] {
        return this.memoExtract(infrastructureNode, () => this.computeRelationshipsForInfrastructureNode(infrastructureNode));
    }
    private extractRelationshipsForSoftwareSystemInstance(softwareSystemInstance: SoftwareSystemInstance): ImpliedRelationship[] {
        return this.memoExtract(softwareSystemInstance, () => this.computeRelationshipsForSoftwareSystemInstance(softwareSystemInstance));
    }
    private extractRelationshipsForContainerInstance(containerInstance: ContainerInstance): ImpliedRelationship[] {
        return this.memoExtract(containerInstance, () => this.computeRelationshipsForContainerInstance(containerInstance));
    }

    private extractRelationshipsForElement(el: NamedElement): ImpliedRelationship[] {
        if (isPerson(el)) return this.extractRelationshipsForPerson(el);
        if (isSoftwareSystem(el)) return this.extractRelationshipsForSoftwareSystem(el);
        if (isContainer(el)) return this.extractRelationshipsForContainer(el);
        if (isComponent(el)) return this.extractRelationshipsForComponent(el);
        if (isCustomElement(el)) return this.extractRelationshipsForCustom(el);
        if (isDeploymentNode(el)) return this.extractRelationshipsForDeploymentNode(el);
        if (isInfrastructureNode(el)) return this.extractRelationshipsForInfrastructureNode(el);
        if (isSoftwareSystemInstance(el)) return this.extractRelationshipsForSoftwareSystemInstance(el);
        if (isContainerInstance(el)) return this.extractRelationshipsForContainerInstance(el);
        return [];
    }

    /**
     * Extracts all relationships for a given Container, including:
     * - Direct relationships where the Container is the source
     * - Implied relationships propagated up/down the container hierarchy:
     *   Container → Container (to same-level sibling container)
     *   Container → SoftwareSystem (to parent system of target)
     *   Source SoftwareSystem → Target Component (if target is a component in another container)
     *   Source SoftwareSystem → Target Container (if target is another container under a different system)
     *   Source SoftwareSystem → Target SoftwareSystem (if target is a different system)
     * 
     * Implied generation is controlled by !impliedRelationships flag.
     */
    private computeRelationshipsForContainer(container: Container) {
        const rels: ImpliedRelationship[] = [];
        for (const rel of this.relationshipsBySource.get(this.getId(container)) ?? []) {
            const sourceContainer = this.resolveSource(rel);
            if (sourceContainer === container) {
                const target = this.resolveTarget(rel);
                if(target) {
                    rels.push({
                        relationship: rel,
                        linked: undefined,
                        source: sourceContainer,
                        target: target
                    });

                    // only generate implied relationships if the !impliedRelationships flag allows it
                    if(this.shouldGenerateImplied(rel)) {

                        const sourceSoftwareSystem = this.resolveContainerParent(sourceContainer);
                        const { component: targetComponent, container: targetContainer, softwareSystem: targetSoftwareSystem } = this.resolveTargetHierarchy(target);

                        // implied: source Container → target Container (same-level sibling)
                        // skip self-reference and exact duplicate of the explicit relationship
                        this.pushImplied(rels, rel, sourceContainer, targetContainer, target, true);
                        // implied: source Container → target SoftwareSystem (parent of target)
                        // skip relationship to own parent system and exact duplicate
                        this.pushImplied(rels, rel, sourceContainer, targetSoftwareSystem, target, true);

                        if(sourceSoftwareSystem) {
                            // implied: source SoftwareSystem → target Component (child of another container)
                            // skip relationship to own child component
                            this.pushImplied(rels, rel, sourceSoftwareSystem, targetComponent);
                            // implied: source SoftwareSystem → target Container (under a different system)
                            // skip relationship to own child container
                            this.pushImplied(rels, rel, sourceSoftwareSystem, targetContainer);
                            // implied: source SoftwareSystem → target SoftwareSystem (cross-system)
                            // skip self-reference
                            this.pushImplied(rels, rel, sourceSoftwareSystem, targetSoftwareSystem);
                        }
                    }
                }
            }
        }
        return rels;
    }

    /**
     * Extracts all relationships for a given Component, including:
     * - Direct relationships where the Component is the source
     * - Implied relationships propagated up/down the component hierarchy:
     *   Component → Container (to parent container of target component)
     *   Component → SoftwareSystem (to grandparent system of target)
     *   Source Container → Target Component (if target is another component in a different container)
     *   Source Container → Target Container (sibling container)
     *   Source Container → Target SoftwareSystem (parent system of target)
     *   Source SoftwareSystem → Target Component (grandparent → component in different container)
     *   Source SoftwareSystem → Target Container (grandparent → sibling container)
     *   Source SoftwareSystem → Target SoftwareSystem (cross-system)
     * 
     * Implied generation is controlled by !impliedRelationships flag.
     */
    private computeRelationshipsForComponent(component: Component) {
        const rels: ImpliedRelationship[] = [];
        for (const rel of this.relationshipsBySource.get(this.getId(component)) ?? []) {
            const sourceComponent = this.resolveSource(rel);
            if (sourceComponent === component) {
                const target = this.resolveTarget(rel);
                if(target) {                
                    rels.push({
                        relationship: rel,
                        linked: undefined,
                        source: sourceComponent,
                        target: target
                    });

                    // only generate implied relationships if the !impliedRelationships flag allows it
                    if(this.shouldGenerateImplied(rel)) {
                        const sourceContainer = this.resolveComponentParent(sourceComponent);
                        const sourceSoftwareSystem = sourceContainer ? this.resolveContainerParent(sourceContainer) : undefined;
                        const { component: targetComponent, container: targetContainer, softwareSystem: targetSoftwareSystem } = this.resolveTargetHierarchy(target);

                        // implied: source Component → target Container (parent of target)
                        // skip self-referencing parent container and exact duplicate
                        this.pushImplied(rels, rel, sourceComponent, targetContainer, target, true);
                        // implied: source Component → target SoftwareSystem (grandparent of target)
                        // skip self-referencing parent system and exact duplicate
                        this.pushImplied(rels, rel, sourceComponent, targetSoftwareSystem, target, true);

                        if(sourceContainer) {
                            // implied: source Container → target Component (sibling component in another container)
                            // skip self-reference
                            this.pushImplied(rels, rel, sourceContainer, targetComponent);
                            // implied: source Container → target Container (sibling)
                            // skip self-reference
                            this.pushImplied(rels, rel, sourceContainer, targetContainer);
                            // implied: source Container → target SoftwareSystem (parent of target)
                            // skip relationship to own parent system                        
                            this.pushImplied(rels, rel, sourceContainer, targetSoftwareSystem);

                            if(sourceSoftwareSystem) {
                                // implied: source SoftwareSystem → target Component (grandparent → component)
                                // skip relationship to own child component
                                this.pushImplied(rels, rel, sourceSoftwareSystem, targetComponent);
                                // implied: source SoftwareSystem → target Container (grandparent → sibling container)
                                // skip relationship to own child container
                                this.pushImplied(rels, rel, sourceSoftwareSystem, targetContainer);
                                // implied: source SoftwareSystem → target SoftwareSystem (cross-system)
                                // skip self-reference
                                this.pushImplied(rels, rel, sourceSoftwareSystem, targetSoftwareSystem);
                            }
                        }
                    }
                }
            }
        }
        return rels;
    }

    /**
     * Extracts all relationships for a given SoftwareSystem, including:
     * - Direct relationships where the SoftwareSystem is the source
     * - Implied relationships propagated up the hierarchy:
     *   SoftwareSystem → Container (if target is a container under a different system)
     *   SoftwareSystem → SoftwareSystem (if target is a different system)
     * 
     * Implied generation is controlled by !impliedRelationships flag.
     */
    private computeRelationshipsForSoftwareSystem(softwareSystem: SoftwareSystem) {
        const rels: ImpliedRelationship[] = [];
        for (const rel of this.relationshipsBySource.get(this.getId(softwareSystem)) ?? []) {
            const sourceSoftwareSystem = this.resolveSource(rel);
            if (sourceSoftwareSystem === softwareSystem) {
                const target = this.resolveTarget(rel);
                if(target) {                
                    rels.push({
                        relationship: rel,
                        linked: undefined,
                        source: sourceSoftwareSystem,
                        target: target
                    });
                    // only generate implied relationships if the !impliedRelationships flag allows it
                    if(this.shouldGenerateImplied(rel)) {
                        const { container: targetContainer, softwareSystem: targetSoftwareSystem } = this.resolveTargetHierarchy(target);

                        // implied: source SoftwareSystem → target Container (under a different system)
                        this.pushImplied(rels, rel, sourceSoftwareSystem, targetContainer);
                        // implied: source SoftwareSystem → target SoftwareSystem (cross-system)
                        this.pushImplied(rels, rel, sourceSoftwareSystem, targetSoftwareSystem);
                    }
                }
            }
        }
        return rels;
    }

    /**
     * Extracts all relationships for a given Person, including:
     * - Direct relationships where the Person is the source
     * - Implied relationships propagated up the hierarchy:
     *   Person → Container (only when target is a Component, i.e. its parent Container)
     *   Person → SoftwareSystem (only when target is a Component or Container inside a system)
     * 
     * Implied generation is controlled by !impliedRelationships flag.
     */
    private computeRelationshipsForPerson(person: Person) {
        const rels: ImpliedRelationship[] = [];
        for (const rel of this.relationshipsBySource.get(this.getId(person)) ?? []) {
            const sourcePerson = this.resolveSource(rel);            
            if (sourcePerson === person) {
                const target = this.resolveTarget(rel);
                if(target) {                
                    rels.push({
                        relationship: rel,
                        linked: undefined,
                        source: sourcePerson,
                        target: target
                    });
                    // only generate implied relationships if the !impliedRelationships flag allows it
                    if(this.shouldGenerateImplied(rel)) {
                        const { container: targetContainer, softwareSystem: targetSoftwareSystem } = this.resolveTargetHierarchy(target);
                        // implied: Person → Container (only generated when target is Component, i.e. the parent Container)
                        if(targetContainer) {
                            rels.push(this.createRelationshipEx(sourcePerson, targetContainer, rel));
                        }
                        // implied: Person → SoftwareSystem (generated when target is Component or Container)
                        // No need to check target !== targetSoftwareSystem — Person can never be a SoftwareSystem
                        if(targetSoftwareSystem) {
                            rels.push(this.createRelationshipEx(sourcePerson, targetSoftwareSystem, rel));
                        }
                    }
                }
            }
        }
        return rels;
    }

    /**
     * Extracts all relationships for a given Custom element, including:
     * - Direct relationships where the Custom element is the source
     * - Implied relationships propagated up the hierarchy:
     *   Custom → Container (only when target is a Component, i.e. its parent Container)
     *   Custom → SoftwareSystem (only when target is a Component or Container inside a system)
     * 
     * Implied generation is controlled by !impliedRelationships flag.
     */
    private computeRelationshipsForCustom(custom: CustomElement) {
        const rels: ImpliedRelationship[] = [];
        for (const rel of this.relationshipsBySource.get(this.getId(custom)) ?? []) {
            const sourceCustom = this.resolveSource(rel);
            if (sourceCustom === custom) {
                const target = this.resolveTarget(rel);
                if(target) {                
                    rels.push({
                        relationship: rel,
                        linked: undefined,
                        source: sourceCustom,
                        target: target
                    });
                    // only generate implied relationships if the !impliedRelationships flag allows it
                    if(this.shouldGenerateImplied(rel)) {
                        const { container: targetContainer, softwareSystem: targetSoftwareSystem } = this.resolveTargetHierarchy(target);
                        // implied: Custom → Container (only generated when target is Component, i.e. the parent Container)
                        if(targetContainer) {
                            rels.push(this.createRelationshipEx(sourceCustom, targetContainer, rel));
                        }
                        // implied: Custom → SoftwareSystem (generated when target is Component or Container)
                        // No need to check target !== targetSoftwareSystem — Custom can never be a SoftwareSystem
                        if(targetSoftwareSystem) {
                            rels.push(this.createRelationshipEx(sourceCustom, targetSoftwareSystem, rel));
                        }
                    }                    
                }
            }
        }
        return rels;
    }

    /**
     * Extracts direct relationships for a DeploymentNode.
     * Deployment nodes do not generate implied relationships —
     * only explicit relationships defined in the DSL are returned.
     */
    private computeRelationshipsForDeploymentNode(deploymentNode: DeploymentNode) {
        const rels: ImpliedRelationship[] = [];
        for (const rel of this.relationshipsBySource.get(this.getId(deploymentNode)) ?? []) {
            const sourceDeploymentNode = this.resolveSource(rel);
            if (sourceDeploymentNode === deploymentNode) {
                const target = this.resolveTarget(rel);
                if(target) {
                    rels.push({
                        relationship: rel,
                        linked: undefined,
                        source: sourceDeploymentNode,
                        target: target
                    });
                }
            }
        }
        return rels;
    }

    /**
     * Extracts all relationships for an InfrastructureNode, including:
     * - Direct explicit relationships where the InfrastructureNode is the source
     * 
     * Infrastructure nodes do not generate implied relationships —
     * only explicit relationships defined in the DSL are returned.
     */
    private computeRelationshipsForInfrastructureNode(infrastructureNode: InfrastructureNode) {
        const rels: ImpliedRelationship[] = [];
        for (const rel of this.relationshipsBySource.get(this.getId(infrastructureNode)) ?? []) {
            const sourceInfrastructureNode = this.resolveSource(rel);
            if (sourceInfrastructureNode === infrastructureNode) {
                const target = this.resolveTarget(rel);
                if(target) {
                    rels.push({
                        relationship: rel,
                        linked: undefined,
                        source: sourceInfrastructureNode,
                        target: target
                    });
                }
            }
        }
        return rels;
    }

    /**
     * Extracts all relationships for a SoftwareSystemInstance, including:
     * - Direct explicit relationships where the SoftwareSystemInstance is the source
     * - Implied relationships projected from the parent SoftwareSystem and its child
     *   containers/components to sibling instances in the same deployment environment:
     *   SoftwareSystemInstance → SoftwareSystemInstance (if the parent system/container/component
     *     has a relationship to another SoftwareSystem, and both have instances in the same env)
     *   SoftwareSystemInstance → ContainerInstance (if the parent system/container/component
     *     has a relationship to a Container, and both have instances in the same env)
     * 
     * The method collects all direct and implied relationships originating from:
     *   - The parent SoftwareSystem itself
     *   - All Containers belonging to the parent SoftwareSystem
     *   - All Components belonging to those Containers
     * Then projects those relationships onto sibling instances in the same deployment environment.
     * 
     * Implied generation is controlled by !impliedRelationships flag (checked against the source relationship's offset).
     */
    /** Deployment instances (SoftwareSystemInstance/ContainerInstance) in element order. */
    private deploymentInstances(): NamedElement[] {
        if (!this.deploymentInstancesCache) {
            this.deploymentInstancesCache = this.elements.filter(
                el => isSoftwareSystemInstance(el) || isContainerInstance(el));
        }
        return this.deploymentInstancesCache;
    }

    /**
     * All relationships of a software system's hierarchy (the system, its containers and
     * their components), used to project implied relationships onto deployment instances.
     * Memoized per system: every instance of the same system would otherwise rebuild it.
     */
    private parentRelsForSystem(system: SoftwareSystem): Set<ImpliedRelationship> {
        const cached = this.systemParentRelsCache.get(system);
        if (cached !== undefined) return cached;
        this.ensureRelationshipIndexes();
        const entries: ImpliedRelationship[] = [...this.extractRelationshipsForSoftwareSystem(system)];
        for (const c of this.containersBySystemCache.get(system) ?? []) {
            entries.push(...this.extractRelationshipsForContainer(c));
            for (const comp of this.componentsByContainerCache.get(c) ?? []) {
                entries.push(...this.extractRelationshipsForComponent(comp));
            }
        }
        const owned = entries.filter(rel => this.getId(rel.source) === this.getId(system));
        const rels = new Set(this.dedupImpliedByPair(owned));
        this.systemParentRelsCache.set(system, rels);
        return rels;
    }

    /**
     * All relationships of a container and its components, used to project implied
     * relationships onto deployment instances. Memoized per container.
     */
    private parentRelsForContainer(container: Container): Set<ImpliedRelationship> {
        const cached = this.containerParentRelsCache.get(container);
        if (cached !== undefined) return cached;
        this.ensureRelationshipIndexes();
        const entries: ImpliedRelationship[] = [...this.extractRelationshipsForContainer(container)];
        for (const comp of this.componentsByContainerCache.get(container) ?? []) {
            entries.push(...this.extractRelationshipsForComponent(comp));
        }
        const owned = entries.filter(rel => this.getId(rel.source) === this.getId(container));
        const rels = new Set(this.dedupImpliedByPair(owned));
        this.containerParentRelsCache.set(container, rels);
        return rels;
    }

    private computeRelationshipsForSoftwareSystemInstance(softwareSystemInstance: SoftwareSystemInstance) {
        const softwareSystemInstanceRels: ImpliedRelationship[] = [];

        // collect direct explicit relationships where this instance is the source
        for (const rel of this.relationshipsBySource.get(this.getId(softwareSystemInstance)) ?? []) {
            const sourceSoftwareSystemInstance = this.resolveSource(rel);            
            if (sourceSoftwareSystemInstance === softwareSystemInstance) {
                const target = this.resolveTarget(rel);
                if(target) {
                    softwareSystemInstanceRels.push({
                        relationship: rel,
                        linked: undefined,
                        source: sourceSoftwareSystemInstance,
                        target: target
                    });
                }
            }
        }

        // project implied relationships from the parent SoftwareSystem, its containers,
        // and its components to sibling instances in the same deployment environment.
        // Any direct or implied relationship from the parent hierarchy that targets
        // a SoftwareSystem or Container is projected onto the corresponding instances.
        const parentSoftwareSystem = this.el(softwareSystemInstance.softwareSystem.ref);
        if (parentSoftwareSystem) {
            const allParentRels = this.parentRelsForSystem(parentSoftwareSystem);

            if (allParentRels.size > 0) {
                const softwareSystemInstanceEnv = this.getEnvironment(softwareSystemInstance);
                for (const el of this.deploymentInstances()) {
                    if (isSoftwareSystemInstance(el)) {
                        const elementEnv = this.getEnvironment(el);
                        for (const rel of allParentRels) {
                            if (this.shouldGenerateImplied(rel.relationship)) {
                                if (rel.target === this.el(el.softwareSystem.ref) && elementEnv === softwareSystemInstanceEnv
                                    && this.hasCommonDeploymentGroup(softwareSystemInstance, el)) {
                                    this.addProjectedRelationship(softwareSystemInstanceRels, softwareSystemInstance, el, rel.relationship);
                                }
                            }
                        }
                    } else if (isContainerInstance(el)) {
                        const elementEnv = this.getEnvironment(el);
                        for (const rel of allParentRels) {
                            if (this.shouldGenerateImplied(rel.relationship)) {
                                if (rel.target === this.el(el.container.ref) && elementEnv === softwareSystemInstanceEnv
                                    && this.hasCommonDeploymentGroup(softwareSystemInstance, el)) {
                                    this.addProjectedRelationship(softwareSystemInstanceRels, softwareSystemInstance, el, rel.relationship);
                                }
                            }
                        }
                    }
                }
            }
        }

        return this.dedupeRelationships(softwareSystemInstanceRels);
    }

    /**
     * Extracts all relationships for a ContainerInstance, including:
     * - Direct explicit relationships where the ContainerInstance is the source
     * - Implied relationships projected from the parent Container and its child Components
     *   to sibling instances in the same deployment environment:
     *   ContainerInstance → SoftwareSystemInstance (if the parent Container/Component has a relationship
     *     to a SoftwareSystem, and both have instances in the same environment)
     *   ContainerInstance → ContainerInstance (if the parent Container/Component has a relationship
     *     to another Container or its parent SoftwareSystem, and both have instances in the same env)
     * 
     * The method collects all direct and implied relationships originating from:
     *   - The parent Container itself
     *   - All Components belonging to that Container
     * Then projects those relationships onto sibling instances in the same deployment environment.
     * Additionally, if a ContainerInstance's parent Container has a relationship to a SoftwareSystem,
     * that is also projected onto sibling ContainerInstances.
     * 
     * Implied generation is controlled by !impliedRelationships flag (checked against the source relationship's offset).
     */
    private computeRelationshipsForContainerInstance(containerInstance: ContainerInstance) {
        const rels: ImpliedRelationship[] = [];

        // collect direct explicit relationships where this instance is the source
        for (const rel of this.relationshipsBySource.get(this.getId(containerInstance)) ?? []) {
            const sourceContainerInstance = this.resolveSource(rel);
            if (sourceContainerInstance === containerInstance) {
                const target = this.resolveTarget(rel);
                if(target) {
                    rels.push({
                        relationship: rel,
                        linked: undefined,
                        source: sourceContainerInstance,
                        target: target
                    });
                }
            }
        }

        // Project implied relationships from parent Container/Component to ContainerInstance.
        // Relationships are projected regardless of which deployment node the instances
        // live in - cross-node relationships are included too.
        const env = this.getEnvironment(containerInstance);
        const parentContainer = this.el(containerInstance.container.ref);
        if(parentContainer) {
            const allParentRels = this.parentRelsForContainer(parentContainer);
            for (const el of this.deploymentInstances()) {
                if(isSoftwareSystemInstance(el)) {
                    for(const relContainer of allParentRels) {
                        if(this.shouldGenerateImplied(relContainer.relationship)) {
                            if(relContainer.target === this.el(el.softwareSystem.ref) && env === this.getEnvironment(el)
                                && this.hasCommonDeploymentGroup(containerInstance, el)) {
                                this.addProjectedRelationship(rels, containerInstance, el, relContainer.relationship);
                            }
                        }
                    }
                } else if(isContainerInstance(el)) {
                    for(const relContainer of allParentRels) {
                        if(this.shouldGenerateImplied(relContainer.relationship)) {
                            if(env === this.getEnvironment(el)) {
                                const shouldProject = (relContainer.target === this.el(el.container.ref)) ||
                                    (el.container.ref && this.resolveContainerParent(el.container.ref) === relContainer.target);
                                if (shouldProject && this.hasCommonDeploymentGroup(containerInstance, el)) {
                                    this.addProjectedRelationship(rels, containerInstance, el, relContainer.relationship);
                                }
                            }
                        }
                    }
                }
            }
        }

        return this.dedupeRelationships(rels);
    }
    
    /**
     * Post-parse resolution for DeploymentGroupOrTag ambiguity on instance nodes
     * (ContainerInstance, SoftwareSystemInstance, GenericInstance).
     *
     * Called after collectLocal() completes, so every DeploymentGroup identifier is
     * already recorded. For each instance node with node.value set (from the
     * DeploymentGroupOrTag grammar fragment):
     * - If the value names a known DeploymentGroup → it is a group reference: the
     *   resolved name is recorded on the node for the JSON output and for
     *   relationship scoping.
     * - Otherwise, for a GenericInstance the value is a tag and is added to node.tags;
     *   for the other instance types the value is ignored, as in the reference.
     */
    private resolveAllInstanceValues(): void {
        // 1. Use the DeploymentGroup identifiers collected while walking the environments
        const deploymentGroupsByIdentifier = this.deploymentGroupsByIdentifier;

        // 2. Scan all elements for instance nodes with unresolved value
        for (const el of this.elements) {
            if (!isContainerInstance(el) && !isSoftwareSystemInstance(el) && !isGenericInstance(el)) {
                continue;
            }
            if (!el.value) continue;

            const val = C4Utils.stripQuotes(el.value);
            if (!val) {
                el.value = undefined;
                continue;
            }

            const groupName = deploymentGroupsByIdentifier.get(val);
            if (groupName) {
                // The value names a DeploymentGroup → it is a group reference. The grammar
                // keeps this single value separate because it cannot tell a group from a
                // tag, so record the resolved name for the JSON output and for relationship
                // scoping (ContainerInstanceParser resolves that token as a deployment
                // group). `resolvedDeploymentGroups` is a runtime property, not in the grammar.
                const ext = el as any;
                const resolved = ext.resolvedDeploymentGroups ?? (ext.resolvedDeploymentGroups = []);
                if (!resolved.includes(groupName)) {
                    resolved.push(groupName);
                }
            } else if (isGenericInstance(el)) {
                // GenericInstance is an extension: a single value is a tag.
                if (!el.tags.includes(val)) {
                    el.tags.push(val);
                }
            } else {
                // The value occupies the deployment group slot of a container/software
                // system instance; a reference to no known group is ignored.
            }
            // Clear value after resolution
            el.value = undefined;
        }
    }

    /**
     * Documents visible to a view: its own document plus every document it
     * extends or includes. Elements declared in workspaces that extend the view's
     * workspace are not visible, because the reference resolves views while parsing.
     */
    private allowedViewDocuments(view: any, visited: Set<string> = new Set<string>()): Set<string> {
        const documents = new Set<string>();
        const root = AstUtils.getDocument(view)?.parseResult?.value;
        if (root) this.collectViewSourceDocuments(root, documents, visited);
        return documents;
    }

    private collectViewSourceDocuments(node: AstNode, documents: Set<string>, visited: Set<string>): void {
        const uri = AstUtils.getDocument(node)?.uri.toString();
        if (uri) {
            if (visited.has(uri)) return;
            visited.add(uri);
            documents.add(uri);
        }
        for (const content of AstUtils.streamAllContents(node)) {
            if (!isInclude(content) || !content.file) continue;
            const includedRoot = this.resolveIncludedRoot(node, content.file);
            if (includedRoot) this.collectViewSourceDocuments(includedRoot, documents, visited);
        }
        if (isWorkspace(node) || (isC4Document(node) && node.workspaces.length > 0)) {
            const workspace = isWorkspace(node) ? node
                : (isC4Document(node) ? node.workspaces.find(isWorkspace) : undefined);
            if (workspace?.extendsUri) {
                const parent = this.resolveParentWorkspace(workspace, workspace.extendsUri);
                if (parent) this.collectViewSourceDocuments(parent, documents, visited);
            }
        }
    }

    /** Whether an element belongs to one of the documents visible to a view. */
    private isInAllowedDocuments(element: NamedElement | undefined, documents: Set<string>): boolean {
        if (!element) return false;
        const uri = AstUtils.getDocument(element)?.uri.toString();
        return !!uri && documents.has(uri);
    }

    /**
     * All views visible to a workspace: the extended workspaces' views first, then
     * the workspace's own, in declaration order.
     */
    private workspaceViews(workspace: Workspace, visited: Set<string> = new Set<string>()): any[] {
        const views: any[] = [];
        const docUri = AstUtils.getDocument(workspace)?.uri.toString();
        if (docUri) {
            if (visited.has(docUri)) return views;
            visited.add(docUri);
        }
        if (workspace.extendsUri) {
            const parent = this.resolveParentWorkspace(workspace, workspace.extendsUri);
            if (parent) views.push(...this.workspaceViews(parent, visited));
        }
        for (const block of workspace.viewsBlocks ?? []) {
            views.push(...(block.views ?? []));
            // !include inside the views block contributes the views of the fragment.
            views.push(...this.includedViews(block, visited));
        }
        return views;
    }

    /**
     * Views contributed by `!include` directives in a views block. A fragment is
     * parsed as its own root document, so its views arrive either as a nested
     * `views { }` block or as bare view declarations (a fragment is spliced into
     * the including file, which sits inside the views block).
     */
    private includedViews(node: AstNode, visited: Set<string>): any[] {
        const views: any[] = [];
        for (const includeDirective of (node as any).includes ?? []) {
            if (!includeDirective.file) continue;
            const includedRoot = this.resolveIncludedRoot(node, includeDirective.file);
            if (!includedRoot) continue;
            const docUri = AstUtils.getDocument(includedRoot)?.uri.toString();
            if (docUri) {
                if (visited.has(docUri)) continue;
                visited.add(docUri);
            }
            // A fragment root (C4Document): bare view declarations and/or a
            // nested views block.
            const fragment = includedRoot as any;
            for (const block of fragment.viewsBlocks ?? []) {
                views.push(...(block.views ?? []));
                views.push(...this.includedViews(block, visited));
            }
            views.push(...(fragment.views ?? []));
        }
        return views;
    }

    /** Numbers the workspace views in creation order and records whether each key was auto-generated. */
    private assignViewOrder(workspace: Workspace): void {
        this.viewOrderByNode.clear();
        this.workspaceViews(workspace).forEach((view, index) => {
            this.viewOrderByNode.set(view, {
                order: index + 1,
                generatedKey: !C4Utils.stripQuotes(view.key),
            });
        });
    }

    /**
     * The `order` and `generatedKey` fields of a view. `generatedKey` is emitted only
     * when true, matching the reference output.
     */
    private viewOrderFields(view: any): { order?: number; generatedKey?: boolean } {
        const entry = this.viewOrderByNode.get(view);
        if (!entry) return {};
        return entry.generatedKey
            ? { order: entry.order, generatedKey: true }
            : { order: entry.order };
    }

    /**
     * Workspace name for the JSON output. A body `name` line overrides the positional
     * header; an explicitly empty value omits the field, while a workspace that
     * declares neither falls back to the default name.
     */
    private workspaceName(workspace: Workspace): string | undefined {
        return this.workspaceValue(workspace, ws => ws.nameProp.at(-1)?.value ?? ws.name, "Name");
    }

    /** Workspace description, resolved like {@link workspaceName}. */
    private workspaceDescription(workspace: Workspace): string | undefined {
        return this.workspaceValue(workspace, ws => ws.descriptionProp.at(-1)?.value ?? ws.description, "Description");
    }

    /**
     * Resolves a workspace text field: an explicit value (even empty) wins, otherwise
     * the value is inherited from the extended workspace, otherwise the default.
     */
    private workspaceValue(workspace: Workspace, pick: (ws: Workspace) => string | undefined, fallback: string): string | undefined {
        const own = pick(workspace);
        if (own !== undefined) return this.substitute(own) || undefined;
        const inherited = this.inheritedWorkspaceValue(workspace, pick);
        return inherited !== undefined ? (this.substitute(inherited) || undefined) : fallback;
    }

    /**
     * Value of a workspace field, falling back to the extended workspace when the
     * extending workspace does not define it.
     */
    private inheritedWorkspaceValue(
        workspace: Workspace,
        pick: (ws: Workspace) => string | undefined,
        visited: Set<string> = new Set<string>()
    ): string | undefined {
        const own = pick(workspace);
        if (own !== undefined && own !== '') return own;
        if (!workspace.extendsUri) return undefined;
        const docUri = AstUtils.getDocument(workspace)?.uri.toString();
        if (docUri) {
            if (visited.has(docUri)) return undefined;
            visited.add(docUri);
        }
        const parent = this.resolveParentWorkspace(workspace, workspace.extendsUri);
        return parent ? this.inheritedWorkspaceValue(parent, pick, visited) : undefined;
    }

    /**
     * Canonical name of an element (`<Type>://<path>`), used to resolve
     * `!element "<canonical name>"` references. Dots and slashes are removed from
     * every name segment so the separator stays unambiguous.
     */
    private canonicalName(node: AstNode | undefined): string | undefined {
        const clean = (name: string | undefined) => C4Utils.stripQuotes(name ?? '').replace(/[./]/g, '');
        const deploymentNodePath = (deploymentNode: DeploymentNode): string => {
            const parents: string[] = [];
            let parent = this.resolveDeploymentNodeParent(deploymentNode);
            while (parent) {
                parents.unshift(clean(parent.name));
                parent = this.resolveDeploymentNodeParent(parent);
            }
            const prefix = parents.length > 0 ? parents.join('/') + '/' : '';
            return `${clean(this.getEnvironment(deploymentNode))}/${prefix}${clean(deploymentNode.name)}`;
        };

        if (isCustomElement(node)) return `Custom://${clean(node.name)}`;
        if (isPerson(node)) return `Person://${clean(node.name)}`;
        if (isSoftwareSystem(node)) return `SoftwareSystem://${clean(node.name)}`;
        if (isContainer(node)) {
            // resolveContainerParent follows `!element` targets and !include
            // contexts, unlike a plain $container climb.
            const softwareSystem = this.resolveContainerParent(node as Container);
            return `Container://${clean(softwareSystem?.name)}.${clean(node.name)}`;
        }
        if (isComponent(node)) {
            const container = this.resolveComponentParent(node as Component);
            const softwareSystem = container ? this.resolveContainerParent(container) : undefined;
            return `Component://${clean(softwareSystem?.name)}.${clean(container?.name)}.${clean(node.name)}`;
        }
        if (isDeploymentNode(node)) return `DeploymentNode://${deploymentNodePath(node)}`;
        if (isInfrastructureNode(node)) {
            const parent = this.resolveDeploymentNodeParent(node);
            return parent ? `InfrastructureNode://${deploymentNodePath(parent)}/${clean(node.name)}` : undefined;
        }
        if (isSoftwareSystemInstance(node)) {
            const parent = this.resolveDeploymentNodeParent(node);
            const softwareSystem = this.el(node.softwareSystem?.ref);
            return parent ? `SoftwareSystemInstance://${deploymentNodePath(parent)}/${clean(softwareSystem?.name)}[${this.instanceId(node)}]` : undefined;
        }
        if (isContainerInstance(node)) {
            const parent = this.resolveDeploymentNodeParent(node);
            const container = this.el(node.container?.ref);
            const softwareSystem = container ? this.resolveContainerParent(container as Container) : undefined;
            return parent ? `ContainerInstance://${deploymentNodePath(parent)}/${clean(softwareSystem?.name)}.${clean(container?.name)}[${this.instanceId(node)}]` : undefined;
        }
        return undefined;
    }

    /**
     * Deployment groups declared directly on an instance, as names, deduplicated and
     * sorted alphabetically like the reference's TreeSet. Besides the explicit
     * `deploymentGroups` references this covers the single bare value after the element
     * reference, which the grammar keeps as an ambiguous value until the known groups
     * are collected (see resolveAllInstanceValues).
     */
    private directDeploymentGroupNames(node: any): string[] {
        const names: string[] = [];
        const add = (value: string | undefined) => {
            const name = C4Utils.stripQuotes(value);
            if (name && !names.includes(name)) {
                names.push(name);
            }
        };

        for (const ref of node.deploymentGroups ?? []) {
            add(ref?.ref?.name);
        }
        for (const name of node.resolvedDeploymentGroups ?? []) {
            add(name);
        }

        return names.sort();
    }

    /**
     * Returns the set of deployment group names an instance node (ContainerInstance,
     * SoftwareSystemInstance, GenericInstance) belongs to: the union of the groups
     * declared directly on the instance and the groups of every ancestor deployment
     * node (climbing the $container chain).
     *
     * Used only for implied-relationship scoping: instances relate when they share
     * at least one group (or when neither has any). The JSON `deploymentGroups`
     * field carries only the instance's own groups.
     */
    private getInstanceDeploymentGroupNames(node: AstNode): Set<string> {
        const cached = this.instanceGroupNamesCache.get(node);
        if (cached !== undefined) return cached;
        const groups = new Set<string>();

        // 1. Direct deployment groups declared on the instance
        for (const name of this.directDeploymentGroupNames(node)) {
            groups.add(name);
        }

        // 2. Deployment groups of every ancestor deployment node
        let current: AstNode | undefined = node.$container;
        while (current) {
            if (isDeploymentNode(current)) {
                for (const prop of current.deploymentGroupProps) {
                    for (const ref of prop.deploymentGroups) {
                        const name = ref.ref?.name && C4Utils.stripQuotes(ref.ref.name);
                        if (name) groups.add(name);
                    }
                }
            }
            if (isElementExtension(current)) {
                // An instance declared inside an `!element` block is nested
                // under the extended element, not under the directive: jump to
                // the target and keep climbing from there.
                const target = this.resolveElementExtensionTarget(current);
                current = target && isDeploymentNode(target) ? target : undefined;
                continue;
            }
            current = current.$container;
        }

        this.instanceGroupNamesCache.set(node, groups);
        return groups;
    }

    /** Deployment groups declared directly on a deployment node via `deploymentGroup <ref>`. */
    private deploymentGroupNames(node: DeploymentNode): string[] | undefined {
        const names: string[] = [];
        for (const prop of node.deploymentGroupProps ?? []) {
            for (const ref of prop.deploymentGroups ?? []) {
                const name = C4Utils.stripQuotes(ref.ref?.name);
                if (name && !names.includes(name)) names.push(name);
            }
        }
        return names.length > 0 ? names : undefined;
    }

    /**
     * Checks whether two instance nodes share at least one common deployment group.
     *
     * Rules:
     * - If NEITHER instance has any deployment groups → returns true (backward compatible)
     * - If one or both have groups → returns true only if they share at least one group
     *
     * This ensures that instances without deployment groups still get all implied
     * relationships (backward compatible), while instances with groups only relate
     * to group members.
     */
    private hasCommonDeploymentGroup(a: any, b: any): boolean {
        const groupsA = this.getInstanceDeploymentGroupNames(a);
        const groupsB = this.getInstanceDeploymentGroupNames(b);

        // If neither has deployment groups, allow (backward compatible)
        if (groupsA.size === 0 && groupsB.size === 0) {
            return true;
        }

        // Check for intersection
        for (const g of groupsA) {
            if (groupsB.has(g)) return true;
        }
        return false;
    }

    /**
     * Extracts and merges tags from multiple sources: extra tag parameters, node.tags array,
     * node.tagsProps array, DeploymentGroupOrTag.value (fallback), and overlay tags
     * from !elements/!relationships directives.
     * Returns a comma-separated tag string, or undefined if no tags exist.
     */
    /**
     * Splits a DSL tag value: double quotes are stripped and preserve
     * spaces/commas inside them; everything else is split on whitespace and
     * commas, and single quotes are kept verbatim.
     */
    private parseDslTagValue(raw: string): string[] {
        const trimmed = raw.trim();
        if (trimmed.length === 0) return [];
        if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
            const inner = trimmed.replace(/^"([\s\S]*)"$/, '$1');
            // Quoted values are split on commas; empty segments are kept because an
            // explicitly empty tag stays in the emitted tag list.
            return inner.split(',').map(tag => tag.trim());
        }
        return trimmed.split(/[\s,]+/).filter(tag => tag.length > 0);
    }

    /**
     * Default tags assigned to an element by its type. These are used when
     * matching `element.tag==...` view expressions.
     */
    /** Element tags (defaults + declared) per node: expressions and styles ask repeatedly. */
    private readonly elementTagsCache = new WeakMap<NamedElement, string[]>();

    private tagsOf(element: NamedElement): string[] {
        const cached = this.elementTagsCache.get(element);
        if (cached !== undefined) return cached;
        const defaults = this.elementDefaultTags(element);
        const raw = this.extractTags(element, defaults[0], defaults[1]);
        const tags = raw !== undefined ? raw.split(',').map(tag => tag.trim()) : [];
        this.elementTagsCache.set(element, tags);
        return tags;
    }

    /** Relationship tags per node, memoized for the tag expressions. */
    private readonly relationshipTagsCache = new WeakMap<Relationship, string[]>();

    private tagsOfRelationship(relationship: Relationship): string[] {
        const cached = this.relationshipTagsCache.get(relationship);
        if (cached !== undefined) return cached;
        const raw = this.extractTags(relationship, 'Relationship');
        const tags = raw !== undefined ? raw.split(',').map(tag => tag.trim()) : [];
        this.relationshipTagsCache.set(relationship, tags);
        return tags;
    }

    private elementDefaultTags(element: AstNode | undefined): [string, string?] {
        if (isPerson(element)) return ['Element', 'Person'];
        if (isSoftwareSystem(element)) return ['Element', 'Software System'];
        if (isContainer(element)) return ['Element', 'Container'];
        if (isComponent(element)) return ['Element', 'Component'];
        if (isCustomElement(element)) return ['Element'];
        if (isDeploymentNode(element)) return ['Element', 'Deployment Node'];
        if (isInfrastructureNode(element)) return ['Element', 'Infrastructure Node'];
        if (isSoftwareSystemInstance(element)) return ['Software System Instance'];
        if (isContainerInstance(element)) return ['Container Instance'];
        return ['Element'];
    }

    private extractTags(node: any, extraTag1?: string, extraTag2?: string): string | undefined {
        const n = node as any;
        // Initialize set for collecting unique, cleaned tags
        const collectedTags = new Set<string>();
        // 1. Add first extra tag (if provided)
        if (extraTag1) {
            const stripped = C4Utils.stripQuotes(extraTag1);
            if (stripped) collectedTags.add(stripped.trim());
        }
        // 2. Add second extra tag (if provided)
        if (extraTag2) {
            const stripped = C4Utils.stripQuotes(extraTag2);
            if (stripped) collectedTags.add(stripped.trim());
        }
        // 2.5. Tags inherited from the archetype chain (outermost archetype first).
        for (const inherited of this.archetypeDefaults(node).tags) {
            collectedTags.add(inherited);
        }
        // 3. Process node.tags array
        if (Array.isArray(n.tags)) {
            for (const rawTag of n.tags) {
                if (typeof rawTag !== 'string') continue;
                for (const tag of this.parseDslTagValue(rawTag)) {
                    collectedTags.add(tag);
                }
            }
        }
        // 3.5. Fallback: handle DeploymentGroupOrTag.value if not yet resolved
        // (resolveAllInstanceValues() normally clears this, but this handles edge cases)
        if (n.value) {
            for (const tag of this.parseDslTagValue(String(n.value))) {
                collectedTags.add(tag);
            }
        }
        // 4. Process node.tagsProps array
        if (Array.isArray(n.tagsProps)) {
            for (const tagOrValue of n.tagsProps) {
                if (typeof tagOrValue === 'string') {
                    for (const tag of this.parseDslTagValue(tagOrValue)) {
                        collectedTags.add(tag);
                    }
                } else if (tagOrValue && typeof tagOrValue === 'object') {
                    const valuesArray = tagOrValue.values || tagOrValue.value;
                    if (Array.isArray(valuesArray)) {
                        valuesArray.forEach((tagObj: any) => {
                            const rawValue = typeof tagObj === 'object' ? tagObj.value : tagObj;
                            if (typeof rawValue !== 'string') return;
                            for (const tag of this.parseDslTagValue(rawValue)) {
                                collectedTags.add(tag);
                            }
                        });
                    }
                }
            }
        }
        // 5. Merge overlay tags from !elements / !relationships directives
        const nodeId = this.getId(node);
        const elementOverlay = this.elementOverlays.get(nodeId);
        const relationshipOverlay = this.relationshipOverlays.get(nodeId);
        const overlay = elementOverlay || relationshipOverlay;
        if (overlay?.tags) {
            for (const t of overlay.tags) {
                const trimmed = t.trim();
                if (trimmed) collectedTags.add(trimmed);
            }
        }
        // Return undefined if no tags collected
        if (collectedTags.size === 0) {
            return undefined;
        }
        // Convert set to comma-separated string
        return Array.from(collectedTags).join(',');
    }

    /**
     * Collects nested child elements of a specific type from a parent node.
     * Recursively searches through groups, containers, components, deployment nodes,
     * etc., and follows `!include` directives found inside the block.
     */
    private collectNested<T>(node: any, check: (item: any) => item is T, visitedDocs: Set<string> = new Set(), results: T[] = []): T[] | undefined {
        const accept = (item: any) => {
            if (check(item)) {
                results.push(item);
            } else if (isGroup(item)) {
                this.collectNested(item, check, visitedDocs, results);
            }
        };
        const visit = (list: any[] | undefined) => {
            if (!list) return;
            for (const item of list) accept(item);
        };
        const visitInstances = (list: any[] | undefined) => {
            if (!list) return;
            for (const inst of list) accept(this.el(inst));
        };

        visit(node.elements);
        visit(node.containers);
        visit(node.components);
        visit(node.groups);
        visit(node.children);
        visit(node.nodes);
        visit(node.infrastructureNodes);
        visit(node.softwareSystemInstances);
        visit(node.containerInstances);
        visitInstances(node.genericInstances);
        // Nested archetype instances, exposed as their materialised element.
        visitInstances(node.archetypeInstances);

        // Elements defined via !include inside this block (e.g. containers included
        // inside a softwareSystem) are nested children of this block too. Resolve the
        // include target and collect matching elements from it (handles C4Document /
        // Workspace / ModelBlock wrappers as well as top-level element collections).
        if (Array.isArray(node.includes)) {
            for (const inc of node.includes) {
                if (!inc.file) continue;
                const root = this.resolveIncludedRoot(node, inc.file);
                if (!root) continue;
                const docUri = AstUtils.getDocument(root)?.uri.toString();
                if (docUri) {
                    if (visitedDocs.has(docUri)) continue;
                    visitedDocs.add(docUri);
                }
                this.collectNested(root, check, visitedDocs, results);
            }
        }
        return results.length > 0 ? results : undefined;
    }

    /**
     * Transforms a Container AST node into JSON format, including nested components
     * and relationships. Components may have inline group properties merged with
     * their parent group path.
     */
    private transformContainer(container: Container) {
        const result: any = {
                id: this.getId(container),
                name: this.substitute(container.name),
                description: this.description(container),
                documentation: {},
                group: this.extractGroup(container),
                tags: this.extractTags(container, 'Element', 'Container'),
                technology: this.technology(container),
                url: this.url(container),
            components: this.onlyIfNotEmpty(this.collectNested(container, isComponent)?.map(comp => {
                // Get base group path (e.g., "a-api.jar")
                let compGroup = this.extractGroup(comp);
                // Extract inline GroupProperty from grammar
                const groupProperty = comp.groupProps?.at(0);
                if (groupProperty?.value) {
                    const inlineGroupName = C4Utils.stripQuotes(groupProperty.value);
                    if (inlineGroupName) {
                        // Merge external group path with inline group property
                        compGroup = compGroup ? `${compGroup}/${inlineGroupName}` : inlineGroupName;
                    }
                }
                const compResult: any = {
                id: this.getId(comp),
                    name: this.substitute(comp.name),
                    description: this.description(comp),
                    documentation: {},
                    technology: this.technology(comp),
                    group: compGroup || undefined,
                    tags: this.extractTags(comp, 'Element', 'Component'),
                    url: this.url(comp),
                    relationships: this.onlyIfNotEmpty(this.relationshipsOwnedBy(comp).map(el => this.relationshipToJson(el)))
                };
                this.applyElementOverlay(compResult, comp);
                this.applyElementExtensions(compResult, comp);
                return compResult;
            })),
            relationships: this.onlyIfNotEmpty(this.relationshipsOwnedBy(container).map(el => this.relationshipToJson(el)))
        };
        this.applyElementOverlay(result, container);
        this.applyElementExtensions(result, container);
        return result;
    }

    /** Extracts CustomElement nodes into JSON format with their relationships. */
    private extractCustomElements() {
        const customElements = this.elements
            .filter(isCustomElement)
            .map(ce => {
                const result: any = {
                    id: this.getId(ce),
                    name: this.substitute(ce.name),
                    group: this.extractGroup(ce),
                    description: this.description(ce),
                    metadata: this.metadata(ce),
                    relationships: this.onlyIfNotEmpty(this.relationshipsOwnedBy(ce).map(el => this.relationshipToJson(el))),
                    tags: this.extractTags(ce, 'Element'),
                    url: this.url(ce)
                };
                this.applyElementOverlay(result, ce);
                return result;
            });

        return customElements.length > 0 ? customElements : undefined;
    }

    /**
     * Builds the JSON representation of all SoftwareSystem elements in the model.
     * Each system includes:
     * - Basic properties (id, name, description, group, tags)
     * - Nested containers (recursively transformed via transformContainer)
     * - All relationships (direct + implied) extracted via extractRelationshipsForSoftwareSystem
     */
    private extractSystems() {
        const systems = this.elements.filter(isSoftwareSystem)
            .map(s => {
                const result: any = {
                    id: this.getId(s),
                    name: this.substitute(s.name),
                    description: this.description(s),
                    documentation: {},
                    group: this.extractGroup(s),
                    tags: this.extractTags(s, 'Element', 'Software System'),
                    url: this.url(s),
                    containers: this.onlyIfNotEmpty(this.collectNested(s, isContainer)?.map(c => this.transformContainer(c))),
                    relationships: this.onlyIfNotEmpty(this.relationshipsOwnedBy(s).map(el => this.relationshipToJson(el)))
                };
                this.applyElementOverlay(result, s);
                this.applyElementExtensions(result, s);
                return result;
            });
        return systems.length > 0 ? systems : undefined;
    }

    /**
     * Helper method: if a Group is passed, recursively collects all NamedElement children
     * inside it including elements from !include directives. If a non-group NamedElement
     * is passed, adds it directly to the result set.
     */
    private collectLeafElements(element: NamedElement, result: Set<NamedElement>, visited: Set<string> = new Set()) {
        if (isGroup(element)) {
            // Process direct children of the group
            element.elements.forEach(child => this.collectLeafElements(child, result, visited));
            
            // Process !include directives within the group
            for (const inc of element.includes) {
                if (!inc.file) continue;
                const root = this.resolveIncludedRoot(element, inc.file);
                if (root) {
                    const docUri = AstUtils.getDocument(root)?.uri.toString();
                    if (docUri && visited.has(docUri)) continue;
                    if (docUri) visited.add(docUri);
                    // Recursively traverse all contents of the included file
                    AstUtils.streamAllContents(root).forEach(child => {
                        if (isNamedElement(child) && !isGroup(child) && !isRelationship(child) && !isImplicitRelationship(child)) {
                            result.add(child);
                        }
                    });
                }
            }
        } else {
            // Normalise to the materialised element.
            result.add(this.el(element));
        }
    }

    /**
     * Leaf elements of a group, memoized. The expansion is a pure function of the AST,
     * so a group referenced by several view expressions is expanded once instead of
     * re-walking its subtree (and its includes) for every reference.
     */
    private groupLeafElementsCache = new Map<Group, NamedElement[]>();
    private leafElementsOfGroup(group: Group): NamedElement[] {
        const cached = this.groupLeafElementsCache.get(group);
        if (cached !== undefined) return cached;
        const result = new Set<NamedElement>();
        this.collectLeafElements(group, result);
        const leaves = [...result];
        this.groupLeafElementsCache.set(group, leaves);
        return leaves;
    }

    /**
     * Deployment targets (environments, nodes and groups) of a document, indexed by
     * their declared id and, for environments/nodes, by canonical name. Built once per
     * document so resolving `!element <id>` references does not re-scan the whole
     * document for every extension.
     */
    private deploymentTargetsByDocCache = new Map<string, { byId: Map<string, AstNode>; byCanonical: Map<string, NamedElement> }>();
    private deploymentTargetsForDoc(docUri: string, root: AstNode): { byId: Map<string, AstNode>; byCanonical: Map<string, NamedElement> } {
        const cached = this.deploymentTargetsByDocCache.get(docUri);
        if (cached !== undefined) return cached;
        const byId = new Map<string, AstNode>();
        const byCanonical = new Map<string, NamedElement>();
        for (const content of AstUtils.streamAllContents(root)) {
            const isTarget = isDeploymentEnvironment(content) || isDeploymentNode(content);
            if (isTarget || isGroup(content)) {
                const id = this.elementId(content);
                if (id && !byId.has(id)) byId.set(id, content);
            }
            if (isTarget) {
                const canonical = this.canonicalName(content);
                if (canonical && !byCanonical.has(canonical)) byCanonical.set(canonical, content);
            }
        }
        const entry = { byId, byCanonical };
        this.deploymentTargetsByDocCache.set(docUri, entry);
        return entry;
    }

    /** Collected elements indexed by canonical name, built once. */
    private elementsByCanonicalNameCache?: Map<string, NamedElement>;
    private elementsByCanonicalName(): Map<string, NamedElement> {
        if (!this.elementsByCanonicalNameCache) {
            const index = new Map<string, NamedElement>();
            for (const el of this.elements) {
                const canonical = this.canonicalName(el);
                if (canonical && !index.has(canonical)) index.set(canonical, el);
            }
            this.elementsByCanonicalNameCache = index;
        }
        return this.elementsByCanonicalNameCache;
    }
    
    /**
     * Transforms a DeploymentNode AST node into its JSON representation.
     * Recursively processes children, infrastructure nodes, software system instances,
     * container instances, and relationships. Each sub-element gets overlay modifications
     * applied from !elements directives.
     */
    private transformDeploymentNode(node: DeploymentNode): any {
        const jsonNode: any = {
            id: this.getId(node),
            name: this.substitute(node.name),
            group: this.extractGroup(node),
            tags: this.extractTags(node, 'Element', 'Deployment Node'),
            description: this.description(node),
            technology: this.technology(node),
            url: this.url(node),
            environment: this.getEnvironment(node),
            instances: String(node.instances || "1"),
            deploymentGroups: this.deploymentGroupNames(node),
            // Find nested child deployment nodes (traversing through groups)
            children: this.onlyIfNotEmpty(this.collectNested(node, isDeploymentNode)?.map(child => {
                const childJson = this.transformDeploymentNode(child);
                this.applyElementOverlay(childJson, child);
                return childJson;
            })),
            // Find infrastructure nodes (traversing through groups)
            infrastructureNodes: this.onlyIfNotEmpty(this.collectNested(node, isInfrastructureNode)?.map(infra => this.infrastructureNodeToJson(infra))),
            // Find software system instances (traversing through groups)
            softwareSystemInstances: this.onlyIfNotEmpty(this.collectNested(node, isSoftwareSystemInstance)?.
            filter((ssi): ssi is typeof ssi & { softwareSystem: { ref: NonNullable<typeof ssi.softwareSystem.ref> } } => ssi.softwareSystem.ref !== undefined).
            map(ssi => this.softwareSystemInstanceToJson(ssi))),
            
            // Find container instances (traversing through groups)
            containerInstances: this.onlyIfNotEmpty(this.collectNested(node, isContainerInstance)?.
            filter((ci): ci is typeof ci & { container: { ref: NonNullable<typeof ci.container.ref> } } => ci.container.ref !== undefined).map(ci => this.containerInstanceToJson(ci))),
            
            relationships: this.onlyIfNotEmpty(this.extractRelationshipsForDeploymentNode(node).map(el => this.relationshipToJson(el)))
        };
        this.applyElementOverlay(jsonNode, node);
        this.applyElementExtensions(jsonNode, node);
        return jsonNode;
    }

    /** Transforms an InfrastructureNode AST node into its deployment JSON entry. */
    private infrastructureNodeToJson(infra: InfrastructureNode): any {
        const infraJson: any = {
            id: this.getId(infra),
            name: this.substitute(infra.name),
            group: this.extractGroup(infra),
            tags: this.extractTags(infra, 'Element', 'Infrastructure Node'),
            description: this.description(infra),
            technology: this.technology(infra),
            url: this.url(infra),
            environment: this.getEnvironment(infra),
            relationships: this.onlyIfNotEmpty(this.extractRelationshipsForInfrastructureNode(infra).map(el => this.relationshipToJson(el)))
        };
        this.applyElementOverlay(infraJson, infra);
        this.applyElementExtensions(infraJson, infra);
        return infraJson;
    }

    /** Transforms a SoftwareSystemInstance AST node into its deployment JSON entry. */
    private softwareSystemInstanceToJson(ssi: SoftwareSystemInstance): any {
        const ssiJson: any = {
            id: this.getId(ssi),
            instanceId: this.instanceId(ssi),
            group: this.extractGroup(ssi),
            tags: this.extractTags(ssi, 'Software System Instance'),
            url: this.url(ssi),
            deploymentGroups: this.onlyIfNotEmpty(this.directDeploymentGroupNames(ssi)),
            softwareSystemId: this.getId(ssi.softwareSystem.ref),
            environment: this.getEnvironment(ssi),
            relationships: this.onlyIfNotEmpty(this.extractRelationshipsForSoftwareSystemInstance(ssi).map(el => this.relationshipToJson(el)))
        };
        this.applyElementOverlay(ssiJson, ssi);
        this.applyElementExtensions(ssiJson, ssi);
        return ssiJson;
    }

    /** Transforms a ContainerInstance AST node into its deployment JSON entry. */
    private containerInstanceToJson(ci: ContainerInstance): any {
        const ciJson: any = {
            id: this.getId(ci),
            containerId: this.getId(ci.container.ref),
            instanceId: this.instanceId(ci),
            environment: this.getEnvironment(ci),
            group: this.extractGroup(ci),
            tags: this.extractTags(ci, 'Container Instance'),
            url: this.url(ci),
            deploymentGroups: this.onlyIfNotEmpty(this.directDeploymentGroupNames(ci)),
            relationships: this.onlyIfNotEmpty(this.extractRelationshipsForContainerInstance(ci).map(el => this.relationshipToJson(el))),
            parentId: this.getId(this.resolveDeploymentNodeParent(ci))
        };
        this.applyElementOverlay(ciJson, ci);
        this.applyElementExtensions(ciJson, ci);
        return ciJson;
    }

    /**
     * Resolves the parent DeploymentNode for a given AST node by climbing
     * up the $container chain.
     * 
     * If the node is defined inline inside a DeploymentNode block,
     * the first DeploymentNode found via $container is returned.
     * 
     * If the node is defined in an !include file, $container points
     * to the root of the included document, not to the logical parent.
     * In that case, the method looks up the Include directive that
     * references the included file and climbs from there.
     * 
     * @param node The AST node whose parent DeploymentNode to find (e.g. InfrastructureNode, ContainerInstance, nested DeploymentNode)
     * @returns The parent DeploymentNode, or undefined if the node is root-level
     */
    private resolveDeploymentNodeParent(node: AstNode): DeploymentNode | undefined {
        // first, try climbing the direct AST $container chain (works for inline nodes)
        let current: AstNode | undefined = node.$container;
        while (current) {
            if (isDeploymentNode(current)) {
                return current;
            }
            if (isElementExtension(current)) {
                // A deployment node declared inside an `!element` block is nested
                // under the extended element, not under the ElementExtension directive.
                const target = this.resolveElementExtensionTarget(current);
                return target && isDeploymentNode(target) ? target : undefined;
            }
            current = current.$container;
        }
        
        // fallback for !include files: the node's $container points to the
        // root of the included document.  Look up the Include directive
        // that references this file and climb from there.
        const docUri = AstUtils.getDocument(node)?.uri.toString();
        if (docUri) {
            const includes = this.includeContexts.get(docUri);
            if (includes && includes.length > 0) {
                for (const includeDirective of includes) {
                    current = includeDirective.$container;
                    while (current) {
                        if (isDeploymentNode(current)) {
                            return current;
                        }
                        current = current.$container;
                    }
                }
            }
        }
        
        return undefined;
    }

    /**
     * Determines whether the given DeploymentNode is a root-level node within its deployment environment.
     *
     * A node is considered root if no other DeploymentNode is found when climbing up
     * the AST $container chain. The method first attempts direct AST traversal, then
     * falls back to include context resolution for nodes defined in !include files.
     *
     * For !include files: the node's $container points to the root of the included document
     * rather than the logical parent. The method looks up the Include directive context
     * and climbs from there to find the actual parent DeploymentNode.
     *
     * @param node The DeploymentNode to check
     * @returns true if this is a root-level node (no parent DeploymentNode exists)
     */
    private isRootDeploymentNode(node: DeploymentNode): boolean {
        let current: AstNode | undefined = node.$container;
        while (current) {
            // If another DeploymentNode is found above, this node is a child
            if (isDeploymentNode(current)) {
                return false;
            }
            // If we reached a DeploymentEnvironment block without finding another DeploymentNode, this is root
            if (isDeploymentEnvironment(current)) {
                return true;
            }
            // A node contributed by `!element` is nested under the extended element:
            // it is a root node only when that element is a deployment environment.
            if (isElementExtension(current)) {
                return isDeploymentEnvironment(this.resolveElementExtensionTarget(current));
            }
            // Continue climbing up (passing through groups or other intermediate AST containers)
            current = current.$container;
        }
        
        // Fallback for !include files
        const docUri = AstUtils.getDocument(node)?.uri.toString();
        if (docUri) {
            const includes = this.includeContexts.get(docUri);
            if (includes && includes.length > 0) {
                for (const includeDirective of includes) {
                    current = includeDirective.$container;
                    while (current) {
                        if (isDeploymentNode(current)) {
                            return false; // parent DeploymentNode found
                        }
                        if (isDeploymentEnvironment(current)) {
                            return true; // root in this environment
                        }
                        current = current.$container;
                    }
                }
            }
        }
        
        // If chain was broken (e.g. node declared at document root), consider it root
        return true;
    }
    
    /**
     * Extracts all root-level DeploymentNode elements from the model and transforms them
     * into JSON format. Only nodes whose parent is NOT another DeploymentNode are included,
     * ensuring that only the top-level deployment branches are represented.
     * Each root node carries its computed environment and group path.
     */
    private extractAllRootDeploymentNodes(): any[] | undefined{
        const deploymentNodes = this.elements
            .filter((el): el is DeploymentNode => isDeploymentNode(el) && this.isRootDeploymentNode(el))
            .map(rootNode => {
                const jsonNode = this.transformDeploymentNode(rootNode);
                jsonNode.environment = this.getEnvironment(rootNode);
                jsonNode.group = this.extractGroup(rootNode) || undefined;
                return jsonNode;
            });

        return deploymentNodes.length > 0 ? deploymentNodes : undefined;
    }

    /**
     * Extracts image views. A `plantuml` source is encoded into the PlantUML server
     * URL the renderer loads; an `image` source is used as-is. Light and dark
     * scheme blocks populate `contentLight`/`contentDark`.
     */
    private extractImageViews(workspace: Workspace) {
        const views = this.workspaceViews(workspace).filter(isImageView);
        if (views.length === 0) return undefined;

        const list = views.map(view => {
            const json: any = {
                key: this.substitute(view.key) ?? this.services.workspace.ViewKeyProvider.getKey(view),
                ...this.viewOrderFields(view),
                elementId: view.element?.ref ? this.getId(this.el(view.element.ref)) : undefined,
                title: this.substitute(view.titleProps?.at(0)?.value),
                description: this.description(view),
                properties: this.viewProperties(view)
            };

            const content = this.resolveImageSources(view.sources, view);
            if (content) {
                json.content = content.content;
                json.contentType = content.contentType;
                if (content.title) json.title = content.title;
            }
            const light = this.resolveImageSources(view.lightBlocks?.flatMap(block => block.sources ?? []), view);
            if (light) {
                json.contentLight = light.content;
                json.contentType = light.contentType ?? json.contentType;
            }
            const dark = this.resolveImageSources(view.darkBlocks?.flatMap(block => block.sources ?? []), view);
            if (dark) {
                json.contentDark = dark.content;
                json.contentType = dark.contentType ?? json.contentType;
            }
            return json;
        });

        return list;
    }

    /** Resolves the first supported source of an image view to content and content type. */
    private resolveImageSources(sources: any[] | undefined, view: any): { content?: string; contentType?: string; title?: string } | undefined {
        for (const source of sources ?? []) {
            if (isPlantUMLSource(source)) {
                const text = this.diagramSourceText(source.value);
                const server = this.viewProperty(view, 'plantuml.url') ?? '';
                const format = (this.viewProperty(view, 'plantuml.format') ?? 'svg').toLowerCase();
                return {
                    content: `${server}/${format}/${encodePlantUml(text)}`,
                    contentType: format === 'png' ? 'image/png' : 'image/svg+xml',
                    title: this.plantUmlTitle(text)
                };
            }
            if (isImageSource(source)) {
                const value = this.diagramSourceText(source.value);
                return { content: value, contentType: this.imageContentType(value) };
            }
        }
        return undefined;
    }

    /** Text of a diagram source: text blocks are normalised, then constants substituted. */
    private diagramSourceText(raw: string | undefined): string {
        if (raw === undefined) return '';
        const text = raw.trimStart().startsWith('"""') ? C4Utils.textBlockValue(raw) : C4Utils.stripQuotes(raw);
        return text.replace(/\$\{([^}]+)\}/g, (match, name) => this.constants.get(name) ?? match);
    }

    /** Title declared by a `title ...` line inside a PlantUML definition. */
    private plantUmlTitle(source: string): string | undefined {
        for (const line of source.split('\n')) {
            if (!line.startsWith('title ')) continue;
            let title = line.substring('title '.length);
            if (title.startsWith('<size:')) {
                title = title.substring(title.indexOf('>') + 1);
                if (title.endsWith('</size>')) title = title.substring(0, title.indexOf('</size>'));
            }
            return title;
        }
        return undefined;
    }

    /** Content type of an image referenced by URL or path. */
    private imageContentType(source: string): string {
        const extension = source.split('?')[0].split('.').pop()?.toLowerCase();
        if (extension === 'svg') return 'image/svg+xml';
        if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg';
        if (extension === 'gif') return 'image/gif';
        return 'image/png';
    }

    /** Properties declared inside a view block, or undefined when the view has none. */
    private viewProperties(view: any): Record<string, string> | undefined {
        const properties: Record<string, string> = {};
        for (const block of view.properties ?? []) {
            for (const item of block?.items ?? []) {
                const name = C4Utils.stripQuotes(String(item?.name ?? ''));
                if (name) properties[name] = C4Utils.stripQuotes(String(item?.value ?? ''));
            }
        }
        return Object.keys(properties).length > 0 ? properties : undefined;
    }

    /** A view property, falling back to the views block properties. */
    private viewProperty(view: any, name: string): string | undefined {
        for (const block of view.properties ?? []) {
            for (const item of block?.items ?? []) {
                if (C4Utils.stripQuotes(String(item?.name ?? '')) === name) {
                    return C4Utils.stripQuotes(String(item?.value ?? ''));
                }
            }
        }
        return this.propertiesViews[name];
    }

    /**
     * Internal padding (points) of a graphviz cluster: the view property wins over the
     * views block property, and both default to 25.
     */
    private dotClusterPadding(view: any, name: string): number {
        const value = this.viewProperty(view, name);
        const parsed = value !== undefined ? Number.parseInt(value, 10) : Number.NaN;
        return Number.isFinite(parsed) ? parsed : 25;
    }

    /**
     * Extracts custom views from the workspace and resolves their elements and relationships.
     * Each custom view includes a key, title, description, element/relationship references,
     * and automatic layout settings.
     */
    private extractCustomViews(workspace: Workspace) {
        const views = this.workspaceViews(workspace).filter(view => isCustomView(view))
            .map(view => {
                const elements = new Set<RelationshipMember>();
                const relationships = new Set<Relationship>();
                this.resolveCustom(view, elements, relationships);
                return {
                    name: this.viewName(view),
                    key: this.substitute(this.services.workspace.ViewKeyProvider.getKey(view)),
                    ...this.viewOrderFields(view),
                    title: this.substitute(view.titleProps?.at(0)?.value),
                    description: this.description(view),
                    properties: this.viewProperties(view),
                    elements: this.onlyIfNotEmpty(Array.from(elements).map(el => this.elementJson(el))),
                    relationships: this.onlyIfNotEmpty(Array.from(relationships).map(rel => this.relationshipViewJson(rel))),
                    automaticLayout: this.transformAutoLayout(view),
                    // Transient: consumed by applyGraphvizAutoLayouts in the plugin.
                    ...this.graphvizFields(view, this.transformAutoLayout(view), undefined, false, elements, relationships),
                    animations: this.resolveAnimations(view, elements, relationships, 'custom'),
                };
            });
        return views && views.length > 0 ? views : undefined;
    }

    /**
     * Extracts System Landscape views from the workspace, resolving all elements
     * and relationships visible at the landscape level (all elements in the model).
     */
    private extractSystemLandscapeViews(workspace: Workspace, model: any) {
        const views = this.workspaceViews(workspace).filter(view => isSystemLandscapeView(view))
            .map(view => {
                const elements = new Set<RelationshipMember>();
                const relationships = new Set<Relationship>();
                this.resolveSystemLandscape(view, elements, relationships);
                return {
                    name: this.viewName(view),
                    key: this.substitute(this.services.workspace.ViewKeyProvider.getKey(view)),
                    ...this.viewOrderFields(view),
                    title: this.substitute(view.titleProps?.at(0)?.value),
                    description: this.description(view),
                    properties: this.viewProperties(view),
                    elements: this.onlyIfNotEmpty(Array.from(elements).map(el => this.elementJson(el))),
                    relationships: this.onlyIfNotEmpty(Array.from(relationships).map(rel => this.relationshipViewJson(rel))),
                    enterpriseBoundaryVisible: true,
                    automaticLayout: this.transformAutoLayout(view),
                    // Transient: consumed by applyGraphvizAutoLayouts in the plugin.
                    ...this.graphvizFields(view, this.transformAutoLayout(view), undefined, false, elements, relationships),
                    animations: this.resolveAnimations(view, elements, relationships, 'static'),
                };
            });
        return views && views.length > 0 ? views : undefined;
    }

    /**
     * Transforms autolayout settings from the DSL AST into a Structurizr-compatible JSON format.
     *
     * The output format matches the Structurizr Java library output exactly:
     * - applied: false (the renderer calculates positions on load)
     * - implementation: "Graphviz" (default layout algorithm)
     * - rankDirection: mapped from DSL direction (TopBottom, LeftRight, etc.)
     * - rankSeparation / nodeSeparation: distances between elements
     * - edgeSeparation: distance between parallel relationship lines
     * - vertices: true (reset line breakpoints for straight lines with auto-layout)
     *
     * Returns undefined if no autolayout keyword is present in the DSL view.
     */
    /**
     * The workspace `configuration` block: the scope and visibility. The users block
     * is not included, because its body is parsed as opaque text.
     */
    private workspaceConfiguration(workspace: Workspace): any {
        const configuration: any = {};
        for (const block of workspace.configurationBlocks ?? []) {
            for (const scope of block.scopeProps ?? []) {
                const value = String(scope.value ?? '').toLowerCase();
                if (value === 'landscape') configuration.scope = 'Landscape';
                else if (value === 'softwaresystem') configuration.scope = 'SoftwareSystem';
                else delete configuration.scope; // scope none
            }
            for (const visibility of block.visibilityProps ?? []) {
                const value = String(visibility.value ?? '').toLowerCase();
                if (value === 'private') configuration.visibility = 'Private';
                else if (value === 'public') configuration.visibility = 'Public';
            }
        }
        return configuration;
    }

    private transformAutoLayout(view: any): any {
        const autoLayout = view.autoLayoutProps?.[0];
        const direction = this.mapDirection(autoLayout?.direction);
        return {
            applied: false,
            implementation: "Graphviz",
            rankDirection: direction,
            // Defaults: rankSeparation and nodeSeparation both default to 300px,
            // and the rank direction defaults to TopBottom.
            rankSeparation: autoLayout?.rankSeparation ?? 300,
            nodeSeparation: autoLayout?.nodeSeparation ?? 300,
            edgeSeparation: 50,
            vertices: true
        };
    }


    /**
     * Builds a Graphviz DOT graph for a view. Groups, deployment nodes and the
     * scope frame become nested `subgraph cluster_*` blocks so Graphviz packs
     * their children together; edges carry no labels (the webview draws the
     * description at the relationship midpoint).
     */
    /**
     * DOT graph of a view plus the texts the renderer will measure to size its frames.
     * Both are transient fields on the view object: applyGraphvizAutoLayouts consumes
     * them for the first layout and keeps them for the text measurement pass.
     */
    private graphvizFields(
        view: any,
        autoLayout: any,
        scopeElement: NamedElement | undefined,
        scopeAsFrame: boolean,
        elements: Iterable<any>,
        relationships: Iterable<any>,
        isDynamic = false
    ): { graphviz?: string; textMeasurements?: ViewTextMeasurements } {
        const viewKey = this.substitute(this.services.workspace.ViewKeyProvider.getKey(view)) ?? '';
        const built = this.buildGraphvizDot(autoLayout, view, viewKey, scopeElement, scopeAsFrame, elements, relationships, isDynamic);
        return built ? { graphviz: built.dot, textMeasurements: built.measurements } : {};
    }

    private buildGraphvizDot(
        autoLayout: any,
        viewNode: any,
        viewKey: string,
        scopeElement: NamedElement | undefined,
        scopeAsFrame: boolean,
        elements: Iterable<any>,
        relationships: Iterable<any>,
        isDynamic = false
    ): { dot: string; measurements: ViewTextMeasurements } | undefined {
        if (!autoLayout) return undefined;

        // DOT graph structure: header, cluster margin=25, node sizes in a
        // 300dpi inch space, and id= attributes. Identifiers are ours - they do
        // not affect the layout.
        const STRUCTURIZR_DPI = 300; // Structurizr diagrams are sized for 300dpi
        const dir = this.mapGraphvizDirection(autoLayout.rankDirection);
        const rankdir = dir === 'UP' ? 'BT' : dir === 'LEFT' ? 'RL' : dir === 'RIGHT' ? 'LR' : 'TB';
        // Whole inches render as "1.0" rather than "1" (purely cosmetic -
        // same value).
        const fmtIn = (v: number) => (Number.isInteger(v) ? `${v}.0` : String(v));
        const ranksep = fmtIn(autoLayout.rankSeparation / STRUCTURIZR_DPI); // inches
        const nodesep = fmtIn(autoLayout.nodeSeparation / STRUCTURIZR_DPI);
        // Cluster internal padding, in points: a view property overrides the viewset
        // (views block) property, which overrides the default of 25.
        const groupPadding = this.dotClusterPadding(viewNode, 'structurizr.groupPadding');
        const boundaryPadding = this.dotClusterPadding(viewNode, 'structurizr.boundaryPadding');
        const deploymentPadding = this.dotClusterPadding(viewNode, 'structurizr.deploymentNodePadding');
        const clusterPadding = (clusterId: string): number => {
            if (clusterId.startsWith('cluster_deploy_')) return deploymentPadding;
            if (clusterId.startsWith('cluster_group_')) return groupPadding;
            return boundaryPadding;
        };
        const q = (s: string) => '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
        // Our identifiers are alphanumeric + underscore - safe unquoted like the
        // reference's numeric ids. Anything else is quoted.
        const idToken = (s: string) => (/^[A-Za-z_][A-Za-z0-9_]*$/.test(s) ? s : q(s));

        // Cluster tree: clusterId -> list of children (element ids / sub-cluster ids).
        const childrenOf: Record<string, string[]> = {};
        const owningCluster: Record<string, string> = {}; // element id -> owning cluster id
        const clusterKind: Record<string, 'scope' | 'group' | 'deploy'> = {};
        const getChildren = (id: string): string[] => (childrenOf[id] ||= []);
        const addChild = (parent: string, child: string) => {
            owningCluster[child] = parent;
            getChildren(parent).push(child);
        };

        // Texts the renderer draws inside each frame and measures to size it. Every
        // frame shows a name; element frames also show a metadata line.
        const candidates: TextMeasurementCandidate[] = [];
        const clusters: Record<string, string[]> = {};
        const nodeWidths: Record<string, number> = {};
        const addElementTexts = (clusterId: string, element: NamedElement, withTechnology = false) => {
            const elementId = this.getId(element);
            const nameKey = `${viewKey}|${clusterId}|name`;
            const metadataKey = `${viewKey}|${clusterId}|metadata`;
            clusters[clusterId] = [nameKey, metadataKey];
            candidates.push({ key: nameKey, kind: 'element-name', elementId });
            candidates.push({ key: metadataKey, kind: 'element-metadata', elementId, withTechnology });
        };
        const addGroupText = (clusterId: string, groupName: string) => {
            const key = `${viewKey}|${clusterId}|group`;
            clusters[clusterId] = [key];
            candidates.push({ key, kind: 'group-name', groupName });
        };

        // Software system and container frames. A container frame is always nested
        // inside the frame of the software system that owns it; every container that
        // frames visible elements (the scope container, and each container owning a
        // visible component) gets its own cluster.
        const ensureSystemCluster = (system: NamedElement): string => {
            const sid = 'cluster_scope_' + this.getId(system);
            if (owningCluster[sid] === undefined) {
                addChild('root', sid);
                addElementTexts(sid, system);
            }
            clusterKind[sid] = 'scope';
            return sid;
        };
        const ensureContainerCluster = (container: NamedElement): string => {
            const cid = 'cluster_scope_' + this.getId(container);
            if (owningCluster[cid] === undefined) {
                const system = this.resolveContainerParent(container as Container);
                addChild(system ? ensureSystemCluster(system) : 'root', cid);
                addElementTexts(cid, container);
            }
            clusterKind[cid] = 'scope';
            return cid;
        };
        // The webview also draws a boundary for the scope element's
        // PARENT: on a component view and a container-scoped dynamic view it renders
        // BOTH the container boundary and the enclosing software system boundary.
        // The DOT export emits both clusters (cluster_<systemId> wrapping
        // cluster_<containerId>), so replicate that here - otherwise the webview-drawn
        // system frame is missing from the graphviz bounds, the paper/centring does
        // not account for it, and the rendered diagram is offset by a per-diagram amount.
        // The webview computes the frame size in reposition(): embedded content plus
        // clusterPadding (50) on each side plus the name/metadata footer at the bottom;
        // graphviz's cluster margin (25pt = 104px) covers that padding, so emitting the
        // cluster is sufficient to reserve the space.
        const scopeClusterId = !scopeElement || !scopeAsFrame
            ? undefined
            : isContainer(scopeElement) ? ensureContainerCluster(scopeElement) : ensureSystemCluster(scopeElement);
        let scopeSystemId: string | undefined;
        let scopeSystemClusterId: string | undefined;
        if (scopeClusterId && isContainer(scopeElement)) {
            const scopeSystem = this.resolveContainerParent(scopeElement);
            if (scopeSystem) {
                scopeSystemId = this.getId(scopeSystem);
                scopeSystemClusterId = ensureSystemCluster(scopeSystem);
            }
        }

        // Creates a (possibly nested) group cluster under `parent` and returns its id.
        // The path is split on the workspace's group separator (`structurizr.groupSeparator`),
        // the same one used to build the path, so custom separators nest correctly.
        const groupSeparator = this.groupSeparator && this.groupSeparator.length > 0 ? this.groupSeparator : undefined;
        const ensureGroupCluster = (groupPath: string, parent: string | undefined): string => {
            let current = parent;
            const segments = groupSeparator ? groupPath.split(groupSeparator) : [groupPath];
            for (const seg of segments.filter(s => s.length > 0)) {
                const cid = 'cluster_group_' + (current ?? 'root') + '_' + seg;
                if (owningCluster[cid] === undefined) {
                    addChild(current ?? 'root', cid);
                    addGroupText(cid, seg);
                }
                clusterKind[cid] = 'group';
                current = cid;
            }
            return current!;
        };

        // Deployment nodes become clusters BEFORE leaves attach. The view's element
        // list is not in tree order (children can precede their parent), so register
        // every cluster first and only then attach it to its parent's cluster.
        const deployCluster: Record<string, string> = {};
        const deployParent: Record<string, string | undefined> = {};
        for (const el of elements) {
            if (!this.isCompound(el)) continue;
            const id = this.getId(el);
            const cid = 'cluster_deploy_' + id;
            deployCluster[id] = cid;
            clusterKind[cid] = 'deploy';
            deployParent[cid] = this.resolveFrameParentId(el, scopeElement);
            addElementTexts(cid, el, true);
        }
        for (const el of elements) {
            if (!this.isCompound(el)) continue;
            const cid = deployCluster[this.getId(el)];
            const parentEl = deployParent[cid];
            const base = parentEl !== undefined ? deployCluster[parentEl] : scopeClusterId;
            const group = this.extractGroup(el);
            const gid = group && group.length > 0 ? ensureGroupCluster(group, base) : undefined;
            addChild(gid ?? base ?? 'root', cid);
        }

        // Sizes (in inches at 300dpi) and cluster assignment for the elements that are
        // rendered as nodes (compound elements become clusters instead).
        const sizes: Record<string, { w: string; h: string }> = {};
        // deployment node id -> a representative inner instance, so edges that
        // reference a deployment node are projected onto its content (like the
        // reference's findElementInside).
        const innerOf: Record<string, string> = {};
        for (const el of elements) {
            const id = this.getId(el);
            if (this.isCompound(el)) continue; // rendered as a cluster
            const size = this.defaultElementSize(el);
            // Nodes carry no label: Graphviz only needs the box, and measuring the
            // text of every node is a measurable share of the layout time.
            sizes[id] = {
                w: (size.width / STRUCTURIZR_DPI).toFixed(6),
                h: (size.height / STRUCTURIZR_DPI).toFixed(6)
            };
            nodeWidths[id] = size.width;
            const frameParent = this.resolveFrameParent(el, scopeElement);
            const base = frameParent ? this.getId(frameParent) : undefined;
            const scopeId = scopeElement ? this.getId(scopeElement) : undefined;
            // A direct child of the scope frame (container/component) goes inside
            // the scope cluster; a component goes inside the frame of its own
            // container (and that container's software system); a child of a
            // deployment node goes inside that deployment cluster; anything else
            // (external element) is a root node.
            let baseCluster: string | undefined;
            if (scopeAsFrame && base !== undefined && base === scopeId) {
                baseCluster = scopeClusterId;
            } else if (base !== undefined && deployCluster[base] !== undefined) {
                baseCluster = deployCluster[base];
            } else if (frameParent !== undefined && isContainer(frameParent)) {
                baseCluster = ensureContainerCluster(frameParent);
            }
            // A standalone container that belongs to the scope's software system is
            // written inside the enclosing system boundary (same-system
            // containers go into the system boundary cluster).
            if (baseCluster === undefined && scopeSystemClusterId !== undefined && isContainer(el)) {
                const sys = this.resolveContainerParent(el);
                if (sys && this.getId(sys) === scopeSystemId) {
                    baseCluster = scopeSystemClusterId;
                }
            }
            const group = this.extractGroup(el);
            // Container/component views: external (non-scope) elements are written
            // as plain nodes without group clusters - grouped elements inside a
            // frame (the scope frame or their own container frame) keep them.
            const framed = baseCluster === scopeClusterId || (frameParent !== undefined && isContainer(frameParent));
            const inScope = scopeAsFrame ? framed : true;
            const gid = group && group.length > 0 && inScope ? ensureGroupCluster(group, baseCluster) : undefined;
            addChild(gid ?? baseCluster ?? 'root', id);
        }

        // Representative inner element per deployment node, so that an edge referencing
        // the node is projected onto its content. The reference prefers direct software
        // system instances, then container instances, then infrastructure nodes, and
        // only then recurses into child deployment nodes.
        const deployChildren: Record<string, string[]> = {};
        const deployDirect: Record<string, Array<{ rank: number; id: string }>> = {};
        for (const el of elements) {
            const id = this.getId(el);
            if (this.isCompound(el)) {
                const parent = this.resolveDeploymentNodeParent(el);
                const pid = parent ? this.getId(parent) : undefined;
                if (pid !== undefined && deployCluster[pid] !== undefined) (deployChildren[pid] ||= []).push(id);
                continue;
            }
            const rank = isSoftwareSystemInstance(el) ? 0 : isContainerInstance(el) ? 1 : isInfrastructureNode(el) ? 2 : -1;
            if (rank < 0) continue;
            const parent = this.resolveDeploymentNodeParent(el);
            const pid = parent ? this.getId(parent) : undefined;
            if (pid !== undefined && deployCluster[pid] !== undefined) (deployDirect[pid] ||= []).push({ rank, id });
        }
        const findElementInside = (nodeId: string): string | undefined => {
            const direct = deployDirect[nodeId];
            if (direct) {
                for (const rank of [0, 1, 2]) {
                    const found = direct.find(candidate => candidate.rank === rank);
                    if (found) return found.id;
                }
            }
            for (const childId of deployChildren[nodeId] ?? []) {
                const inner = findElementInside(childId);
                if (inner !== undefined) return inner;
            }
            return undefined;
        };
        for (const nodeId of Object.keys(deployCluster)) {
            const inner = findElementInside(nodeId);
            if (inner !== undefined) innerOf[nodeId] = inner;
        }

        const header: string[] = [];
        header.push('digraph {');
        header.push('  compound=true');
        header.push(`  graph [splines=polyline,rankdir=${rankdir},ranksep=${ranksep},nodesep=${nodesep},fontsize=5]`);
        header.push('  node [shape=box,fontsize=5]');
        header.push('  edge []');
        header.push('');
        const lines: string[] = [];

        const emitNode = (id: string, indent: string) => {
            const s = sizes[id];
            if (s === undefined) throw new Error(`graphviz export: no size for element ${id}`);
            lines.push(`${indent}${idToken(id)} [width=${s.w},height=${s.h},fixedsize=true,id=${idToken(id)}]`);
        };
        const emitCluster = (cid: string, indent: string) => {
            const pad = indent + '  ';
            lines.push(`${indent}subgraph ${q(cid)} {`);
            lines.push(`${pad}margin=${clusterPadding(cid)}`);
            for (const child of getChildren(cid)) {
                if (child.startsWith('cluster_')) emitCluster(child, pad);
                else emitNode(child, pad);
            }
            lines.push(`${indent}}`);
        };
        // Clusters and standalone elements are emitted in a view-specific
        // order (it influences graphviz rank/placement):
        // - landscape/context (no scope frame): group clusters first, then standalone;
        // - container/component (scope frame): external elements first, then the
        //   scope boundary cluster.
        const rootClusters: string[] = [];
        const rootNodes: string[] = [];
        for (const child of getChildren('root')) {
            (child.startsWith('cluster_') ? rootClusters : rootNodes).push(child);
        }
        // Dynamic views (container scope): the scope boundary cluster is emitted
        // first, then the external elements (the opposite of container/component
        // views).
        if (scopeAsFrame && !isDynamic) {
            for (const id of rootNodes) emitNode(id, '  ');
            for (const cid of rootClusters) emitCluster(cid, '  ');
        } else {
            for (const cid of rootClusters) emitCluster(cid, '  ');
            for (const id of rootNodes) emitNode(id, '  ');
        }
        lines.push('');

        // Edges: `source -> destination [id=...]` edges (no labels).
        // Deployment-node endpoints are projected onto a
        // representative inner instance AND anchored to
        // the deployment node cluster with ltail/lhead=cluster_<deploymentNodeId>, so
        // the arrow terminates at the deployment node frame border instead of routing
        // through the frame to the inner instance (which would otherwise produce
        // misleading parallel edges). Deduplicated by (id + direction): dynamic views
        // emit forward AND response edges that share the same id.
        const seen = new Set<string>();
        // Connected components decide whether the graph is packed. Dot lays the
        // components of a disconnected graph out in one long rank, which turns a view
        // with many isolated elements into a strip; packing arranges them in a grid.
        const componentRoot = new Map<string, string>();
        for (const id of Object.keys(sizes)) componentRoot.set(id, id);
        const componentOf = (start: string): string => {
            let root = start;
            while (componentRoot.get(root) !== root) root = componentRoot.get(root)!;
            let current = start;
            while (componentRoot.get(current) !== root) {
                const next = componentRoot.get(current)!;
                componentRoot.set(current, root);
                current = next;
            }
            return root;
        };
        const joinComponents = (a: string, b: string) => {
            const rootA = componentOf(a);
            const rootB = componentOf(b);
            if (rootA !== rootB) componentRoot.set(rootB, rootA);
        };
        for (const item of relationships) {
            const relationship = item?.relationship ?? item;
            const rawSourceId = this.getId(this.resolveSource(relationship));
            const rawTargetId = this.getId(this.resolveTarget(relationship));
            // Project deployment-node endpoints onto a representative inner instance
            // (reference findElementInside); the edge id stays unchanged. A deployment
            // node with no visible content inside has no projection, and the reference
            // omits such an edge entirely.
            const sourceId = deployCluster[rawSourceId] !== undefined ? innerOf[rawSourceId] : rawSourceId;
            const targetId = deployCluster[rawTargetId] !== undefined ? innerOf[rawTargetId] : rawTargetId;
            if (sourceId === undefined || targetId === undefined) continue;
            if (sizes[sourceId] === undefined || sizes[targetId] === undefined) continue;
            joinComponents(sourceId, targetId);
            const edgeId = item?.id ?? this.getId(item);
            const dedupeKey = `${edgeId}\u0000${sourceId}\u0000${targetId}`;
            if (seen.has(dedupeKey)) continue;
            seen.add(dedupeKey);
            let clusterConfig = '';
            if (deployCluster[rawSourceId] !== undefined) clusterConfig += `,ltail=${deployCluster[rawSourceId]}`;
            if (deployCluster[rawTargetId] !== undefined) clusterConfig += `,lhead=${deployCluster[rawTargetId]}`;
            lines.push(`  ${idToken(sourceId)} -> ${idToken(targetId)} [id=${idToken(edgeId)}${clusterConfig}]`);
        }

        lines.push('}');

        // A connected graph is left to dot's own component handling, and so is a view
        // whose elements mostly form connected pieces. Only a large view that is
        // almost entirely isolated elements is packed: there dot lays the components
        // out in one long rank and the view turns into a strip. Packing arranges the
        // components in an array grid whose column count grows with the square root of
        // the component count, so the result stays close to a 16:9 shape.
        const nodeCount = Object.keys(sizes).length;
        const componentCount = new Set(Object.keys(sizes).map(componentOf)).size;
        if (nodeCount >= 50 && componentCount >= nodeCount * 0.9) {
            const columns = Math.min(64, Math.max(2, Math.round(Math.sqrt(componentCount) * 0.85)));
            const separation = Number(autoLayout.nodeSeparation) || STRUCTURIZR_DPI;
            const margin = Math.round((separation / STRUCTURIZR_DPI) * 72);
            header[2] = `  graph [splines=polyline,rankdir=${rankdir},ranksep=${ranksep},nodesep=${nodesep},fontsize=5,packmode=array${columns},pack=${margin}]`;
        }

        // Keep the frame tree so the paper can be refitted when element coordinates
        // change outside the graphviz layout (drawio import).
        this.frameTrees.set(viewKey, { childrenOf, clusterKind });
        return {
            dot: header.concat(lines).join('\n'),
            measurements: { candidates, clusters, children: childrenOf, nodeWidths }
        };
    }

    /** Resolves the frame (compound) parent id of a view element, if any. */
    private resolveFrameParentId(el: any, scopeElement: NamedElement | undefined): string | undefined {
        const parent = this.resolveFrameParent(el, scopeElement);
        return parent ? this.getId(parent) : undefined;
    }

    /** Maps a Structurizr rank direction to the graphviz rankdir code. */
    private mapGraphvizDirection(rankDirection: string | undefined): string {
        switch (rankDirection) {
            case 'LeftRight': return 'RIGHT';
            case 'RightLeft': return 'LEFT';
            case 'BottomTop': return 'UP';
            default: return 'DOWN';
        }
    }

    /**
     * Replicates structurizr.ui.findElementStyle() so the layout plans the exact size
     * the webview renders: default 450x300, Person/Robot 400x400 when no size style
     * is defined, DSL + theme style sizes merged per tag, and the shape-based cell size.
     */
    private defaultElementSize(el: NamedElement): { width: number; height: number } {
        const cached = this.elementSizeCache.get(el);
        if (cached !== undefined) return cached;
        const style = this.resolveElementStyle(el);
        const size = this.cellSizeForStyle(style.width, style.height, style.shape);
        this.elementSizeCache.set(el, size);
        return size;
    }

    /**
     * Element size per AST node: a view lays out the same element once per view it
     * appears in, and resolving the size walks the tags and merges the style map each
     * time. The map is stable for the lifetime of one generate() call.
     */
    private readonly elementSizeCache = new WeakMap<NamedElement, { width: number; height: number }>();

    /** The Structurizr default type tag for an element (e.g. "Person", "Software System"). */
    private typeTagForElement(el: NamedElement): string {
        if (isPerson(el)) return 'Person';
        if (isSoftwareSystem(el)) return 'Software System';
        if (isSoftwareSystemInstance(el)) return 'Software System Instance';
        if (isContainer(el)) return 'Container';
        if (isContainerInstance(el)) return 'Container Instance';
        if (isComponent(el)) return 'Component';
        if (isDeploymentNode(el)) return 'Deployment Node';
        if (isInfrastructureNode(el)) return 'Infrastructure Node';
        if (isCustomElement(el)) return 'Custom';
        return '';
    }

    /**
     * All tags an element matches in the webview (mirrors getAllTagsForElement):
     * "Element" + type tag + DSL tags, plus the parent element's tags for instances.
     */
    private elementTagsFor(el: NamedElement): string[] {
        const tags: string[] = [];
        const add = (t: string) => { const s = t.trim(); if (s && tags.indexOf(s) === -1) tags.push(s); };
        const base = this.extractTags(el, 'Element', this.typeTagForElement(el));
        if (base) base.split(',').forEach(add);
        // Instance elements also carry their parent element's tags.
        if (isSoftwareSystemInstance(el)) {
            const parent = el.softwareSystem?.ref;
            if (parent) {
                const pt = this.extractTags(parent, 'Element', 'Software System');
                if (pt) pt.split(',').forEach(add);
            }
        } else if (isContainerInstance(el)) {
            const parent = el.container?.ref;
            if (parent) {
                const pt = this.extractTags(parent, 'Element', 'Container');
                if (pt) pt.split(',').forEach(add);
            }
        }
        return tags;
    }

    /** Merged element style map (theme first, then workspace) keyed by tag — mirrors findElementStyle. */
    private ensureElementStyleMap(): Record<string, any> {
        if (this.elementStyleMap !== undefined) return this.elementStyleMap;
        const map: Record<string, any> = {};
        const merge = (def: any) => {
            if (!def || def.tag === undefined) return;
            const tag = String(def.tag).trim();
            if (tag.length === 0) return;
            const existing = map[tag];
            if (existing === undefined) {
                map[tag] = { ...def };
            } else {
                // copyAttributeIfSpecified: only copy attributes that are defined.
                for (const key of ['width', 'height', 'shape', 'background', 'stroke', 'color', 'fontSize', 'icon', 'iconPosition', 'border', 'opacity', 'metadata', 'description']) {
                    if (def[key] !== undefined) existing[key] = def[key];
                }
            }
        };
        for (const themeDef of this.themeStyles) merge(themeDef);
        for (const raw of this.styles.elements) merge(raw);
        this.elementStyleMap = map;
        return map;
    }

    /** Resolves the effective element style (width/height/shape/fontSize/metadata) — mirrors findElementStyle. */
    private resolveElementStyle(el: NamedElement): { width: number; height: number; shape: string; fontSize: number; metadata: boolean } {
        const map = this.ensureElementStyleMap();
        let width = 450;
        let height = 300;
        let defaultSizeInUse = true;
        let shape: string | undefined = undefined;
        let fontSize: number | undefined = undefined;
        // The webview only reserves a metadata row when metadata text is actually
        // rendered (reposition(): metadataText non-empty). Metadata is shown by
        // default and hidden only when a style sets metadata: false.
        let metadata = true;
        for (const tag of this.elementTagsFor(el)) {
            const s = map[tag];
            if (s) {
                if (s.width !== undefined) { width = s.width; defaultSizeInUse = false; }
                if (s.height !== undefined) { height = s.height; defaultSizeInUse = false; }
                if (s.shape !== undefined) shape = s.shape;
                if (s.fontSize !== undefined) fontSize = s.fontSize;
                if (s.metadata !== undefined) metadata = s.metadata !== false;
            }
        }
        if (shape === undefined) shape = 'Box';
        if (fontSize === undefined) fontSize = DEFAULT_ELEMENT_FONT_SIZE;
        // Mobile device size normalization (findElementStyle).
        if (shape === 'MobileDevicePortrait' && height < width) { const t = width; width = height; height = t; }
        if (shape === 'MobileDeviceLandscape' && height > width) { const t = width; width = height; height = t; }
        // Unstyled Person/Robot shapes are rendered 400x400.
        if (defaultSizeInUse && (shape === 'Person' || shape === 'Robot')) { width = 400; height = 400; }
        return { width, height, shape, fontSize, metadata };
    }

    /** Converts a resolved style into the actual rendered cell size for a shape. */
    private cellSizeForStyle(width: number, height: number, shape: string): { width: number; height: number } {
        switch (shape) {
            // These shapes derive their cell height from the width in the webview.
            case 'Person':
            case 'Robot':
            case 'Circle':
            case 'Diamond':
                return { width, height: width };
            case 'Hexagon':
                return { width, height: Math.floor((width / 2) * Math.sqrt(3)) };
            default:
                return { width, height };
        }
    }

    /** Whether an element is rendered as a frame (deployment nodes contain children). */
    private isCompound(el: any): boolean {
        return isDeploymentNode(el);
    }

    /** Display name for the DOT node label (instances inherit their container/system name). */
    /** Finds the frame parent of a view element, if any. */
    private resolveFrameParent(el: any, scopeElement: NamedElement | undefined): NamedElement | undefined {
        // Container view: containers live inside the software system frame.
        if (isContainer(el) && scopeElement && isSoftwareSystem(scopeElement)) {
            return scopeElement;
        }
        // Component view: components live inside the frame of the container they
        // belong to (not necessarily the view's scope container).
        if (isComponent(el)) {
            return this.resolveComponentParent(el);
        }
        // Deployment hierarchy: deployment nodes nest inside parent deployment nodes.
        if (isDeploymentNode(el)) {
            return this.resolveDeploymentNodeParent(el);
        }
        // Instances / infrastructure nodes nest inside their deployment node.
        // resolveDeploymentNodeParent is used (not a plain $container climb) because
        // it also handles the !include case and does not stop at the deployment
        // environment - otherwise instances would not be attached to their frames and
        // the deployment view would be laid out flat (frames not wrapping children).
        if (isContainerInstance(el) || isSoftwareSystemInstance(el) || isInfrastructureNode(el)) {
            return this.resolveDeploymentNodeParent(el);
        }
        return undefined;
    }

    /** All tags a relationship matches in the webview (mirrors getAllTagsForRelationship). */
    private relationshipTagsFor(relationship: any): string[] {
        const rel = relationship?.relationship ?? relationship;
        const tags: string[] = [];
        const add = (t: string) => { const s = t.trim(); if (s && tags.indexOf(s) === -1) tags.push(s); };
        const base = this.extractTags(rel, 'Relationship');
        if (base) base.split(',').forEach(add);
        // Linked (implied) relationships also contribute their tags.
        let linked: any = rel?.linked;
        let guard = 0;
        while (linked && guard++ < 10) {
            const node = (linked && typeof linked === 'object' && 'ref' in linked) ? linked.ref : linked;
            if (!node) break;
            const lt = this.extractTags(node, 'Relationship');
            if (lt) lt.split(',').forEach(add);
            linked = node?.linked;
        }
        return tags;
    }

    /** Resolves the effective relationship style (mirrors findRelationshipStyle). */
    private resolveRelationshipStyle(relationship: any): { fontSize: number; width: number; description: boolean; metadata: boolean } {
        const rel = relationship?.relationship ?? relationship;
        // Defaults from findRelationshipStyle.
        let fontSize = 24;
        let width = 200;
        let description: boolean | undefined = undefined;
        let metadata: boolean | undefined = undefined;
        // Merge relationship styles by tag (first definition wins, then
        // copyAttributeIfSpecified) — mirrors findRelationshipStyle. Themes
        // come first (they act as the base), workspace styles override them,
        // exactly like the webview concatenates theme.relationships and then
        // configuration.styles.relationships.
        const map: Record<string, any> = {};
        const merge = (def: any) => {
            if (!def || def.tag === undefined) return;
            const tag = String(def.tag).trim();
            if (tag.length === 0) return;
            const existing = map[tag];
            if (existing === undefined) {
                map[tag] = { ...def };
            } else {
                for (const key of ['thickness', 'color', 'fontSize', 'width', 'dashed', 'routing', 'position', 'opacity', 'jump', 'style', 'metadata', 'description']) {
                    if (def[key] !== undefined) existing[key] = def[key];
                }
            }
        };
        for (const themeDef of this.themeRelationshipStyles) merge(themeDef);
        for (const raw of this.styles.relationships) merge(raw);
        for (const tag of this.relationshipTagsFor(rel)) {
            const s = map[tag];
            if (s) {
                if (s.fontSize !== undefined) fontSize = s.fontSize;
                if (s.width !== undefined) width = s.width;
                if (s.description !== undefined) description = s.description === true;
                if (s.metadata !== undefined) metadata = s.metadata === true;
            }
        }
        return { fontSize, width, description: description !== false, metadata: metadata !== false };
    }

    /**
    * Runs Graphviz (dot) in the plugin for every view that has an attached
    * graphviz DOT (i.e. views with an explicit autoLayout), writes the resulting
    * coordinates and sizes into view.elements, and drops automaticLayout (so the
    * webview renders at these positions instead of re-laying out).
    *
    * The transient `graphviz` field holds the DOT string and is cleared after layout.
    */
    private async applyGraphvizAutoLayouts(jsonOutput: any): Promise<void> {
        for (const { views, dynamic } of this.viewArrays(jsonOutput)) {
            if (!Array.isArray(views)) continue;
            for (const view of views) {
                // Some extractors return undefined for views that fail their scope
                // guard - skip those entries.
                if (!view || !view.graphviz) continue;
                // Keep the DOT and the measurement candidates so the webview-measured
                // text widths can re-run this layout without rebuilding the DOT.
                if (view.textMeasurements) {
                    this.viewLayouts.set(view.key, { dot: view.graphviz, measurements: view.textMeasurements });
                }
                try {
                    await this.applyGraphvizLayoutToView(view, dynamic);
                } catch (err) {
                    console.error(`[C4 Graphviz] Layout failed for view ${view.key}:`, err);
                }
            }
        }
    }

    /** The view collections of the generated JSON, with their dynamic-view flag. */
    private viewArrays(jsonOutput: any): { views: any[] | undefined; dynamic: boolean }[] {
        return [
            { views: jsonOutput.views?.systemLandscapeViews, dynamic: false },
            { views: jsonOutput.views?.systemContextViews, dynamic: false },
            { views: jsonOutput.views?.containerViews, dynamic: false },
            { views: jsonOutput.views?.componentViews, dynamic: false },
            { views: jsonOutput.views?.deploymentViews, dynamic: false },
            { views: jsonOutput.views?.dynamicViews, dynamic: true },
            { views: jsonOutput.views?.customViews, dynamic: false }
        ];
    }

    /**
     * Measurement candidates of every auto-laid-out view, keyed by view key. The
     * webview measures these texts after rendering and returns the widths, which
     * applyTextMeasurements then feeds back into the layout.
     */
    public getTextMeasurements(): Record<string, ViewTextMeasurements> {
        const out: Record<string, ViewTextMeasurements> = {};
        for (const [viewKey, layout] of this.viewLayouts) {
            out[viewKey] = layout.measurements;
        }
        return out;
    }

    /**
     * Re-runs the auto-layout of the views whose frames show measured texts wider than
     * their content, raising the cluster margins so the frame text and the frame itself
     * are reserved in the graph. Element boxes are not measured: the renderer wraps
     * their text to the box width.
     *
     * Returns the views that were re-laid out, so the client can re-render them.
     */
    public async applyTextMeasurements(json: any, widths: Record<string, number>): Promise<{ views: any[]; changed: boolean }> {
        const updated: any[] = [];
        let changed = false;
        for (const { views, dynamic } of this.viewArrays(json)) {
            if (!Array.isArray(views)) continue;
            for (const view of views) {
                const layout = view?.key !== undefined ? this.viewLayouts.get(view.key) : undefined;
                if (!layout) continue;
                const margins = this.clusterMargins(layout.measurements, widths);
                if (margins === undefined) continue;
                const dot = this.withClusterMargins(layout.dot, margins);
                // The DOT already reserves the requested space: the view was re-laid out
                // by an earlier measurement pass, so return it as-is and let the client
                // rebuild with the reserved coordinates.
                if (dot === layout.dot) {
                    updated.push(view);
                    continue;
                }
                view.graphviz = dot;
                try {
                    await this.applyGraphvizLayoutToView(view, dynamic);
                    // Keep the re-laid-out DOT so a repeated measurement pass (same
                    // widths, e.g. after the themes arrived) does not re-render again.
                    this.viewLayouts.set(view.key, { dot, measurements: layout.measurements });
                    updated.push(view);
                    changed = true;
                } catch (err) {
                    console.error(`[C4 Graphviz] Measured layout failed for view ${view.key}:`, err);
                }
            }
        }
        return { views: updated, changed };
    }

    /**
     * Refits the view's paper to imported element coordinates, including the auto-drawn
     * frames (deployment nodes, groups and scope boundaries) whose boxes the renderer
     * derives from the elements. The frame tree was captured when the DOT graph was
     * built, so only the leaf boxes have to be recomputed here.
     */
    public fitImportedView(viewKey: string, view: any): void {
        const tree = this.frameTrees.get(viewKey);
        fitViewToContent(view, tree ? this.frameBoxes(tree, view) : []);
    }

    /**
     * Boxes of every frame in the tree, bottom-up: a frame encloses its elements and its
     * child frames plus the webview's cluster padding (mirrors the renderer's
     * reposition()). A group frame shows no metadata line, so its bottom padding is
     * smaller.
     */
    private frameBoxes(tree: FrameTree, view: any): { x: number; y: number; width: number; height: number }[] {
        const nameFontSize = Math.floor(DEFAULT_ELEMENT_FONT_SIZE * NAME_FONT_SIZE_DIFFERENCE_RATIO);
        const metadataFontSize = Math.floor(DEFAULT_ELEMENT_FONT_SIZE * METADATA_FONT_SIZE_DIFFERENCE_RATIO);
        const padFor = (clusterId: string) => ({
            top: WEBVIEW_CLUSTER_PADDING,
            left: WEBVIEW_CLUSTER_PADDING,
            right: WEBVIEW_CLUSTER_PADDING,
            bottom: WEBVIEW_CLUSTER_PADDING + WEBVIEW_FRAME_MARGIN + nameFontSize
                + (tree.clusterKind[clusterId] === 'group' ? 0 : metadataFontSize)
                + WEBVIEW_FRAME_MARGIN
        });

        const elementById = new Map<string, any>();
        for (const el of view?.elements ?? []) elementById.set(String(el?.id), el);

        const boxes: { x: number; y: number; width: number; height: number }[] = [];
        const visit = (clusterId: string): { x: number; y: number; width: number; height: number } | undefined => {
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            const add = (x: number, y: number, w: number, h: number) => {
                minX = Math.min(minX, x); minY = Math.min(minY, y);
                maxX = Math.max(maxX, x + w); maxY = Math.max(maxY, y + h);
            };
            for (const child of tree.childrenOf[clusterId] ?? []) {
                if (child.startsWith('cluster_')) {
                    const box = visit(child);
                    if (box) add(box.x, box.y, box.width, box.height);
                } else {
                    const el = elementById.get(child);
                    if (typeof el?.x === 'number' && typeof el?.y === 'number'
                        && typeof el?.width === 'number' && typeof el?.height === 'number') {
                        add(el.x, el.y, el.width, el.height);
                    }
                }
            }
            // `root` is not a frame: its children are the frames and leaves, which are
            // measured on their own.
            if (minX === Infinity || clusterId === 'root') return undefined;
            const pad = padFor(clusterId);
            const box = {
                x: minX - pad.left,
                y: minY - pad.top,
                width: (maxX - minX) + pad.left + pad.right,
                height: (maxY - minY) + pad.top + pad.bottom
            };
            boxes.push(box);
            return box;
        };
        visit('root');
        return boxes;
    }

    /**
     * Extra cluster margins (in points) needed to keep the measured frame text clear
     * of the next node. The renderer sizes a frame as
     * max(content + 2 * clusterPadding, text + 2 * margin) and draws the text 15px
     * inside the frame's left edge, so the gap to the neighbour must cover the text
     * that reaches beyond the content.
     *
     * A cluster margin is applied on every side (graphviz ignores the "x,y" pair
     * form, verified against the bundled build), so this also adds vertical space
     * around the frame.
     */
    private clusterMargins(measurements: ViewTextMeasurements, widths: Record<string, number>): Record<string, number> | undefined {
        const margins: Record<string, number> = {};
        const contentWidth = (clusterId: string): number => {
            let width = 0;
            for (const child of measurements.children[clusterId] ?? []) {
                width = Math.max(width, measurements.nodeWidths[child] ?? contentWidth(child));
            }
            return width;
        };
        for (const clusterId of Object.keys(measurements.clusters)) {
            let textWidth = 0;
            for (const key of measurements.clusters[clusterId]) {
                const measured = widths[key];
                if (measured !== undefined) textWidth = Math.max(textWidth, measured);
            }
            if (textWidth === 0) continue;
            // `textWidth` is the frame width the renderer enforces. A frame extends
            // 50px beyond its content on each side, so the separation between the
            // content boxes must cover the frame plus the visual gap the default
            // margin leaves between frames.
            const content = contentWidth(clusterId);
            const requiredGapPx = Math.max(50, textWidth - content) + DOT_FRAME_GAP_PX;
            // Graphviz keeps the neighbour at max(nodesep, 2 * margin) points away, so
            // half of the required gap is enough. Points are 300/72 of a px here.
            const marginPoints = Math.round(requiredGapPx * GRAPHVIZ_POINTS_PER_PX / 2);
            if (marginPoints > 0) margins[clusterId] = marginPoints;
        }
        return Object.keys(margins).length > 0 ? margins : undefined;
    }

    /**
     * Returns the DOT with the margin of the given clusters raised to at least the
     * requested value, keeping every other attribute untouched.
     */
    private withClusterMargins(dot: string, margins: Record<string, number>): string {
        const lines = dot.split('\n');
        let current: string | undefined;
        for (let i = 0; i < lines.length; i++) {
            const subgraph = /^\s*subgraph "([^"]+)" \{\s*$/.exec(lines[i]);
            if (subgraph) {
                current = subgraph[1];
                continue;
            }
            const margin = /^(\s*)margin=(?:"?([\d.]+)(?:,([\d.]+))?"?)\s*$/.exec(lines[i]);
            if (margin && current !== undefined) {
                const requested = margins[current];
                if (requested !== undefined) {
                    const currentMargin = Math.max(parseFloat(margin[2]), margin[3] !== undefined ? parseFloat(margin[3]) : 0);
                    lines[i] = `${margin[1]}margin=${Math.max(currentMargin, requested)}`;
                }
                current = undefined;
            }
        }
        return lines.join('\n');
    }


    /**
     * Lays out the DOT graph, reusing the shared layout cache when the same DOT
     * was laid out before. The layout is a pure function of the DOT, so a cached
     * result is always valid for that graph - only the caller's post-processing
     * (which depends on the model) has to run again.
     */
    private async layoutGraphviz(dot: string): Promise<any> {
        const cached = this.layoutCache?.get(dot);
        if (cached !== undefined) {
            return cached;
        }
        const json = await layoutDot(dot);
        this.layoutCache?.set(dot, json);
        return json;
    }

    /**
     * Runs Graphviz on a single view's DOT graph and writes normalized
     * coordinates/sizes/vertices into the view JSON. The pipeline is intentionally
     * clean: build the DOT, run graphviz.layout(dot, 'json'), then copy the
     * resulting positions/sizes/vertices into the view. No post-processing is applied.
     *
     * The `json` (-Tjson) output is used because it preserves the custom `id=`
     * attributes we put on DOT nodes/edges, so relationships can be matched back
     * to view.relationships BY ID. The plain format drops ids and cannot do this.
     */
    private async applyGraphvizLayoutToView(view: any, isDynamic = false): Promise<void> {
        const dot = view.graphviz as string;
        if (!dot) return;
        const json = await this.layoutGraphviz(dot);

        const margin = PAPER_MARGIN; // paper margin - the same gap on every side of the diagram
        // Graphviz -Tjson coordinates are in points (72/inch) with the origin at
        // the bottom-left (y grows UP); the webview paper origin is at the top-left.
        // The DOT sizes are in a 300dpi inch space (STRUCTURIZR_DPI), so points are
        // points converted back from the 300dpi graph space (300/72).
        const PT = 300 / 72;

        const parsePoint = (s: string): [number, number] => {
            const [a, b] = s.split(',');
            return [parseFloat(a), parseFloat(b)];
        };
        const parseBB = (s: string) => {
            const [x1, y1, x2, y2] = s.split(',').map(Number);
            return { x1, y1, x2, y2 };
        };
        // Graphviz polyline `pos`: "e,x1,y1 x2,y2 x3,y3 ..." - the leading "e,"
        // token is the head (arrow tip) point; the remaining tokens are the
        // polyline vertices in order tail -> head.
        const parseSpline = (pos: string): { x: number; y: number }[] => {
            const out: { x: number; y: number }[] = [];
            for (const part of pos.trim().split(/\s+/)) {
                const m = /^(?:e,)?([-.\d]+),([-.\d]+)$/.exec(part);
                if (m) out.push({ x: parseFloat(m[1]), y: parseFloat(m[2]) });
            }
            return out;
        };

        // graphviz -Tjson coordinates are y-up points; the webview paper is y-down px.
        // The graphviz default 4pt graph pad and the graph-height offset in the y-flip
        // (SVG wrapper transform "translate(4 graphHeight+4)") both cancel out of every
        // coordinate, vertex and paper bound - the symmetric paper centring below
        // subtracts the same constant from the min/max. Only the y-flip itself (y-up ->
        // y-down orientation) and the point->px scale (PT) are needed.
        const yDown = (jsonY: number) => -jsonY * PT;
        const xPx = (jsonX: number) => jsonX * PT;

        // Nodes (objects with pos/width/height + our id) and clusters (bb + nodes).
        const nodeById: Record<string, { x: number; y: number; w: number; h: number }> = {};
        const idByGvid: Record<number, string> = {};
        const clusters: { name: string; gvid: number; bb: { x1: number; y1: number; x2: number; y2: number }; nodes: number[] }[] = [];
        for (const obj of (json.objects ?? [])) {
            if (!obj) continue;
            if (obj.pos && obj.width && obj.height && obj.id !== undefined) {
                const [cx, cy] = parsePoint(obj.pos); // center, points
                nodeById[obj.id] = { x: cx, y: cy, w: parseFloat(obj.width) * 72, h: parseFloat(obj.height) * 72 };
                if (obj._gvid !== undefined) idByGvid[obj._gvid] = String(obj.id);
            } else if (obj.bb && Array.isArray(obj.nodes)) {
                clusters.push({ name: obj.name, gvid: obj._gvid, bb: parseBB(obj.bb), nodes: obj.nodes as number[] });
            }
        }

        // Leaf element boxes in the paper coordinate space (y-down).
        const rects: Record<string, { x: number; y: number; w: number; h: number }> = {};
        for (const id of Object.keys(nodeById)) {
            const c = nodeById[id];
            const w = c.w * PT, h = c.h * PT;
            rects[id] = { x: xPx(c.x - c.w / 2), y: yDown(c.y + c.h / 2), w, h };
        }

        // Build the cluster tree from graphviz bb containment, then reproduce the
        // webview frame sizes: embedded content
        // plus clusterPadding (50) on each side, plus a footer at the bottom of
        // 50+15+nameFontSize+metadataFontSize+15 (=122 for boundaries/deployment
        // nodes, =108 for groups). These frames are drawn by the webview (even though
        // the DOT only carries them as clusters), so they must be part of the paper
        // bounds and are where deployment nodes are placed.
        const contains = (a: { x1: number; y1: number; x2: number; y2: number }, b: { x1: number; y1: number; x2: number; y2: number }) =>
            a.x1 <= b.x1 && a.y1 <= b.y1 && a.x2 >= b.x2 && a.y2 >= b.y2;
        const area = (c: { bb: { x1: number; y1: number; x2: number; y2: number } }) =>
            (c.bb.x2 - c.bb.x1) * (c.bb.y2 - c.bb.y1);
        const sorted = [...clusters].sort((a, b) => area(a) - area(b)); // innermost first
        const childrenOf: Record<string, string[]> = {};
        for (const c of sorted) {
            let parent: string | undefined;
            let parentArea = Infinity;
            for (const p of sorted) {
                if (p === c || !contains(p.bb, c.bb)) continue;
                if (area(p) < parentArea) { parentArea = area(p); parent = p.name; }
            }
            if (parent) (childrenOf[parent] ||= []).push(c.name);
        }
        const frameBounds: Record<string, { x: number; y: number; w: number; h: number }> = {};
        // Replicates the webview's reposition() bottom footer for a frame.
        const padFor = (name: string) => {
            const nameFontSize = Math.floor(DEFAULT_ELEMENT_FONT_SIZE * NAME_FONT_SIZE_DIFFERENCE_RATIO);
            const metadataFontSize = Math.floor(DEFAULT_ELEMENT_FONT_SIZE * METADATA_FONT_SIZE_DIFFERENCE_RATIO);
            const hasMetadata = !name.startsWith('cluster_group_');
            return {
                top: WEBVIEW_CLUSTER_PADDING, left: WEBVIEW_CLUSTER_PADDING, right: WEBVIEW_CLUSTER_PADDING,
                bottom: WEBVIEW_CLUSTER_PADDING + WEBVIEW_FRAME_MARGIN + nameFontSize + (hasMetadata ? metadataFontSize : 0) + WEBVIEW_FRAME_MARGIN
            };
        };
        const leafSet: Record<string, Set<number>> = {};
        for (const c of clusters) leafSet[c.name] = new Set(c.nodes);
        for (const c of sorted) {
            const childLeaves = new Set<number>();
            for (const ch of childrenOf[c.name] ?? []) {
                for (const g of leafSet[ch] ?? []) childLeaves.add(g);
            }
            let mnX = Infinity, mnY = Infinity, mxX = -Infinity, mxY = -Infinity;
            for (const g of c.nodes) {
                if (childLeaves.has(g)) continue; // belongs to a nested cluster
                const id = idByGvid[g];
                const r = id !== undefined ? rects[id] : undefined;
                if (!r) continue;
                mnX = Math.min(mnX, r.x); mnY = Math.min(mnY, r.y);
                mxX = Math.max(mxX, r.x + r.w); mxY = Math.max(mxY, r.y + r.h);
            }
            for (const ch of childrenOf[c.name] ?? []) {
                const fb = frameBounds[ch];
                if (!fb) continue;
                mnX = Math.min(mnX, fb.x); mnY = Math.min(mnY, fb.y);
                mxX = Math.max(mxX, fb.x + fb.w); mxY = Math.max(mxY, fb.y + fb.h);
            }
            if (mnX === Infinity) continue; // empty cluster - the webview removes it
            const pad = padFor(c.name);
            frameBounds[c.name] = { x: mnX - pad.left, y: mnY - pad.top, w: mxX - mnX + pad.left + pad.right, h: mxY - mnY + pad.top + pad.bottom };
        }

        // The true diagram bounds: leaf boxes, webview frames, relationship vertices
        // (bends) and relationship labels all extend the drawn diagram, so they all
        // drive the paper size (with an equal gap on every side).
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        const include = (x: number, y: number, w = 0, h = 0) => {
            minX = Math.min(minX, x); minY = Math.min(minY, y);
            maxX = Math.max(maxX, x + w); maxY = Math.max(maxY, y + h);
        };
        for (const id of Object.keys(rects)) include(rects[id].x, rects[id].y, rects[id].w, rects[id].h);
        for (const name of Object.keys(frameBounds)) include(frameBounds[name].x, frameBounds[name].y, frameBounds[name].w, frameBounds[name].h);

        // Edges: match to view.relationships BY ID (the DOT edges carry
        // id=<relationshipId>). The relationship label footprint is centred on the
        // source->target midpoint (the webview draws it at distance 0.5); label size
        // is computed from the relationship's resolved style, mirroring the webview's
        // createArrow (labelSize width = style.width * 1.2, height = description height
        // + technology height). Vertices (real bends) are only written for static views
        // - dynamic views keep straight lines.
        // Lookup the model relationship by id (the DOT edge id is the relationship id)
        // so its style/description can be resolved.
        const relationshipById: Record<string, any> = {};
        for (const rel of this.relationships) {
            const id = this.getId(rel);
            if (relationshipById[id] === undefined) relationshipById[id] = rel;
        }
        const relById: Record<string, any> = {};
        if (view.relationships) {
            for (const rel of view.relationships) { if (rel && rel.id) relById[rel.id] = rel; }
        }
        const rawVerticesById: Record<string, { x: number; y: number }[]> = {};
        for (const ge of (json.edges ?? [])) {
            if (!ge.pos) continue;
            const pts = parseSpline(ge.pos);
            if (pts.length < 2) continue;
            const route = [...pts.slice(1), pts[0]]; // tail -> head (drop the "e," head)
            const srcCenter = nodeById[idByGvid[ge.tail]];
            const tgtCenter = nodeById[idByGvid[ge.head]];

            if (srcCenter && tgtCenter) {
                const mx = (srcCenter.x + tgtCenter.x) / 2;
                const my = (srcCenter.y + tgtCenter.y) / 2;
                // Label footprint from the relationship style (no label -> no footprint).
                let labelW = 240, labelH = 0;
                const modelRel = relationshipById[ge.id];
                if (modelRel) {
                    const style = this.resolveRelationshipStyle(modelRel);
                    const clean = String(this.description(modelRel) ?? '').replace(/\r?\n/g, ' ').trim();
                    if (style.description !== false && clean.length > 0) {
                        labelW = Math.max(20, style.width) * 1.2;
                        const characterWidth = style.fontSize * 0.75;
                        const lines = style.width > 0 ? Math.max(1, Math.ceil((clean.length * characterWidth) / style.width)) : 1;
                        labelH = style.fontSize + ((lines - 1) * style.fontSize * 1.2);
                        const technology = this.technology(modelRel);
                        if (technology && style.metadata !== false) {
                            labelH += 10 + style.fontSize * METADATA_FONT_SIZE_DIFFERENCE_RATIO;
                        }
                    }
                } else {
                    labelH = 50; // unknown relationship - reserve a default box
                }
                if (labelH > 0) {
                    include(xPx(mx) - labelW / 2, yDown(my) - labelH / 2, labelW, labelH);
                }
            }

            if (isDynamic) continue;
            const rel = relById[ge.id];
            if (!rel) continue;
            const onBox = (pt: { x: number; y: number }, c: { x: number; y: number; w: number; h: number } | undefined) =>
                c !== undefined && Math.abs(pt.x - c.x) <= c.w / 2 + 22 && Math.abs(pt.y - c.y) <= c.h / 2 + 22;

            // Drop the source connection point (JointJS computes the connection to
            // the source box itself). A deployment-node endpoint is clipped by
            // graphviz to its cluster border, but the webview connects the
            // relationship to the deployment-node frame cell itself, so that clipped
            // point is dropped too - otherwise it sits inside the webview frame (its
            // bottom footer is larger than the cluster margin) and the line appears
            // to start inside the node.
            const modelRel = relationshipById[ge.id];
            const tailIsFrame = modelRel !== undefined && isDeploymentNode(this.resolveSource(modelRel));
            const headIsFrame = modelRel !== undefined && isDeploymentNode(this.resolveTarget(modelRel));
            const startIdx = (onBox(route[0], srcCenter) || tailIsFrame) ? 1 : 0;
            const endExcl = (onBox(route[route.length - 1], tgtCenter) || headIsFrame) ? route.length - 1 : route.length;
            const interior = route.slice(startIdx, endExcl);

            // Mirrors SVGReader's `if (d.length == 3)`: only edges routed with a real
            // bend keep vertices; straight edges are drawn by JointJS directly. In
            // -Tjson the polyline of a straight edge still has several sampled points,
            // so the straight test is: no interior point deviates more than the
            // threshold from the source->target line. The threshold (35pt) is generous:
            // graphviz fans near-parallel edges (e.g. two edges from one node to two
            // targets that are almost aligned) across the nodesep gap with a small
            // (~15-30pt) deviation - those small "separation" bends are suppressed so
            // the webview draws the edge as a clean straight line, while genuinely
            // routed bends (cross-cluster detours) are still preserved.
            let hasBend = false;
            if (srcCenter && tgtCenter) {
                const abx = tgtCenter.x - srcCenter.x, aby = tgtCenter.y - srcCenter.y;
                const len2 = abx * abx + aby * aby;
                if (len2 > 0) {
                    for (const pt of interior) {
                        let t = ((pt.x - srcCenter.x) * abx + (pt.y - srcCenter.y) * aby) / len2;
                        t = Math.max(0, Math.min(1, t));
                        const px = srcCenter.x + abx * t, py = srcCenter.y + aby * t;
                        if (Math.hypot(pt.x - px, pt.y - py) > BEND_DEVIATION_THRESHOLD) { hasBend = true; break; }
                    }
                } else {
                    hasBend = interior.length > 1;
                }
            }
            if (!hasBend) continue;

            const raw = interior.map(pt => ({ x: xPx(pt.x), y: yDown(pt.y) }));
            for (const v of raw) include(v.x, v.y);
            rawVerticesById[ge.id] = raw;
        }

        if (minX === Infinity) { minX = margin; minY = margin; maxX = margin; maxY = margin; }

        // Paper = the diagram bounds plus the SAME margin on all four sides, with the
        // diagram strictly centred (a +minX shift would offset the content and
        // leave it off-centre).
        const paperW = Math.max(2 * margin, (maxX - minX) + 2 * margin);
        const paperH = Math.max(2 * margin, (maxY - minY) + 2 * margin);
        const shiftX = margin - minX;
        const shiftY = margin - minY;

        // view.elements may be absent (empty view with no elements - onlyIfNotEmpty
        // drops the empty array), so iterate over [] in that case.
        for (const el of (view.elements ?? [])) {
            // Frames (deployment nodes) have no box of their own: the renderer derives
            // their position and size from their children, so only leaf elements are
            // placed here.
            const r = rects[el.id];
            if (!r) continue;
            el.x = Math.floor(r.x + shiftX);
            el.y = Math.floor(r.y + shiftY);
            el.width = Math.round(r.w);
            el.height = Math.round(r.h);
        }

        if (!isDynamic) {
            for (const id of Object.keys(rawVerticesById)) {
                const rel = relById[id];
                if (!rel) continue;
                const vertices = rawVerticesById[id].map(v => ({ x: Math.round(v.x + shiftX), y: Math.round(v.y + shiftY) }));
                // Graphviz encodes a sharp corner in a polyline by repeating the point,
                // so consecutive duplicates carry no information.
                rel.vertices = vertices.filter((v, i) => i === 0 || v.x !== vertices[i - 1].x || v.y !== vertices[i - 1].y);
            }
        } else {
            // Dynamic views keep straight lines, so forward + response steps
            // between the same pair of elements would overlap. Fan-out: place one
            // perpendicular vertex at the line midpoint for every overlapping
            // sibling, alternating sides. The coordinates are already in paper
            // space (view.elements[] has the final x/y), so no extra shift is
            // needed here.
            this.applyDynamicSiblingFanOut(view);
        }

        view.dimensions = {
            width: Math.ceil(paperW),
            height: Math.ceil(paperH)
        };

        // Layout is already applied here - the webview must render at the given
        // coordinates instead of re-running its own auto-layout.
        view.automaticLayout = undefined;

        // The DOT string and the measurement candidates were only layout inputs -
        // drop them from the generated JSON so no transitive graphviz artifact
        // leaks into the output.
        delete view.graphviz;
        delete view.textMeasurements;
    }

    /**
     * Fan-out for dynamic views: forward and response steps between the same
     * pair of elements would otherwise be drawn as overlapping straight lines;
     * this places a single perpendicular vertex at the line midpoint for each
     * overlapping sibling, alternating left/right, so the arrows separate.
     *
     * The element positions come from `view.elements[]`, which already hold the
     * final paper-space x/y/width/height written by applyGraphvizLayoutToView,
     * so no coordinate transform is needed here.
     */
    private applyDynamicSiblingFanOut(view: any): void {
        if (!Array.isArray(view.elements) || !Array.isArray(view.relationships)) return;

        // Element center lookup by id (paper-space coordinates).
        const centerById: Record<string, { x: number; y: number }> = {};
        for (const el of view.elements) {
            if (el && el.id !== undefined && typeof el.x === 'number' && typeof el.y === 'number') {
                centerById[el.id] = {
                    x: el.x + (typeof el.width === 'number' ? el.width / 2 : 0),
                    y: el.y + (typeof el.height === 'number' ? el.height / 2 : 0)
                };
            }
        }

        // Group steps by undirected pair, preserving the order they appear in.
        const steps = view.relationships.filter((r: any) => r && r.id !== undefined);
        const groups = new Map<string, any[]>();
        const orderOf: string[] = [];
        for (const rel of steps) {
            // Find the source/destination ids via the model relationship to get
            // the true endpoints. view.relationships only carries id + order +
            // description; the model relationship is resolved via this.getId.
            let key: string | undefined;
            const modelRel = this.relationships.find(r => this.getId(r) === rel.id);
            if (modelRel) {
                const sourceId = rel.response === true
                    ? this.getId(this.resolveTarget(modelRel))
                    : this.getId(this.resolveSource(modelRel));
                const targetId = rel.response === true
                    ? this.getId(this.resolveSource(modelRel))
                    : this.getId(this.resolveTarget(modelRel));
                key = [sourceId, targetId].sort().join('|');
                rel.sourceId = sourceId;
                rel.destinationId = targetId;
            }
            if (key === undefined) continue;
            if (!groups.has(key)) {
                groups.set(key, []);
                orderOf.push(key);
            }
            groups.get(key)!.push(rel);
        }

        const GAP = 150;
        const toRad = (deg: number) => (deg * Math.PI) / 180;

        for (const key of orderOf) {
            const siblings = groups.get(key)!;
            // Only fan out when at least two siblings have no vertices (i.e.
            // they would overlap once rendered).
            const withoutVertices = siblings.filter(s =>
                s.vertices === undefined || (Array.isArray(s.vertices) && s.vertices.length === 0)
            );
            if (withoutVertices.length < 2) continue;

            const first = withoutVertices[0];
            const a = centerById[first.sourceId];
            const b = centerById[first.destinationId];
            if (!a || !b) continue;

            const midX = (a.x + b.x) / 2;
            const midY = (a.y + b.y) / 2;

            // JointJS Point.theta: angle from x axis to p, with the y axis
            // inverted, normalized to [0, 360) degrees.
            const y = -(b.y - a.y);
            const dx = b.x - a.x;
            let thetaDeg = (Math.atan2(y, dx) * 180) / Math.PI;
            if (thetaDeg < 0) thetaDeg += 360;

            withoutVertices.forEach((sibling, index) => {
                let offsetIndex = index;
                if (siblings.length % 2 === 0) {
                    offsetIndex++;
                }
                const offset = GAP * Math.ceil(offsetIndex / 2);

                // Alternate left/right of the base line (odd -> +1, even -> -1).
                const sign = index % 2 ? 1 : -1;
                const angleRad = toRad(thetaDeg + sign * 90);

                // Point.fromPolar: abs of the components, then quadrant fix.
                const cosA = Math.cos(angleRad);
                const sinA = Math.sin(angleRad);
                let vx = Math.abs(offset * cosA);
                let vy = Math.abs(offset * sinA);
                let deg = angleRad * 180 / Math.PI;
                while (deg < 0) deg += 360;
                deg %= 360;
                if (deg < 90) {
                    vy = -vy;
                } else if (deg < 180) {
                    vx = -vx;
                    vy = -vy;
                } else if (deg < 270) {
                    vx = -vx;
                }

                sibling.vertices = [{ x: Math.round(midX + vx), y: Math.round(midY + vy) }];
            });
        }
    }

    /** Finds the element an `!element` directive extends. */
    private resolveElementExtensionTarget(extension: any): NamedElement | undefined {
        for (const [target, extensions] of this.elementExtensionsByTarget) {
            if (extensions.includes(extension)) {
                return this.el(target);
            }
        }
        return undefined;
    }

    /**
     * 1-based index of an instance among the instances of the same container/software
     * system in the same environment, in the order the reference parser reads the
     * workspace: base documents first, and within an extends block in source order,
     * with !include files spliced in at their include directive.
     */
    private instanceId(node: any): number {
        const containerInstance = isContainerInstance(node);
        const reference = containerInstance ? node.container?.ref : node.softwareSystem?.ref;
        const parent = this.resolveDeploymentNodeParent(node);
        const candidates: { rank: number; position: number; index: number }[] = [];
        this.elements.forEach((element, index) => {
            const matches = containerInstance
                ? isContainerInstance(element) && element.container?.ref === reference
                : isSoftwareSystemInstance(element) && element.softwareSystem?.ref === reference;
            if (matches && this.resolveDeploymentNodeParent(element) === parent) {
                candidates.push({
                    rank: this.extendsDepths.get(AstUtils.getDocument(element)?.uri.toString()) ?? 0,
                    position: this.elementSourcePositions.get(element) ?? 0,
                    index
                });
            }
        });
        candidates.sort((a, b) => b.rank - a.rank || a.position - b.position || a.index - b.index);
        for (let i = 0; i < candidates.length; i++) {
            if (this.elements[candidates[i].index] === node) return i + 1;
        }
        return 1;
    }

    /**
     * Computes, in one walk of the workspace `extends` chain, two things keyed
     * differently: the depth of every reachable document (entry 0, the workspace it
     * extends 1, ...; `!include` files inherit their includer's depth) and the source
     * position of every collected element within its extends block (`!include` files are
     * spliced at the include directive, so an included element's position is the include
     * offset plus its offset within the included file). Deeper extends blocks sort before
     * shallower ones via the extends depth.
     */
    private computeExtendsInfo(entry: Workspace): { depths: Map<string, number>; positions: Map<AstNode, number> } {
        const depths = new Map<string, number>();
        const positions = new Map<AstNode, number>();
        const visit = (root: AstNode, depth: number, base: number) => {
            const doc = AstUtils.getDocument(root);
            const docUri = doc?.uri.toString();
            if (!docUri || depths.has(docUri)) return;
            depths.set(docUri, depth);
            const scan = this.scanDocument(root);
            for (const content of scan.namedElements) {
                if (positions.has(content)) continue;
                positions.set(content, base + (content.$cstNode?.offset ?? 0));
            }
            for (const content of scan.includes) {
                const includedRoot = this.resolveIncludedRoot(content, content.file);
                if (includedRoot) visit(includedRoot, depth, base + (content.$cstNode?.offset ?? 0));
            }
        };
        const walk = (ws: Workspace, depth: number) => {
            visit(ws, depth, 0);
            if (ws.extendsUri) {
                const parent = this.resolveParentWorkspace(ws, ws.extendsUri);
                if (parent) walk(parent, depth + 1);
            }
        };
        walk(entry, 0);
        // Materialised instances (e.g. `instanceof`) live in this.elements as
        // copies, not the streamed AST node — give the copy its original's position.
        for (const [original, position] of positions) {
            const copy = this.materialized.get(original);
            if (copy && !positions.has(copy)) positions.set(copy, position);
        }
        return { depths, positions };
    }

    /**
     * Resolves the parent SoftwareSystem for a given Container by climbing
     * up the AST $container chain.
     * 
     * If the Container is defined inline inside a SoftwareSystem block,
     * the first SoftwareSystem found via $container is returned.
     * 
     * If the Container is defined in an !include file, $container points
     * to the root of the included document, not to the logical parent.
     * In that case, the method looks up the Include directive that
     * references the included file and climbs from there.
     * 
     * @param container The Container whose parent SoftwareSystem to find
     * @returns The parent SoftwareSystem, or undefined if not found
     */
    private resolveContainerParent(container: Container): SoftwareSystem | undefined {
        return this.ancestorOfKind(container, isSoftwareSystem);
    }

    /**
     * Resolves the parent Container for a given Component by climbing
     * up the AST $container chain.
     * 
     * If the Component is defined inline inside a Container block,
     * the first Container found via $container is returned.
     * 
     * If the Component is defined in an !include file, $container points
     * to the root of the included document, not to the logical parent.
     * In that case, the method looks up the Include directive that
     * references the included file and climbs from there.
     * 
     * @param component The Component whose parent Container to find
     * @returns The parent Container, or undefined if not found
     */
    private resolveComponentParent(component: Component): Container | undefined {
        return this.ancestorOfKind(component, isContainer);
    }

    /**
     * Parent of an element in the model hierarchy, whichever level it belongs to:
     * a component's container, a container's software system, or a deployment
     * element's deployment node.
     */
    private parentOf(element: NamedElement): NamedElement | undefined {
        if (isComponent(element)) return this.resolveComponentParent(element);
        if (isContainer(element)) return this.resolveContainerParent(element);
        if (isDeploymentNode(element) || isSoftwareSystemInstance(element) || isContainerInstance(element)) {
            return this.resolveDeploymentNodeParent(element);
        }
        return undefined;
    }

    /**
     * Finds the closest ancestor of the requested kind for an element, climbing the AST
     * `$container` chain. Inline nesting is found there directly. An element declared in
     * an `!include` file has the root of the included document as `$container` instead of
     * its logical parent, so once the climb reaches a document root it continues from the
     * `!include` directives referencing that document, and repeats: chains of several
     * includes resolve exactly like inline nesting.
     *
     * An element declared by `!element` logically belongs to the extended element, not to
     * the ElementExtension directive, so the extension target is checked as well.
     */
    private ancestorOfKind<T>(node: AstNode, isKind: (el: any) => el is T, visitedDocs = new Set<AstNode>()): T | undefined {
        let current: AstNode | undefined = node;
        while (current) {
            const el = this.el(current);
            if (isKind(el)) return el;
            if (isElementExtension(el)) {
                const target = this.resolveElementExtensionTarget(el);
                if (target && isKind(target)) return target;
            }
            if (current.$container) {
                current = current.$container;
                continue;
            }
            const docUri = AstUtils.getDocument(current)?.uri.toString();
            if (!docUri || visitedDocs.has(current)) return undefined;
            visitedDocs.add(current);
            for (const includeDirective of this.includeContexts.get(docUri) ?? []) {
                const owner = includeDirective.$container;
                if (!owner) continue;
                const found = this.ancestorOfKind(owner, isKind, visitedDocs);
                if (found) return found;
            }
            return undefined;
        }
        return undefined;
    }

    /**
     * Adds a single element to the result set if allowed, with fallback to ContainerInstance/SoftwareSystemInstance
     */
    private addLeafElementWithInstanceFallback(el: NamedElement, res: Set<RelationshipMember | Relationship>, isAllowed: (item: NamedElement | undefined) => item is RelationshipMember): void {
        if (isAllowed(el)) {
            res.add(el as RelationshipMember);
        } else if (isContainer(el)) {
            this.elements.forEach(inst => {
                if (isContainerInstance(inst) && this.el(inst.container.ref) === el && isAllowed(inst)) {
                    res.add(inst as RelationshipMember);
                }
            });
        } else if (isSoftwareSystem(el)) {
            this.elements.forEach(inst => {
                if (isSoftwareSystemInstance(inst) && this.el(inst.softwareSystem.ref) === el && isAllowed(inst)) {
                    res.add(inst as RelationshipMember);
                }
            });
        }
    }

    /**
     * Adds an element, group or relationship reference to an expression result. A
     * relationship identifier also brings every implied relationship linked to it, and a
     * group expands to its leaf-level elements.
     */
    private addReferenceToResult(
        reference: NamedElement | Relationship | Group,
        res: Set<RelationshipMember | Relationship>,
        isAllowed: (el: NamedElement | undefined) => el is RelationshipMember
    ): void {
        if (isRelationship(reference)) {
            res.add(reference);
            for (const wrapper of this.collectAllRelationships()) {
                if (wrapper.linked === reference) res.add(wrapper.relationship);
            }
        } else if (isGroup(reference)) {
            this.leafElementsOfGroup(reference).forEach(el => this.addLeafElementWithInstanceFallback(el, res, isAllowed));
        } else {
            this.addLeafElementWithInstanceFallback(reference, res, isAllowed);
        }
    }

    /**
     * Re-parses the content of a quoted view filter. Text without an expression prefix is
     * returned as a single identifier; anything else is parsed as a synthetic document that
     * is never registered. Results are cached by filter text. A filter that references
     * nothing yields an empty result; the validator reports it separately.
     */
    private parseQuotedFilter(value: string | undefined): QuotedFilterParseResult {
        const text = C4Utils.stripQuotes(value);
        if (!text) return { expressions: [], all: false, parserErrors: [] };

        const cached = this.quotedFilterExpressions.get(text);
        if (cached) return cached;

        const parsed = parseQuotedFilterText(this.services.shared, text);
        // The document is never linked, so register its references: they must be
        // resolved from $refText instead of triggering reference resolution.
        for (const expression of parsed.expressions) {
            this.registerQuotedFilterReferences(expression);
        }
        this.quotedFilterExpressions.set(text, parsed);
        return parsed;
    }

    /** Marks every reference inside a quoted-filter expression as unlinked. */
    private registerQuotedFilterReferences(expression: ViewExpression): void {
        for (const node of AstUtils.streamAllContents(expression)) {
            for (const value of Object.values(node)) {
                if (value && typeof value === 'object' && isReference(value)) {
                    this.quotedFilterReferences.add(value);
                }
            }
        }
    }

    /**
     * Resolves an element reference from a view expression. Expressions parsed from
     * quoted filters live in an unlinked in-memory document, so `ref` is resolved
     * from `$refText` against the collected elements first; native expressions fall
     * back to the linked reference.
     */
    private resolveExpressionReference(reference: Reference<NamedElement> | undefined): any {
        if (!reference) return undefined;
        const text = reference.$refText;
        // Quoted-filter references are never linked: resolve from $refText only,
        // otherwise accessing `.ref` logs "Attempted reference resolution ...".
        if (this.quotedFilterReferences.has(reference)) {
            return typeof text === 'string' ? this.findFilterReference(text) : undefined;
        }
        if (typeof text === 'string' && text.length > 0) {
            const match = this.findElementByReferenceText(text);
            if (match) return match;
        }
        return this.el(reference.ref);
    }

    /**
     * Resolves a view-filter reference. Filters address elements and groups by their DSL
     * identifier only, matched without regard to case, as the reference implementation
     * does; an element name is not an identifier.
     */
    private findFilterReference(text: string): NamedElement | Group | undefined {
        const name = C4Utils.stripQuotes(text).trim().toLowerCase();
        if (!name) return undefined;
        const element = this.elements.find(candidate => {
            const id = this.elementId(candidate);
            if (typeof id !== 'string' || id.length === 0) return false;
            return id.toLowerCase() === name || this.qualifiedIdentifier(candidate).toLowerCase() === name;
        });
        if (element) return element;
        return this.groups.find(group => {
            const id = this.elementId(group);
            if (typeof id !== 'string' || id.length === 0) return false;
            return id.toLowerCase() === name || this.qualifiedGroupIdentifier(group).toLowerCase() === name;
        });
    }

    /** Hierarchical identifier of a group: its parent path and its own identifier. */
    private qualifiedGroupIdentifier(group: Group): string {
        const id = this.elementId(group) ?? '';
        const parent = this.el(group.$container);
        const parentPath = parent && !isGroup(parent) ? this.qualifiedIdentifier(parent) : '';
        return parentPath && id ? `${parentPath}.${id}` : id;
    }

    /** Resolves a reference text (identifier, name, or qualified path) to a collected element. */
    private findElementByReferenceText(text: string): NamedElement | undefined {
        const name = C4Utils.stripQuotes(text);
        // The qualified path only identifies an element that declares its own id;
        // for id-less children it would degenerate to the parent's identifier and
        // steal references meant for the parent (e.g. a group).
        const exact = this.elements.find(element => {
            const id = this.elementId(element);
            return id === name
                || C4Utils.stripQuotes(this.displayName(element)) === name
                || (typeof id === 'string' && id.length > 0
                    && this.qualifiedIdentifier(element) === name);
        });
        if (exact) return exact;
        const lastSegment = name.split('.').pop() ?? name;
        return this.elements.find(element =>
            this.elementId(element) === lastSegment
            || C4Utils.stripQuotes(this.displayName(element)) === lastSegment);
    }

    /** Hierarchical identifier of an element, built from its ancestors' ids (groups skipped). */
    private qualifiedIdentifier(element: any): string {
        const parts: string[] = [];
        let current = element;
        while (current && isNamedElement(current)) {
            if (!isGroup(current)) {
                const id = declaredIdentifier(current);
                if (id) {
                    parts.unshift(id);
                }
            }
            let next = this.el(current.$container);
            // A `!element` directive is not a namespace: the extended element is
            // the logical parent for the hierarchical identifier.
            while (next && isElementExtension(next)) {
                next = this.el(this.resolveElementExtensionTarget(next));
            }
            current = next;
        }
        return parts.join('.');
    }

    /**
     * Evaluates a ViewExpression to determine which elements and relationships
     * should be included in a view. Supports Structurizr expression syntax:
     * element references, afferent/efferent couplings, star expressions,
     * direct couplings, binary operators (&&, ||), and element type/technology/tag filtering.
     * The isAllowed type guard narrows the result to RelationshipMember.
     */
    private applyExpression(
        e: ViewExpression,
        elementsAtView: Set<RelationshipMember>,
        relationshipsAtScope: Set<ImpliedRelationship>,
        isAllowed: (el: NamedElement | undefined) => el is RelationshipMember
    ) : Set<RelationshipMember | Relationship> {
        const res = new Set<RelationshipMember | Relationship>();
        // Quoted filter: the grammar wraps the whole filter in a
        // StringLiteralExpression; evaluate the re-parsed content.
        if (isStringLiteralExpression(e)) {
            const parsed = this.parseQuotedFilter(e.value);
            if (parsed.identifier !== undefined) {
                const reference = this.findFilterReference(parsed.identifier)
                    ?? this.relationshipsByIdentifier.get(C4Utils.stripQuotes(parsed.identifier));
                if (reference) this.addReferenceToResult(reference, res, isAllowed);
                return res;
            }
            for (const expression of parsed.expressions) {
                this.applyExpression(expression, elementsAtView, relationshipsAtScope, isAllowed)
                    .forEach(item => res.add(item));
            }
            return res;
        }
        if (isSingleElementExpression(e)) {
            // Normalise to the materialised element before matching.
            const ref = this.resolveExpressionReference(e.element);
            if (ref) {
                this.addReferenceToResult(ref, res, isAllowed);
            } else {
                // Unlinked identifier: fall back to the relationship index.
                const text = e.element?.$refText;
                const relationship = text ? this.relationshipsByIdentifier.get(C4Utils.stripQuotes(text)) : undefined;
                if (relationship) this.addReferenceToResult(relationship, res, isAllowed);
            }
        }
        // BinaryExpression: expr1 && expr2 (intersection) or expr1 || expr2 (union)
        else if (isBinaryExpression(e)) {
            const left = this.applyExpression(e.left, elementsAtView, relationshipsAtScope, isAllowed);
            const right = this.applyExpression(e.right, elementsAtView, relationshipsAtScope, isAllowed);
            if (e.operator === '||') {
                left.forEach(item => res.add(item));
                right.forEach(item => res.add(item));
            } else if (e.operator === '&&') {
                left.forEach(item => {
                    if (right.has(item)) res.add(item);
                });
            }
        }
        // -><identifier|expression>: the specified element(s) plus afferent couplings (incoming relationships)
        if (isAfferentCouplingExpression(e)) {
            const matched = this.applyExpression(e.expr, elementsAtView, relationshipsAtScope, isAllowed);
            matched.forEach(el => {
                if (isRelationshipMember(el) && isAllowed(el)) res.add(el);
            });
            matched.forEach(el => {
                if (isRelationshipMember(el)) {
                    relationshipsAtScope.forEach(r => {
                        if (r.target === el && isAllowed(r.source)) res.add(r.source);
                    });
                }
            });
        }
        // <identifier|expression>->: the specified element(s) plus efferent couplings (outgoing relationships)
        else if (isEfferentCouplingExpression(e)) {
            const matched = this.applyExpression(e.expr, elementsAtView, relationshipsAtScope, isAllowed);
            matched.forEach(el => {
                if (isRelationshipMember(el) && isAllowed(el)) res.add(el);
            });
            matched.forEach(el => {
                if (isRelationshipMember(el)) {
                    relationshipsAtScope.forEach(r => {
                        if (r.source === el && isAllowed(r.target)) res.add(r.target);
                    });
                }
            });
        }
        // -><identifier|expression>->: the specified element(s) plus both afferent and efferent couplings
        else if (isAfferentEfferentExpression(e)) {
            const matched = this.applyExpression(e.expr, elementsAtView, relationshipsAtScope, isAllowed);
            matched.forEach(el => {
                if (isRelationshipMember(el) && isAllowed(el)) res.add(el);
            });
            matched.forEach(el => {
                if (isRelationshipMember(el)) {
                    relationshipsAtScope.forEach(r => {
                        if(r.source === el && isAllowed(r.target)) res.add(r.target);
                        if(r.target === el && isAllowed(r.source)) res.add(r.source);
                    });
                }
            });
        }
        // *-><identifier|expression>: all relationships targeting the specified destination expression
        else if (isStarToElementExpression(e)) {
            const matched = this.applyExpression(e.expr, elementsAtView, relationshipsAtScope, isAllowed);
            matched.forEach(el => {
                if (isRelationshipMember(el) && elementsAtView.has(el)) {
                    relationshipsAtScope.forEach(r => {
                        if (r.target === el && r.source && elementsAtView.has(r.source)) res.add(r.relationship);
                    });
                }
            });
        }
        // <identifier|expression>->*: all relationships originating from the specified source expression
        else if (isStarFromElementExpression(e)) {
            const matched = this.applyExpression(e.expr, elementsAtView, relationshipsAtScope, isAllowed);
            matched.forEach(el => {
                if (isRelationshipMember(el) && elementsAtView.has(el)) {
                    relationshipsAtScope.forEach(r => {
                        if (r.source === el && r.target && elementsAtView.has(r.target)) res.add(r.relationship);
                    });
                }
            });
        }
        // *->*: all relationships (both source and target must be in the view)
        else if (isStarStarExpression(e)) {
            relationshipsAtScope.forEach(r => {
                if (elementsAtView.has(r.source) && elementsAtView.has(r.target)) res.add(r.relationship);
            });
        }
        // relationship==source->target: all relationships between the two specified expression sets
        else if (isDirectCouplingExpression(e)) {
            const sources = this.applyExpression(e.sourceExpr, elementsAtView, relationshipsAtScope, isAllowed);
            const targets = this.applyExpression(e.targetExpr, elementsAtView, relationshipsAtScope, isAllowed);
            sources.forEach(src => {
                targets.forEach(tgt => {
                    if (isRelationshipMember(src) && isRelationshipMember(tgt) && elementsAtView.has(src) && elementsAtView.has(tgt)) {
                        relationshipsAtScope.forEach(r => {
                            if (r.source === src && r.target === tgt) res.add(r.relationship);
                        });
                    }
                });
            });
        }
        // element==->expr: the specified element(s) (or groups) plus afferent couplings
        else if (isElementEqAfferentExpression(e)) {
            const matched = this.applyExpression(e.expr, elementsAtView, relationshipsAtScope, isAllowed);
            matched.forEach(el => {
                if (isGroup(el)) {
                    this.leafElementsOfGroup(el).forEach(ge => {
                        this.addLeafElementWithInstanceFallback(ge, res, isAllowed);
                        relationshipsAtScope.forEach(r => {
                            if (r.target === ge && isAllowed(r.source)) res.add(r.source);
                        });
                    });
                } else if (isRelationshipMember(el) && isAllowed(el)) {
                    res.add(el);
                    relationshipsAtScope.forEach(r => {
                        if (r.target === el && isAllowed(r.source)) res.add(r.source);
                    });
                }
            });
        }
        // element==<identifier|expression>->: the specified element(s) (or groups) plus efferent couplings
        else if (isElementEqEfferentExpression(e)) {
            const matched = this.applyExpression(e.expr, elementsAtView, relationshipsAtScope, isAllowed);
            matched.forEach(el => {
                if (isGroup(el)) {
                    this.leafElementsOfGroup(el).forEach(ge => {
                        this.addLeafElementWithInstanceFallback(ge, res, isAllowed);
                        relationshipsAtScope.forEach(r => {
                            if(r.source === ge && isAllowed(r.target)) res.add(r.target);
                        });
                    });
                } else if (isRelationshipMember(el) && isAllowed(el)) {
                    res.add(el);
                    relationshipsAtScope.forEach(r => {
                        if(r.source === el && isAllowed(r.target)) res.add(r.target);
                    });
                }
            });
        }
        // element==-><identifier|expression>->: the specified element(s) (or groups) plus afferent and efferent couplings
        else if (isElementEqAfferentEfferentExpression(e)) {
            const matched = this.applyExpression(e.expr, elementsAtView, relationshipsAtScope, isAllowed);
            matched.forEach(el => {
                if (isGroup(el)) {
                    this.leafElementsOfGroup(el).forEach(ge => {
                        this.addLeafElementWithInstanceFallback(ge, res, isAllowed);
                        relationshipsAtScope.forEach(r => {
                            if(r.source === ge && isAllowed(r.target)) res.add(r.target);
                            if(r.target === ge && isAllowed(r.source)) res.add(r.source);
                        });
                    });
                } else if (isRelationshipMember(el) && isAllowed(el)) {
                    res.add(el);
                    relationshipsAtScope.forEach(r => {
                        if(r.source === el && isAllowed(r.target)) res.add(r.target);
                        if(r.target === el && isAllowed(r.source)) res.add(r.source);
                    });
                }
            });
        }
        // element==<identifier|expression>: the specified element(s) or the leaves of the specified group(s)
        else if (isElementEqExpression(e)) {
            // `element==*` selects the default elements of the view and is applied by the
            // view resolvers, which know what the default elements of the view type are.
            if (!e.expr) return res;
            const matched = this.applyExpression(e.expr, elementsAtView, relationshipsAtScope, isAllowed);
            matched.forEach(el => {
                if (isGroup(el)) {
                    this.leafElementsOfGroup(el).forEach(ge => this.addLeafElementWithInstanceFallback(ge, res, isAllowed));
                } else if (isRelationshipMember(el) && isAllowed(el)) {
                    res.add(el);
                }
            });
        }
        // element!=<identifier|expression>: every element except the specified element(s) or group leaves
        else if (isElementNotEqExpression(e)) {
            const excluded = new Set<any>();
            this.applyExpression(e.expr, elementsAtView, relationshipsAtScope, isAllowed).forEach(el => {
                if (isGroup(el)) this.leafElementsOfGroup(el).forEach(ge => excluded.add(ge));
                else excluded.add(el);
            });
            this.elements.forEach(el => {
                if (!excluded.has(el) && isRelationshipMember(el) && isAllowed(el)) res.add(el);
            });
        }
        // element.type==<type>: elements of the specified type (Person, SoftwareSystem, Container, Component, DeploymentNode, InfrastructureNode, SoftwareSystemInstance, ContainerInstance, Custom)
        else if (isElementTypeExpression(e)) {
            this.elements.forEach(el => {
                // Compare element $type with the specified value
                const elType = el.$type;
                if (elType?.toLowerCase() === e.type.toLowerCase()) {
                    if(isAllowed(el)) res.add(el);
                }
            });
        }
        // element.parent==<identifier>: elements with the specified parent
        else if (isElementParentExpression(e)) {
            const parentRef = this.resolveExpressionReference(e.element);
            if (parentRef) this.elements.forEach(el => {
                const elParent = this.parentOf(el);
                if (elParent === parentRef || this.getId(elParent) === this.getId(parentRef)) {
                    if (isAllowed(el)) res.add(el);
                }
            });
        }
        // element.tag==<tag>[,tag]: all elements that have all of the specified tags
        // element.tag!=<tag>[,tag]: all elements that do not have all of the specified tags
        else if (isElementTagExpression(e)) {
            const searchTags = e.values.map(t => C4Utils.stripQuotes(t));
            this.elements.forEach(el => {
                const elTags = this.tagsOf(el);
                const hasAllTags = searchTags.every(st => elTags.includes(st));
                const matches = e.operator === '==' ? hasAllTags : !hasAllTags;
                if (matches && isAllowed(el)) res.add(el);
            });
        }
        // element.technology==<technology>: all elements with the specified technology
        // element.technology!=<technology>: all elements without the specified technology
        else if (isElementTechnologyExpression(e)) {
            const searchTech = C4Utils.stripQuotes(e.value);
            this.elements.forEach(el => {
                const elTech = this.technology(el) || '';
                const matches = e.operator === '==' ? elTech === searchTech : elTech !== searchTech;
                if (matches && isAllowed(el)) res.add(el);
            });
        }
        // element.properties[name]==value: all elements that have the specified property with the specified value
        else if (isElementPropertiesExpression(e)) {
            const propName = C4Utils.stripQuotes(e.name);
            const propValue = C4Utils.stripQuotes(e.value);
            this.elements.forEach(el => {
                const props = this.firstProperties(el);
                if (props) {
                    const match = props.items.find(item =>
                        C4Utils.stripQuotes(item.name) === propName &&
                        C4Utils.stripQuotes(item.value) === propValue
                    );
                    if (match && isAllowed(el)) res.add(el);
                }
            });
        }
        // element.group==name
        else if (isElementGroupExpression(e)) {
            const searchGroup = C4Utils.stripQuotes(e.value);
            this.elements.forEach(el => {
                const elGroup = this.extractGroup(el) || '';
                if (elGroup === searchGroup && isAllowed(el)) res.add(el);
            });
        }
        // relationship.tag==<tag>[,tag]: all relationships that have all of the specified tags
        // relationship.tag!=<tag>[,tag]: all relationships that do not have all of the specified tags
        else if (isRelationshipTagExpression(e)) {
            const searchTags = e.values.map(t => C4Utils.stripQuotes(t));
            relationshipsAtScope.forEach(r => {
                const relTags = this.tagsOfRelationship(r.relationship);
                // An implied relationship has no tags of its own, so the tag is also
                // read from the linked relationship.
                const linkedTags = r.linked ? this.tagsOfRelationship(r.linked) : [];
                const hasAllTags = searchTags.every(st => relTags.includes(st) || linkedTags.includes(st));
                const matches = e.operator === '==' ? hasAllTags : !hasAllTags;
                if (matches) {
                    if(elementsAtView.has(r.source) && elementsAtView.has(r.target)) res.add(r.relationship);
                }
            });
        }
        // relationship.source==<identifier>: all relationships with the specified source element
        else if (isRelationshipSourceExpression(e)) {
            const source = this.resolveExpressionReference(e.element);
            if (source && elementsAtView.has(source)) relationshipsAtScope.forEach(r => {
                if (r.source === source && elementsAtView.has(r.target)) res.add(r.relationship);
            });
        }
        // relationship.destination==<identifier>: all relationships with the specified destination element
        else if (isRelationshipDestinationExpression(e)) {
            const destination = this.resolveExpressionReference(e.element);
            if (destination && elementsAtView.has(destination)) relationshipsAtScope.forEach(r => {
                if (r.target === destination && elementsAtView.has(r.source)) res.add(r.relationship);
            });
        }
        // relationship.properties[name]==value: all relationships that have the specified property with the specified value
        else if (isRelationshipPropertiesExpression(e)) {
            const propName = C4Utils.stripQuotes(e.name);
            const propValue = C4Utils.stripQuotes(e.value);
            relationshipsAtScope.forEach(r => {
                // Mirror the vendor's ExpressionParser.hasProperty: match the
                // relationship's own properties first, then fall back to the linked
                // (source) relationship. For an implied relationship r.relationship is
                // a synthetic node without properties and r.linked is the real AST
                // relationship it derives from.
                const matched = this.relationshipHasProperty(r.relationship, propName, propValue)
                    || this.relationshipHasProperty(r.linked, propName, propValue);
                if (matched && elementsAtView.has(r.source) && elementsAtView.has(r.target)) {
                    res.add(r.relationship);
                }
            });
        }
        // relationship==* | relationship==<id>->* | relationship==*-><id> | relationship==<id1>-><id2>
        // relationship==*: all relationships
        // relationship==<identifier>->*: all relationships with the specified source element
        // relationship==*-><identifier>: all relationships with the specified destination element
        // relationship==<identifier>-><identifier>: all relationships between the two specified elements
        else if (isRelationshipEqExpression(e)) {
            // relationship==* and relationship==*->*: all relationships
            if (e.all === '*' || (e.starSource === '*' && e.starTarget === '*')) {
                relationshipsAtScope.forEach(r => {
                    if(elementsAtView.has(r.source) && elementsAtView.has(r.target)) res.add(r.relationship);
                });
            }
            // relationship==*-><id>: all relationships targeting the specified element
            else if (e.starSource === '*') {
                const t = this.resolveExpressionReference(e.target);
                if (t && elementsAtView.has(t)) relationshipsAtScope.forEach(r => {
                    if (r.target === t && elementsAtView.has(r.source)) res.add(r.relationship);
                });
            }
            // relationship==<id>->*: all relationships originating from the specified source
            else if (e.starTarget === '*') {
                const s = this.resolveExpressionReference(e.source);
                if (s && elementsAtView.has(s)) relationshipsAtScope.forEach(r => {
                    if (r.source === s && elementsAtView.has(r.target)) res.add(r.relationship);
                });
            }
            // relationship==<id1>-><id2>: a specific relationship between two elements
            else {
                const s = this.resolveExpressionReference(e.source);
                const t = this.resolveExpressionReference(e.target);
                if (s && elementsAtView.has(s) && t && elementsAtView.has(t)) relationshipsAtScope.forEach(r => {
                    if (r.source === s && r.target === t) res.add(r.relationship);
                });
            }
        }
        return res;
    }

    // =========================================================================
    // !elements and !relationships directive support
    // =========================================================================

    /**
     * Resolves elements matching a ViewExpression in the global scope.
     * Unlike applyExpression(), this works on all collected elements (this.elements)
     * without view or relationship scope constraints.
     */
    private resolveElementsFromExpression(expression: ViewExpression): NamedElement[] {
        const result = new Set<NamedElement>();
        // Build a full relationship set for coupling resolution
        const allRels = this.allRelationshipsSet();

        // Collect all elements as pass-through (no scope filtering)
        const allElements = this.allRelationshipMembers();

        // isAllowed: all elements are allowed in global scope
        const isAllowed = (el: NamedElement | undefined): el is RelationshipMember =>
            !!el && isRelationshipMember(el);

        const matches = this.applyExpression(expression, allElements, allRels, isAllowed);
        matches.forEach(item => {
            if (isNamedElement(item)) {
                result.add(item as NamedElement);
            }
        });

        return Array.from(result);
    }

    /**
     * Resolves relationships matching a ViewExpression in the global scope.
     * This method evaluates relationship-specific expressions (relationship.tag==,
     * relationship.source==, relationship.destination==, relationship.properties[]==,
     * relationship==*) against all collected relationships.
     */
    private resolveRelationshipsFromExpression(expression: ViewExpression): Relationship[] {
        const result = new Set<Relationship>();
        const allRels = this.allRelationshipsSet();
        const allElements = this.allRelationshipMembers();

        const isAllowed = (el: NamedElement | undefined): el is RelationshipMember =>
            !!el && isRelationshipMember(el);

        const matches = this.applyExpression(expression, allElements, allRels, isAllowed);
        matches.forEach(item => {
            if (isRelationship(item)) {
                result.add(item);
            }
        });

        return Array.from(result);
    }

    /**
     * Applies tags, url, properties, and perspectives from an !elements directive
     * to all matched elements. Uses overlay maps to avoid mutating AST nodes.
     */
    private applyElementsExtension(extension: ElementsDirective): void {
        const matched = this.resolveElementsFromExpression(extension.expression);
        for (const el of matched) {
            const elId = this.getId(el);
            let overlay = this.elementOverlays.get(elId);
            if (!overlay) {
                overlay = {};
                this.elementOverlays.set(elId, overlay);
            }

            // Apply description (overwrites the element description)
            if (extension.descriptionProps && extension.descriptionProps.length > 0) {
                overlay.description = C4Utils.stripQuotes(extension.descriptionProps[0].value) || overlay.description;
            }

            // Apply technology (overwrites the element technology)
            if (extension.techProps && extension.techProps.length > 0) {
                overlay.technology = C4Utils.stripQuotes(extension.techProps[0].value) || overlay.technology;
            }

            // Apply tags (merge with existing)
            if (extension.tagsProps && extension.tagsProps.length > 0) {
                const newTags: string[] = [];
                for (const tagProp of extension.tagsProps) {
                    for (const v of tagProp.values) {
                        const stripped = C4Utils.stripQuotes(v);
                        if (stripped) {
                            for (const t of stripped.split(',')) {
                                const trimmed = t.trim();
                                if (trimmed) newTags.push(trimmed);
                            }
                        }
                    }
                }
                if (newTags.length > 0) {
                    overlay.tags = [...(overlay.tags || []), ...newTags];
                }
            }

            // Apply url
            if (extension.urlProps && extension.urlProps.length > 0) {
                const urlProp = extension.urlProps[0];
                overlay.url = C4Utils.stripQuotes(urlProp.value) || overlay.url;
            }

            // Apply properties (merge)
            const overlayProps = this.propertiesToRecord(extension.properties);
            if (overlayProps) {
                if (!overlay.properties) overlay.properties = {};
                Object.assign(overlay.properties, overlayProps);
            }

            // Apply perspectives
            if (extension.perspectivesBlocks && extension.perspectivesBlocks.length > 0) {
                overlay.perspectives = this.perspectivesToJson(extension.perspectivesBlocks);
            }
        }

        // Relationships declared inside !elements are created for every matched
        // source/target combination; `this` stands for the matched elements.
        if (extension.relationships && extension.relationships.length > 0) {
            for (const declared of extension.relationships) {
                const sources = this.elementsDirectiveMembers(declared, 'source', matched);
                const targets = this.elementsDirectiveMembers(declared, 'target', matched);
                for (const source of sources) {
                    for (const target of targets) {
                        if (source === target) continue;
                        const synthetic = this.createElementDirectiveRelationship(declared, source, target);
                        this.relationships.push(synthetic);
                    }
                }
            }
            // Synthetic relationships are relationship-derived state like any other:
            // rebuild the source index through the single standard path instead of
            // patching it incrementally at the mutation site.
            this.buildRelationshipsBySource();
            this.invalidateAllRelationships();
        }
    }

    /**
     * Matched elements for one side of a relationship declared inside !elements.
     * An implicit source and an endpoint written as `this` (whose reference stays
     * unresolved) both stand for every matched element.
     */
    private elementsDirectiveMembers(relationship: any, side: 'source' | 'target', matched: NamedElement[]): NamedElement[] {
        if (isImplicitRelationship(relationship)) {
            if (side === 'source') return matched;
            return this.isThisEndpoint(relationship.target) ? matched : this.resolveDeclaredMember(relationship.target);
        }
        const reference = side === 'source' ? relationship.source : relationship.target;
        const explicitThis = side === 'source' ? relationship.sourceThis : relationship.targetThis;
        return (explicitThis || this.isThisEndpoint(reference)) ? matched : this.resolveDeclaredMember(reference);
    }

    /** True when an endpoint reference is the `this` keyword. */
    private isThisEndpoint(reference: Reference<NamedElement> | undefined): boolean {
        return this.isThisReference(reference);
    }

    /** Resolves a relationship endpoint reference to a single element, if any. */
    private resolveDeclaredMember(reference: Reference<NamedElement> | undefined): NamedElement[] {
        const ref = reference?.ref;
        return ref ? [this.el(ref)] : [];
    }

    /**
     * Builds a relationship node for one source/target pair declared inside
     * !elements. The declared node's metadata (description, technology, tags,
     * url, properties, perspectives, archetype) is carried over.
     */
    private createElementDirectiveRelationship(declared: any, source: NamedElement, target: NamedElement): Relationship {
        const synthetic: any = {
            $type: 'Relationship',
            $cstNode: declared.$cstNode,
            $container: declared.$container,
            source: { ref: source, $refText: '' },
            target: { ref: target, $refText: '' },
            sourceThis: false,
            targetThis: false,
            description: declared.description,
            technology: declared.technology,
            technologyParts: declared.technologyParts,
            archetype: declared.archetype,
            tagsProps: declared.tagsProps ?? [],
            urlProps: declared.urlProps ?? [],
            properties: declared.properties ?? [],
            perspectivesBlocks: declared.perspectivesBlocks ?? [],
            includes: [],
            scripts: [],
        };
        const doc = AstUtils.getDocument(declared);
        if (doc) synthetic.$document = doc;
        return synthetic as Relationship;
    }

    /**
     * Applies the !relationships directive to all relationships matched by its
     * expression. Uses overlay maps to avoid mutating AST nodes.
     */
    private applyRelationshipsDirective(directive: RelationshipsDirective): void {
        const matched = this.resolveRelationshipsFromExpression(directive.expression);
        for (const rel of matched) {
            const relId = this.getId(rel);
            let overlay = this.relationshipOverlays.get(relId);
            if (!overlay) {
                overlay = {};
                this.relationshipOverlays.set(relId, overlay);
            }
            this.applyRelationshipOverlayValues(overlay, directive);
        }
    }

    /**
     * Applies the !relationship directive to the relationship it targets. Uses the
     * same overlay map as !relationships to avoid mutating AST nodes.
     */
    private applyRelationshipExtension(extension: RelationshipExtension): void {
        const target = extension.target?.ref;
        if (!target) return;
        const relId = this.getId(target);
        let overlay = this.relationshipOverlays.get(relId);
        if (!overlay) {
            overlay = {};
            this.relationshipOverlays.set(relId, overlay);
        }
        this.applyRelationshipOverlayValues(overlay, extension);
    }

    /**
     * Merges tags, url, technology, properties and perspectives declared by a
     * relationship directive into an overlay entry.
     */
    private applyRelationshipOverlayValues(overlay: any, source: any): void {
        // Apply tags (merge)
        if (source.tagsProps && source.tagsProps.length > 0) {
            const newTags: string[] = [];
            for (const tagProp of source.tagsProps) {
                const values = tagProp.values;
                if (Array.isArray(values)) {
                    for (const v of values) {
                        const stripped = C4Utils.stripQuotes(typeof v === 'string' ? v : v.value);
                        if (stripped) {
                            for (const t of stripped.split(',')) {
                                const trimmed = t.trim();
                                if (trimmed) newTags.push(trimmed);
                            }
                        }
                    }
                } else if (typeof values === 'string') {
                    const stripped = C4Utils.stripQuotes(values);
                    if (stripped) {
                        for (const t of stripped.split(',')) {
                            const trimmed = t.trim();
                            if (trimmed) newTags.push(trimmed);
                        }
                    }
                }
            }
            if (newTags.length > 0) {
                overlay.tags = [...(overlay.tags || []), ...newTags];
            }
        }

        // Apply url
        if (source.urlProps && source.urlProps.length > 0) {
            const urlProp = source.urlProps[0];
            overlay.url = C4Utils.stripQuotes(urlProp.value) || overlay.url;
        }

        // Apply technology (overwrites)
        if (source.techProps && source.techProps.length > 0) {
            overlay.technology = C4Utils.stripQuotes(source.techProps[0].value) || overlay.technology;
        }

        // Apply properties (merge)
        const sourceProps = this.propertiesToRecord(source.properties);
        if (sourceProps) {
            if (!overlay.properties) overlay.properties = {};
            Object.assign(overlay.properties, sourceProps);
        }

        // Apply perspectives
        if (source.perspectivesBlocks && source.perspectivesBlocks.length > 0) {
            overlay.perspectives = this.perspectivesToJson(source.perspectivesBlocks);
        }
    }

    /**
     * Invokes the callback for every nested element of a node, across the child
     * collections used by the different element kinds (containers/components live
     * in `elements`, deployment nodes in `children`/`nodes`, instances in their
     * dedicated arrays, groups in `groups`).
     */
    private forEachNestedElement(node: any, callback: (child: AstNode) => void): void {
        for (const key of ['elements', 'groups', 'nodes', 'children',
            'infrastructureNodes', 'softwareSystemInstances', 'containerInstances', 'genericInstances']) {
            const value = node[key];
            if (!Array.isArray(value)) continue;
            for (const child of value) {
                if (child && typeof child === 'object' && typeof child.$type === 'string') {
                    callback(child);
                }
            }
        }
    }

    /**
     * Traverses the workspace AST (including !includes and the extends chain,
     * base documents first) and processes all !elements directives.
     */
    private processElementsDirectives(node: AstNode | undefined, visited: Set<string> = new Set()): void {
        if (!node) return;

        // Handle C4Document root — step into workspace
        if (isC4Document(node)) {
            if (node.workspaces.at(0)) {
                this.processElementsDirectives(node.workspaces.at(0), visited);
                return;
            }
            if (node.modelBlocks.at(0)) {
                this.processElementsDirectives(node.modelBlocks.at(0), visited);
                return;
            }
        }

        // Handle Workspace — step into the extends parent first (base documents
        // are processed before the extending one, matching the reference loader)
        // and into model blocks
        if (isWorkspace(node)) {
            if (node.extendsUri) {
                const parentWs = this.resolveParentWorkspace(node, node.extendsUri);
                if (parentWs) {
                    const parentDocUri = AstUtils.getDocument(parentWs)?.uri.toString();
                    if (!parentDocUri || !visited.has(parentDocUri)) {
                        if (parentDocUri) visited.add(parentDocUri);
                        this.processElementsDirectives(parentWs, visited);
                    }
                }
            }
            if (node.modelBlocks.at(0)) {
                this.processElementsDirectives(node.modelBlocks.at(0), visited);
            }
            return;
        }

        // Note: visited is used ONLY for !include and extends cycle prevention.
        // Structural recursion (into elements, model blocks) does NOT use visited,
        // because elements within the same document must be traversed freely.

        // The node may be any element/model/workspace root carrying `!elements`
        // directives and `!include`s; read them through a structural shape.
        const anyNode = node as any;

        // Process elementsDirectives found on this node (!elements)
        if (anyNode.elementsDirectives) {
            for (const ext of anyNode.elementsDirectives) {
                this.applyElementsExtension(ext);
            }
        }

        // Recurse into child elements (no visited check — same document traversal)
        this.forEachNestedElement(anyNode, (child) => this.processElementsDirectives(child, visited));

        // Recurse into !include directives (with visited check for cycle prevention)
        if (anyNode.includes) {
            for (const inc of anyNode.includes) {
                if (inc.file) {
                    const includedRoot = this.resolveIncludedRoot(node, inc.file);
                    if (includedRoot) {
                        // Use visited to prevent infinite loops from circular !include
                        const includedDocUri = AstUtils.getDocument(includedRoot)?.uri.toString();
                        if (includedDocUri) {
                            if (visited.has(includedDocUri)) continue;
                            visited.add(includedDocUri);
                        }
                        this.processElementsDirectives(includedRoot, visited);
                    }
                }
            }
        }
    }

    /**
     * Traverses the workspace AST (including !includes / extends) and collects
     * every `!element` (ElementExtension) keyed by its TARGET AST node. The AST
     * is NOT mutated - extraction functions later look up this map and fold the
     * contributed children/overlays into the generated JSON element.
     */
    private collectElementExtensions(node: AstNode | undefined, visited: Set<string> = new Set()): void {
        if (!node) return;

        // Handle C4Document root — step into workspace
        if (isC4Document(node)) {
            if (node.workspaces.at(0)) {
                this.collectElementExtensions(node.workspaces.at(0), visited);
                return;
            }
            if (node.modelBlocks.at(0)) {
                this.collectElementExtensions(node.modelBlocks.at(0), visited);
                return;
            }
        }

        // Handle Workspace — step into the extends parent first (base documents
        // are processed before the extending one, matching the reference loader)
        // and into model blocks
        if (isWorkspace(node)) {
            if (node.extendsUri) {
                const parentWs = this.resolveParentWorkspace(node, node.extendsUri);
                if (parentWs) {
                    const parentDocUri = AstUtils.getDocument(parentWs)?.uri.toString();
                    if (!parentDocUri || !visited.has(parentDocUri)) {
                        if (parentDocUri) visited.add(parentDocUri);
                        this.collectElementExtensions(parentWs, visited);
                    }
                }
            }
            if (node.modelBlocks.at(0)) {
                this.collectElementExtensions(node.modelBlocks.at(0), visited);
            }
            return;
        }

        // The node may be any element/model/workspace root carrying `!element`
        // extensions and `!include`s; read them through a structural shape.
        const anyNode = node as any;

        // Register every ElementExtension on this node by its target AST node.
        if (anyNode.elementExtensions) {
            for (const ext of anyNode.elementExtensions) {
                const target = ext.target?.ref;
                let key: NamedElement | undefined = target;
                // Form 2 (`!element <id>`): `ext.id` is a plain identifier string
                // (not a resolved reference). The docs say it "finds a previously
                // defined element", so resolve that string to the actual AST node
                // (by element id or name) from the already-collected this.elements.
                // this.elements includes elements from ALL documents (the root
                // workspace and every !include fragment), so the extended element
                // can live in a different fragment than the !element itself.
                if (!key && !ext.target && ext.id) {
                    const raw = C4Utils.stripQuotes(String(ext.id));
                    // Resolves the declared id, the name, and the hierarchical
                    // identifier (e.g. `b.c` / `a.b.c` under `!identifiers hierarchical`).
                    const found = this.findElementByReferenceText(raw);
                    if (found) key = found as NamedElement;
                }
                // Deployment environments, deployment nodes and groups are not part
                // of this.elements, so resolve those identifiers against the AST.
                if (!key && !ext.target && ext.id) {
                    const raw = C4Utils.stripQuotes(String(ext.id));
                    const root = AstUtils.getDocument(ext)?.parseResult.value;
                    if (root) {
                        const docUri = AstUtils.getDocument(ext)?.uri.toString();
                        const astTarget = docUri ? this.deploymentTargetsForDoc(docUri, root).byId.get(raw) : undefined;
                        if (astTarget) key = astTarget as NamedElement;
                    }
                }
                // Canonical name form (`!element "DeploymentNode://Live/..."`).
                if (!key && !ext.target && ext.id) {
                    const raw = C4Utils.stripQuotes(String(ext.id));
                    if (raw.includes('://')) {
                        const root = AstUtils.getDocument(ext)?.parseResult.value;
                        const docUri = AstUtils.getDocument(ext)?.uri.toString();
                        const canonical = this.elementsByCanonicalName().get(raw)
                            ?? (root && docUri ? this.deploymentTargetsForDoc(docUri, root).byCanonical.get(raw) : undefined);
                        if (canonical) key = canonical as NamedElement;
                    }
                }
                if (!key) continue;
                const list = this.elementExtensionsByTarget.get(key);
                if (list) {
                    list.push(ext);
                } else {
                    this.elementExtensionsByTarget.set(key, [ext]);
                }
                // description/technology set in the extension body must be visible
                // to description()/technology() at transform time; register them as
                // overlays. Non-overwriting, so an !elements directive processed in
                // an earlier phase still wins when both set the same field.
                if ((ext.descriptionProps && ext.descriptionProps.length > 0)
                    || (ext.techProps && ext.techProps.length > 0)) {
                    const targetId = this.getId(key);
                    if (targetId) {
                        let overlay = this.elementOverlays.get(targetId);
                        if (!overlay) {
                            overlay = {};
                            this.elementOverlays.set(targetId, overlay);
                        }
                        if (overlay.description === undefined && ext.descriptionProps && ext.descriptionProps.length > 0) {
                            overlay.description = C4Utils.stripQuotes(ext.descriptionProps[ext.descriptionProps.length - 1].value) || undefined;
                        }
                        if (overlay.technology === undefined && ext.techProps && ext.techProps.length > 0) {
                            overlay.technology = C4Utils.stripQuotes(ext.techProps[ext.techProps.length - 1].value) || undefined;
                        }
                    }
                }
            }
        }

        // Recurse into child elements (same-document traversal, no visited)
        this.forEachNestedElement(anyNode, (child) => this.collectElementExtensions(child, visited));

        // Recurse into elementExtensions' own children (groups/containers/etc.)
        if (anyNode.elementExtensions) {
            for (const ext of anyNode.elementExtensions) {
                const childArrays: AstNode[][] = [
                    ext.containers, ext.components, ext.nodes, ext.infrastructureNodes,
                    ext.softwareSystemInstances, ext.containerInstances, ext.genericInstances, ext.groups,
                ];
                for (const arr of childArrays) {
                    for (const child of arr) {
                        this.collectElementExtensions(child, visited);
                    }
                }
            }
        }

        // Recurse into !include directives (with visited for cycle prevention)
        if (Array.isArray(anyNode.includes)) {
            for (const inc of anyNode.includes) {
                if (inc.file) {
                    const includedRoot = this.resolveIncludedRoot(node, inc.file);
                    if (includedRoot) {
                        const docUri = AstUtils.getDocument(includedRoot)?.uri.toString();
                        if (docUri) {
                            if (visited.has(docUri)) continue;
                            visited.add(docUri);
                        }
                        this.collectElementExtensions(includedRoot, visited);
                    }
                }
            }
        }
    }

    /**
     * Child elements declared in an ElementExtension body, including the children
     * of groups declared inside the body (recursively) and the elements contributed
     * by `!include` directives in the body. Groups themselves are not model elements
     * in the JSON - only their children carry the group path.
     */
    private extensionChildren(ext: ElementExtension): {
        containers: Container[]; components: Component[]; nodes: DeploymentNode[];
        infrastructureNodes: InfrastructureNode[];
        containerInstances: ContainerInstance[]; softwareSystemInstances: SoftwareSystemInstance[];
        genericInstances: GenericInstance[];
    } {
        const out: {
            containers: Container[]; components: Component[]; nodes: DeploymentNode[];
            infrastructureNodes: InfrastructureNode[];
            containerInstances: ContainerInstance[]; softwareSystemInstances: SoftwareSystemInstance[];
            genericInstances: GenericInstance[];
        } = {
            containers: [], components: [], nodes: [],
            infrastructureNodes: [], containerInstances: [],
            softwareSystemInstances: [], genericInstances: []
        };
        const visitedDocs = new Set<string>();

        const push = (item: any): void => {
            if (isContainer(item)) out.containers.push(item);
            else if (isComponent(item)) out.components.push(item);
            else if (isDeploymentNode(item)) out.nodes.push(item);
            else if (isInfrastructureNode(item)) out.infrastructureNodes.push(item);
            else if (isContainerInstance(item)) out.containerInstances.push(item);
            else if (isSoftwareSystemInstance(item)) out.softwareSystemInstances.push(item);
            else if (isGenericInstance(item)) out.genericInstances.push(item);
            else if (isGroup(item)) collect(item);
        };

        // An ElementExtension and a Group expose their children through different
        // fields, so read the per-type arrays through a structural shape.
        const collectArrays = (host: any): void => {
            (host.containers ?? []).forEach(push);
            (host.components ?? []).forEach(push);
            (host.nodes ?? []).forEach(push);
            (host.infrastructureNodes ?? []).forEach(push);
            (host.containerInstances ?? []).forEach(push);
            (host.softwareSystemInstances ?? []).forEach(push);
            (host.genericInstances ?? []).forEach(push);
            // Groups carry their children in the mixed `elements` collection.
            (host.elements ?? []).forEach(push);
        };

        // A fragment is spliced into the including file, so an `!include` in an
        // `!element` body contributes its elements to the extended element.
        const collectIncludes = (host: any): void => {
            for (const inc of host.includes ?? []) {
                if (!inc.file) continue;
                const root = this.resolveIncludedRoot(inc, inc.file);
                if (!root) continue;
                const docUri = AstUtils.getDocument(root)?.uri.toString();
                if (docUri) {
                    if (visitedDocs.has(docUri)) continue;
                    visitedDocs.add(docUri);
                }
                collectIncluded(root);
            }
        };

        const collectIncluded = (node: any): void => {
            if (isC4Document(node)) {
                if (node.workspaces?.at(0)) {
                    collectIncluded(node.workspaces.at(0));
                    return;
                }
                if (node.modelBlocks?.at(0)) {
                    collectIncluded(node.modelBlocks.at(0));
                    return;
                }
            }
            if (isWorkspace(node)) {
                if (node.modelBlocks?.at(0)) {
                    collectIncluded(node.modelBlocks.at(0));
                }
                return;
            }
            collectArrays(node);
            collectIncludes(node);
        };

        const collect = (scope: ElementExtension | Group): void => {
            const host = scope as any;
            collectArrays(host);
            collectIncludes(host);
            for (const group of host.groups ?? []) collect(group);
        };
        collect(ext);
        return out;
    }

    /**
     * Folds children/overlays contributed by `!element` directives into a
     * generated JSON element. `jsonElement` is a Structurizr-compatible element
     * object (e.g. from transformContainer/extractSystems), `astElement` is the
     * AST node it was built from. Looks up elementExtensionsByTarget and merges:
     *  - child elements (containers/components/nodes/infrastructureNodes/
     *    instances/groups) into the matching arrays,
     *  - relationships,
     *  - overlay fields (tags/url/properties/technology/description/...).
     */
    private applyElementExtensions(jsonElement: any, astElement: NamedElement | undefined): void {
        if (!astElement) return;
        const exts = this.elementExtensionsByTarget.get(astElement);
        if (!exts || exts.length === 0) return;

        for (const ext of exts) {
            // Child elements declared in the extension body, including the
            // children of groups declared inside the body (groups are not
            // emitted to the JSON; only their children carry the group path).
            const children = this.extensionChildren(ext);

            // Child containers (target is a SoftwareSystem) -> json.containers
            if (children.containers.length > 0) {
                const list = children.containers.map(c => this.transformContainer(c));
                jsonElement.containers = (jsonElement.containers ?? []).concat(list);
            }
            // Child components (target is a Container) -> json.components
            if (children.components.length > 0) {
                const list = children.components.map(c => {
                    const json: any = {
                        id: this.getId(c),
                        name: this.substitute(c.name),
                        description: this.description(c),
                        documentation: {},
                        technology: this.technology(c),
                        group: this.extractGroup(c),
                        tags: this.extractTags(c, 'Element', 'Component'),
                        url: this.url(c),
                        relationships: this.onlyIfNotEmpty(this.relationshipsOwnedBy(c).map(el => this.relationshipToJson(el)))
                    };
                    this.applyElementOverlay(json, c);
                    this.applyElementExtensions(json, c);
                    return json;
                });
                jsonElement.components = (jsonElement.components ?? []).concat(list);
            }
            // Child deployment nodes (target is a DeploymentNode) -> json.children
            if (children.nodes.length > 0) {
                const list = children.nodes.map(n => {
                    const json = this.transformDeploymentNode(n);
                    this.applyElementOverlay(json, n);
                    return json;
                });
                // Deployment nodes nest under `children` (matching transformDeploymentNode).
                jsonElement.children = (jsonElement.children ?? []).concat(list);
            }
            // Infrastructure nodes -> json.infrastructureNodes
            if (children.infrastructureNodes.length > 0) {
                const list = children.infrastructureNodes.map(infra => this.infrastructureNodeToJson(infra));
                jsonElement.infrastructureNodes = (jsonElement.infrastructureNodes ?? []).concat(list);
            }
            // Child instances (target is a DeploymentNode): `instanceOf` entries
            // materialise as container/software system instances. Interleave them
            // in source order, matching the reference parser's addition order
            // (which drives instanceId assignment).
            const instancesWithSource = [
                ...children.containerInstances.map((ci: any) => ({ node: ci, offset: ci.$cstNode?.offset ?? 0 })),
                ...children.genericInstances.map((gi: any) => ({ node: this.el(gi), offset: gi.$cstNode?.offset ?? 0 })),
                ...children.softwareSystemInstances.map((ssi: any) => ({ node: ssi, offset: ssi.$cstNode?.offset ?? 0 })),
            ].sort((a: any, b: any) => a.offset - b.offset);
            const containerInstances = instancesWithSource
                .filter((e: any) => isContainerInstance(e.node))
                .map((e: any) => e.node);
            const softwareSystemInstances = instancesWithSource
                .filter((e: any) => isSoftwareSystemInstance(e.node))
                .map((e: any) => e.node);
            if (containerInstances.length > 0) {
                const list = containerInstances
                    .filter((ci: any) => ci.container?.ref !== undefined)
                    .map((ci: any) => this.containerInstanceToJson(ci));
                jsonElement.containerInstances = (jsonElement.containerInstances ?? []).concat(list);
            }
            if (softwareSystemInstances.length > 0) {
                const list = softwareSystemInstances
                    .filter((ssi: any) => ssi.softwareSystem?.ref !== undefined)
                    .map((ssi: any) => this.softwareSystemInstanceToJson(ssi));
                jsonElement.softwareSystemInstances = (jsonElement.softwareSystemInstances ?? []).concat(list);
            }
            // Relationships added inside the extension body. Only implicit ones belong
            // to the extended element; an explicit relationship is already attached to
            // its own source element by collectElementExtensions.
            const bodyRelationships = (ext.relationships ?? []).filter((r: any) => isImplicitRelationship(r));
            if (bodyRelationships.length > 0) {
                const rels = bodyRelationships
                    .map((r: any) => {
                        const source = this.resolveSource(r);
                        const target = this.resolveTarget(r);
                        if (!source || !target) return undefined;
                        return this.relationshipToJson({ relationship: r, linked: undefined, source, target } as ImpliedRelationship);
                    })
                    .filter(Boolean);
                jsonElement.relationships = this.onlyIfNotEmpty((jsonElement.relationships ?? []).concat(rels));
            }
            // Overlay fields (tags/url/properties) — reusing the same merge as !elements.
            const overlayMods = this.collectExtensionOverlay(ext);
            if (overlayMods) {
                this.applyOverlayMods(jsonElement, overlayMods);
            }
        }
    }

    /** Extracts overlay-style modifications from an ElementExtension body. */
    private collectExtensionOverlay(ext: ElementExtension): {
        tags?: string[]; url?: string; properties?: Record<string, string>; perspectives?: any[];
    } | undefined {
        let mods: { tags?: string[]; url?: string; properties?: Record<string, string>; perspectives?: any[] } | undefined;

        if (Array.isArray(ext.tagsProps) && ext.tagsProps.length > 0) {
            const tags: string[] = [];
            for (const tp of ext.tagsProps) {
                for (const tag of tp.values ?? []) {
                    const t = C4Utils.stripQuotes(String(tag));
                    if (t) tags.push(t);
                }
            }
            if (tags.length > 0) { mods ??= {}; mods.tags = tags; }
        }
        const urlProp = ext.urlProps.at(-1);
        if (urlProp?.value) {
            mods ??= {};
            mods.url = C4Utils.stripQuotes(String(urlProp.value));
        }
        // Properties lines accumulate; on a key collision the later line wins,
        // matching the reference parser's per-line setProperty.
        if (ext.properties.length > 0) {
            const props: Record<string, string> = {};
            for (const line of ext.properties) {
                for (const item of line.items) {
                    const name = C4Utils.stripQuotes(String(item?.name ?? ''));
                    const value = C4Utils.stripQuotes(String(item?.value ?? ''));
                    if (name) props[name] = value;
                }
            }
            if (Object.keys(props).length > 0) { mods ??= {}; mods.properties = props; }
        }
        return mods;
    }

    /** Applies collected overlay mods to a JSON element (shared with !elements). */
    private applyOverlayMods(jsonElement: any, mods: { tags?: string[]; url?: string; properties?: Record<string, string>; perspectives?: any[] }): void {
        if (mods.tags) {
            // `tags` is a comma-separated string in the emitted JSON (extractTags
            // joins with ','), and every consumer splits it: the renderer calls
            // element.tags.split(',') and the MCP model does the same. Joining here
            // keeps the overlay path (!element / !elements) byte-identical to the
            // extractTags path; assigning an array would make .split() throw.
            const existing = typeof jsonElement.tags === 'string'
                ? jsonElement.tags.split(',').map((t: string) => t.trim()).filter(Boolean)
                : [];
            const merged = Array.from(new Set(existing.concat(mods.tags)));
            jsonElement.tags = merged.length > 0 ? merged.join(',') : undefined;
        }
        if (mods.url !== undefined) jsonElement.url = mods.url;
        if (mods.properties) {
            jsonElement.properties = { ...(jsonElement.properties ?? {}), ...mods.properties };
        }
    }

    /**
     * Traverses the workspace AST (including !includes and the extends chain,
     * base documents first) and processes all !relationships directives.
     */
    private processRelationshipsDirectives(node: AstNode | undefined, visited: Set<string> = new Set()): void {
        if (!node) return;

        // Handle C4Document root — step into workspace
        if (isC4Document(node)) {
            if (node.workspaces.at(0)) {
                this.processRelationshipsDirectives(node.workspaces.at(0), visited);
                return;
            }
            if (node.modelBlocks.at(0)) {
                this.processRelationshipsDirectives(node.modelBlocks.at(0), visited);
                return;
            }
        }

        // Handle Workspace — step into the extends parent first (base documents
        // are processed before the extending one, matching the reference loader)
        // and into model blocks
        if (isWorkspace(node)) {
            if (node.extendsUri) {
                const parentWs = this.resolveParentWorkspace(node, node.extendsUri);
                if (parentWs) {
                    const parentDocUri = AstUtils.getDocument(parentWs)?.uri.toString();
                    if (!parentDocUri || !visited.has(parentDocUri)) {
                        if (parentDocUri) visited.add(parentDocUri);
                        this.processRelationshipsDirectives(parentWs, visited);
                    }
                }
            }
            if (node.modelBlocks.at(0)) {
                this.processRelationshipsDirectives(node.modelBlocks.at(0), visited);
            }
            return;
        }

        // Note: visited is used ONLY for !include and extends cycle prevention.

        // The node may be any element/model/workspace root carrying `!relationships`
        // directives and extensions; read them through a structural shape.
        const anyNode = node as any;

        // Process relationshipsDirectives found on this node
        if (anyNode.relationshipsDirectives) {
            for (const dir of anyNode.relationshipsDirectives) {
                this.applyRelationshipsDirective(dir);
            }
        }

        // Process !relationship directives declared on this element
        if (anyNode.relationshipExtensions) {
            for (const extension of anyNode.relationshipExtensions) {
                this.applyRelationshipExtension(extension);
            }
        }

        // Recurse into child elements (no visited check — same document traversal)
        this.forEachNestedElement(anyNode, (child) => this.processRelationshipsDirectives(child, visited));

        // Recurse into !include directives (with visited check for cycle prevention)
        if (Array.isArray(anyNode.includes)) {
            for (const inc of anyNode.includes) {
                if (inc.file) {
                    const includedRoot = this.resolveIncludedRoot(node, inc.file);
                    if (includedRoot) {
                        const includedDocUri = AstUtils.getDocument(includedRoot)?.uri.toString();
                        if (includedDocUri) {
                            if (visited.has(includedDocUri)) continue;
                            visited.add(includedDocUri);
                        }
                        this.processRelationshipsDirectives(includedRoot, visited);
                    }
                }
            }
        }
    }

    /**
     * Resolves a Component view for a specific Container: determines which
     * elements and relationships should appear on the diagram based on include/exclude.
     * 
     * On a Component diagram:
     * - The scope Container is rendered as a boundary (not a visible element)
     * - All Components belonging to the scope Container are shown
     * - Other Containers from the same SoftwareSystem (boundary only)
     * - External SoftwareSystems, Persons, and CustomElements with relationships
     *   to scope components are shown
     * - The parent SoftwareSystem of the scope Container is rendered as a boundary
     * 
     * The function processes include/exclude operations in declaration order
     * (sorted by CST offset), building the final set of visible elements
     * (elementsAtView) and relationships (relationshipsAtView).
     */
    private resolveComponent(
        view: any,
        elementsAtView: Set<RelationshipMember>,
        relationshipsAtView: Set<Relationship>,
        scopeContainer: Container
    ) {
        const relationshipsAllowed = this.staticRelationshipsSet();

        // scope guard: only Components (belonging to scope), Containers (same system), SoftwareSystems, Persons, CustomElements
        const isAllowed = (element: NamedElement | undefined) : element is (SoftwareSystem | Person | Container | CustomElement) => {
            // Component must belong to the scope Container
            if(isComponent(element)) return this.resolveComponentParent(element) === scopeContainer;
            // the scope Container is not a visible element (rendered as a boundary)
            if(element === scopeContainer) return false;
            // Container must belong to the same parent system as the scope Container
            if(isContainer(element)) {
                const scopeContainerParent = this.resolveContainerParent(scopeContainer);
                const containerParent = this.resolveContainerParent(element);
                return (scopeContainerParent === containerParent);
            }
            // the parent SoftwareSystem of scope Container is not visible (rendered as a boundary)
            if(isSoftwareSystem(element)) {
                const scopeContainerParent = this.resolveContainerParent(scopeContainer);
                return (element !== scopeContainerParent);
            }
            // other top-level elements (Person, CustomElement) are allowed
            return isPerson(element) || isCustomElement(element);
        };

        const orderedOps = this.getIncludeExclude(view);
        // process include/exclude operations in declaration order
        for (const op of orderedOps) {
            const prop = op.prop;
            const isInclude = isIncludeProperty(prop);

            if (isInclude && this.selectsAllElements(prop)) {

                // add all Components belonging to the scope Container
                for (const el of this.componentsOfContainer(scopeContainer)) {
                    elementsAtView.add(el);
                }

                // add any external element that has a relationship with an already visible component
                const include = new Set<RelationshipMember>();
                for (const r of relationshipsAllowed) {
                    if (r.target && elementsAtView.has(r.target) && isAllowed(r.source)) include.add(r.source);
                    if (r.source && elementsAtView.has(r.source) && isAllowed(r.target)) include.add(r.target);
                }
                include.forEach(el => elementsAtView.add(el));

                // add relationships between visible elements
                relationshipsAllowed.forEach(r => {
                    if (elementsAtView.has(r.source) && elementsAtView.has(r.target)) relationshipsAtView.add(r.relationship);
                });
            }

            // process explicit expression-based include/exclude directives
            prop.expressions.forEach((expr: { expression: ViewExpression; }) => {
                // `*` and `element==*` are applied by the include branch above.
                if (this.isAllElementsExpression(expr.expression)) return;
                const res = this.applyExpression(expr.expression, elementsAtView, relationshipsAllowed, isAllowed);
                if (res) {
                    // update relationship visibility based on element changes
                    relationshipsAllowed.forEach(r => {
                        if (isInclude) {
                            if (elementsAtView.has(r.source) && res.has(r.target)) relationshipsAtView.add(r.relationship);
                            if (elementsAtView.has(r.target) && res.has(r.source)) relationshipsAtView.add(r.relationship);
                            if (res.has(r.target) && res.has(r.source)) relationshipsAtView.add(r.relationship);
                        } else if (res.has(r.source) || res.has(r.target)) relationshipsAtView.delete(r.relationship);
                    });
                    res.forEach(e => {
                        if (isRelationshipMember(e)) {
                            isInclude ? elementsAtView.add(e) : elementsAtView.delete(e);
                        } else if (isRelationship(e)) {
                            this.applyRelationshipVisibility(e, isInclude, elementsAtView, relationshipsAtView);
                        }
                    });
                }
            });
        }
        this.filterDuplicateRelationships(relationshipsAtView);
    }

    /**
     * Resolves a Container view for a specific SoftwareSystem: determines which
     * elements and relationships should appear on the diagram based on include/exclude.
     * 
     * On a Container diagram:
     * - The scope SoftwareSystem is rendered as a boundary (not a visible element)
     * - All Containers belonging to the scope SoftwareSystem are shown
     * - External SoftwareSystems, Persons, and CustomElements with relationships
     *   to scope containers are shown
     * - Components are never displayed directly
     * 
     * The function processes include/exclude operations in declaration order
     * (sorted by CST offset), building the final set of visible elements
     * (elementsAtView) and relationships (relationshipsAtView).
     */
    private resolveContainer(
        view: any,
        elementsAtView: Set<RelationshipMember>,
        relationshipsAtView: Set<Relationship>,
        scopeSoftwareSystem: SoftwareSystem
    ) {
        // collect all implied relationships for all elements in the model (shared, read-only)
        const relationshipsAllowed = this.allRelationshipsSet();

        // scope guard: only Containers (belonging to scope), SoftwareSystems, Persons, and CustomElements
        // the scope SoftwareSystem itself is excluded (it's rendered as a boundary cluster instead)
        const isAllowed = (element: NamedElement | undefined) : element is (SoftwareSystem | Person | Container | CustomElement) => {
            // Container must belong to the scope SoftwareSystem
            if(isContainer(element)) return this.resolveContainerParent(element) === scopeSoftwareSystem;
            // the scope SoftwareSystem is not a visible element (rendered as a boundary)
            if(element === scopeSoftwareSystem) return false;
            // other top-level elements (SoftwareSystem, Person, CustomElement) are allowed
            return (isSoftwareSystem(element) || isPerson(element) || isCustomElement(element));
        };

        // process include/exclude operations in declaration order
        const orderedOps = this.getIncludeExclude(view);        
        for (const op of orderedOps) {
            const prop = op.prop;
            const isInclude = isIncludeProperty(prop);

            if (isInclude && this.selectsAllElements(prop)) {
                // add all Containers belonging to the scope SoftwareSystem
                for (const el of this.containersOfSystem(scopeSoftwareSystem)) {
                    elementsAtView.add(el);
                }

                // add any external element that has a relationship with an already visible container
                const include = new Set<RelationshipMember>();
                for (const r of relationshipsAllowed) {
                    if (elementsAtView.has(r.target) && isAllowed(r.source)) include.add(r.source);
                    if (elementsAtView.has(r.source) && isAllowed(r.target)) include.add(r.target);
                }
                include.forEach(el => elementsAtView.add(el));

                // add relationships between visible elements
                relationshipsAllowed.forEach(r => {
                    if (elementsAtView.has(r.source) && elementsAtView.has(r.target)) relationshipsAtView.add(r.relationship);
                });
            }

            // process explicit expression-based include/exclude directives
            prop.expressions.forEach((expr: { expression: ViewExpression; }) => {
                // `*` and `element==*` are applied by the include branch above.
                if (this.isAllElementsExpression(expr.expression)) return;
                const res = this.applyExpression(expr.expression, elementsAtView, relationshipsAllowed, isAllowed);
                if (res) {
                    // update relationship visibility based on element changes
                    relationshipsAllowed.forEach(r => {
                        if (isInclude) {
                            if (elementsAtView.has(r.source) && res.has(r.target)) relationshipsAtView.add(r.relationship);
                            if (elementsAtView.has(r.target) && res.has(r.source)) relationshipsAtView.add(r.relationship);
                            if (res.has(r.target) && res.has(r.source)) relationshipsAtView.add(r.relationship);
                        } else if (res.has(r.source) || res.has(r.target)) relationshipsAtView.delete(r.relationship);
                    });
                    // update element visibility
                    res.forEach(e => {
                        if (isRelationshipMember(e)) {
                            isInclude ? elementsAtView.add(e) : elementsAtView.delete(e);
                        } else if (isRelationship(e)) {
                            this.applyRelationshipVisibility(e, isInclude, elementsAtView, relationshipsAtView);
                        }
                    });
                }
            });
        }
        this.filterDuplicateRelationships(relationshipsAtView);
    }

    /**
     * Resolves a Custom view: determines which custom elements and relationships
     * should appear on the diagram based on include/exclude directives.
     * 
     * On a Custom diagram, only CustomElement instances are shown.
     * CustomElements can have relationships with each other.
     * No SoftwareSystems, Persons, Containers, Components, or Deployment elements
     * are displayed directly.
     * 
     * The function processes include/exclude operations in declaration order
     * (sorted by CST offset), building the final set of visible elements
     * (elementsAtView) and relationships (relationshipsAtView).
     */
    private resolveCustom(
        view: any,
        elementsAtView: Set<RelationshipMember>,
        relationshipsAtView: Set<Relationship>
    ) {
        // collect all relationships for custom elements (shared, read-only)
        const relationshipsAllowed = this.customRelationshipsSet();

        // scope guard: only CustomElements are allowed on Custom diagrams
        const isInScope = (element: NamedElement | undefined) : element is CustomElement => isCustomElement(element);

        // process include/exclude operations in declaration order
        const orderedOps = this.getIncludeExclude(view);        
        for (const op of orderedOps) {
            const prop = op.prop;
            const isInclude = isIncludeProperty(prop);

            if (isInclude && this.selectsAllElements(prop)) {
                // add all CustomElements
                const include = new Set<RelationshipMember>();
                this.elements.filter(isInScope).forEach(el => include.add(el));
                // add relationships between included and already visible custom elements
                relationshipsAllowed.forEach(rel => {
                    const relSource = this.resolveSource(rel.relationship);
                    const relTarget = this.resolveTarget(rel.relationship);
                    if(relTarget && relSource) {
                        if(elementsAtView.has(relSource) && include.has(relTarget)) relationshipsAtView.add(rel.relationship);
                        if(elementsAtView.has(relTarget) && include.has(relSource)) relationshipsAtView.add(rel.relationship);
                        if(include.has(relTarget) && include.has(relSource)) relationshipsAtView.add(rel.relationship);
                    }
                });
                include.forEach(el => elementsAtView.add(el));
            }

            // process explicit expression-based include/exclude directives
            prop.expressions.forEach((expr: { expression: ViewExpression; }) => {
                // `*` and `element==*` are applied by the include branch above.
                if (this.isAllElementsExpression(expr.expression)) return;
                const res = this.applyExpression(expr.expression, elementsAtView, relationshipsAllowed, isInScope);
                if(res) {
                    // update relationship visibility based on element changes
                    relationshipsAllowed.forEach(r => {
                        if (r.target && r.source) {
                            if (isInclude) {
                                if (elementsAtView.has(r.source) && res.has(r.target)) relationshipsAtView.add(r.relationship);
                                if (elementsAtView.has(r.target) && res.has(r.source)) relationshipsAtView.add(r.relationship);
                                if (res.has(r.target) && res.has(r.source)) relationshipsAtView.add(r.relationship);
                            } else if (res.has(r.source) || res.has(r.target)) relationshipsAtView.delete(r.relationship);
                        }
                    });
                    // update element visibility
                    res.forEach(e => {
                        if(isRelationshipMember(e)) {
                            isInclude ? elementsAtView.add(e) : elementsAtView.delete(e);
                        } else if(isRelationship(e)) {
                            this.applyRelationshipVisibility(e, isInclude, elementsAtView, relationshipsAtView);
                        }
                    });
                }
            });
        }
        this.filterDuplicateRelationships(relationshipsAtView);
    }

    /**
     * Resolves a System Context view for a specific SoftwareSystem:
     * determines which elements and relationships should appear on the diagram
     * based on include/exclude directives.
     * 
     * On a System Context diagram, the following elements are shown:
     * - The scope SoftwareSystem itself (always visible)
     * - Other SoftwareSystems, Persons, and CustomElements that have direct
     *   relationships with the scope SoftwareSystem
     * - Containers, Components, DeploymentNodes etc. are never displayed directly
     * 
     * The function processes include/exclude operations in declaration order
     * (sorted by CST offset), building the final set of visible elements
     * (elementsAtView) and relationships (relationshipsAtView).
     */
    private resolveSystemContext(
        view: SystemContextView,
        elementsAtView: Set<RelationshipMember>,
        relationshipsAtView: Set<Relationship>,
        scopeSoftwareSystem: SoftwareSystem
    ) {
        // collect include/exclude operations sorted by CST offset (declaration order)
        const orderedOps = this.getIncludeExclude(view);

        const rels = this.allRelationshipsSet();

        // A system context view always contains the software system it scopes, even when
        // its include expressions match nothing; exclude operations below can remove it.
        elementsAtView.add(scopeSoftwareSystem);

        // scope guard: only top-level elements (SoftwareSystem, Person, CustomElement) are allowed on System Context
        const isInScope = (element: NamedElement | undefined) : element is (SoftwareSystem | Person | CustomElement) => {
            return (isSoftwareSystem(element) || isPerson(element) || isCustomElement(element));
        };

        // process include/exclude operations in declaration order
        for (const op of orderedOps) {
            const prop = op.prop;
            const isInclude = isIncludeProperty(prop);

            if (isInclude && this.selectsAllElements(prop)) {
                // add the scope SoftwareSystem to the diagram
                elementsAtView.add(scopeSoftwareSystem);

                // add any top-level element that has a direct relationship with the scope system
                for (const r of rels) {
                    if (r.source === scopeSoftwareSystem) {
                        if (isInScope(r.target)) elementsAtView.add(r.target);
                    } else if (r.target === scopeSoftwareSystem) {
                        if (isInScope(r.source)) elementsAtView.add(r.source);
                    }
                }

                // add relationships between visible elements
                rels.forEach(r => {
                    if (elementsAtView.has(r.source) && elementsAtView.has(r.target)) relationshipsAtView.add(r.relationship);
                });
            }

            // process explicit expression-based include/exclude directives
            prop.expressions.forEach((expr: { expression: ViewExpression; }) => {
                // `*` and `element==*` are applied by the include branch above.
                if (this.isAllElementsExpression(expr.expression)) return;
                const res = this.applyExpression(expr.expression, elementsAtView, rels, isInScope);
                if (res) {
                    // update relationship visibility based on element changes
                    rels.forEach(r => {
                        if (isInclude) {
                            if (elementsAtView.has(r.source) && res.has(r.target)) relationshipsAtView.add(r.relationship);
                            if (elementsAtView.has(r.target) && res.has(r.source)) relationshipsAtView.add(r.relationship);
                            if (res.has(r.target) && res.has(r.source)) relationshipsAtView.add(r.relationship);
                        } else if (res.has(r.source) || res.has(r.target)) relationshipsAtView.delete(r.relationship);
                    });
                    // update element visibility
                    res.forEach(e => {
                        if (isRelationshipMember(e)) {
                            // The scope software system cannot be removed from its system context view.
                            if (!isInclude && e === scopeSoftwareSystem) return;
                            isInclude ? elementsAtView.add(e) : elementsAtView.delete(e);
                        } else if (isRelationship(e)) {
                            this.applyRelationshipVisibility(e, isInclude, elementsAtView, relationshipsAtView);
                        }
                    });
                }
            });

        }
        this.filterDuplicateRelationships(relationshipsAtView);
    }

    /** True when the directive selects the default elements of the view: `*` or `element==*`. */
    private selectsAllElements(prop: IncludeProperty | ExcludeProperty): boolean {
        if (isIncludeProperty(prop) && prop.all === '*') return true;
        const expressions = prop.expressions ?? [];
        return expressions.length === 1 && this.isAllElementsExpression(expressions[0].expression);
    }

    /** True for `*` and `element==*`, which stand for the default elements of the view. */
    private isAllElementsExpression(expression: ViewExpression | undefined): boolean {
        if (!expression) return false;
        if (isElementEqExpression(expression)) return expression.all === '*';
        if (!isStringLiteralExpression(expression)) return false;
        const text = C4Utils.stripQuotes(expression.value).trim();
        return text === '*' || text === 'element==*';
    }

    /**
     * Collects all include and exclude directives for a view in declaration order.
     * 
     * CST offsets are NOT comparable across different files, so we avoid sorting
     * cross-file directives together. Instead, we use a two-pointer merge:
     * 
     * 1. Sort the view's own includeProps/excludeProps by CST offset (same file)
     * 2. Sort the !include directives by CST offset (same file)
     * 3. Walk both sorted lists simultaneously:
     *    - When a local include/exclude comes first → emit it
     *    - When a !include comes first → resolve the file and recursively emit
     *      its includes/excludes in-place at that position
     * 
     * @param view The view AST node or any AST node that has includeProps/excludeProps/includes
     * @param visited Set of already-visited document URIs to prevent infinite loops
     * @returns Array of {isInclude, prop} in declaration order
     */
    private getIncludeExclude(view: any, visited: Set<string> = new Set()) {
        const result: Array<{ isInclude: boolean, prop: IncludeProperty | ExcludeProperty }> = [];

        // sort the view's own include/exclude directives by CST offset
        const localOps: Array<{ isInclude: boolean; prop: IncludeProperty | ExcludeProperty; offset: number }> = [];
        for (const include of view.includeProps || []) {
            localOps.push({ isInclude: true, prop: include, offset: include.$cstNode?.offset ?? 0 });
        }
        for (const exclude of view.excludeProps || []) {
            localOps.push({ isInclude: false, prop: exclude, offset: exclude.$cstNode?.offset ?? 0 });
        }
        localOps.sort((a, b) => a.offset - b.offset);

        // collect !include directives sorted by CST offset
        const includes: Array<{ directive: any; offset: number }> = [];
        if (view.includes && Array.isArray(view.includes)) {
            for (const inc of view.includes) {
                if (inc.file) {
                    includes.push({ directive: inc, offset: inc.$cstNode?.offset ?? 0 });
                }
            }
        }
        includes.sort((a, b) => a.offset - b.offset);

        // merge local directives and !include files in declaration order
        let localIdx = 0;
        let inclIdx = 0;
        while (localIdx < localOps.length || inclIdx < includes.length) {
            const local = localIdx < localOps.length ? localOps[localIdx] : null;
            const incl = inclIdx < includes.length ? includes[inclIdx] : null;

            // emit whichever has the smaller offset (they are in the same file)
            if (local && (!incl || local.offset <= incl.offset)) {
                result.push({ isInclude: local.isInclude, prop: local.prop });
                localIdx++;
            } else if (incl) {
                // resolve the !include file and recursively collect its directives
                const includedRoot = this.resolveIncludedRoot(view, incl.directive.file);
                if (includedRoot) {
                    const docUri = AstUtils.getDocument(includedRoot)?.uri.toString();
                    if (!docUri || !visited.has(docUri)) {
                        if (docUri) visited.add(docUri);
                        const childOps = this.getIncludeExclude(includedRoot, visited);
                        for (const childOp of childOps) {
                            result.push(childOp);
                        }
                    }
                }
                inclIdx++;
            }
        }

        return result;
    }

    /**
     * Resolves a System Landscape view: determines which elements and relationships
     * should appear on the diagram based on include/exclude directives.
     * 
     * On a System Landscape diagram, only top-level elements are shown:
     * SoftwareSystem and Person are always visible (if included). CustomElement
     * is only visible if it has a relationship to an already visible element.
     * Containers, Components, DeploymentNodes etc. are never displayed directly.
     * 
     * The function processes include/exclude operations in declaration order
     * (sorted by CST offset), building the final set of visible elements
     * (elementsAtView) and relationships (relationshipsAtView).
     */
    private resolveSystemLandscape(
        view: any,
        elementsAtView: Set<RelationshipMember>,
        relationshipsAtView: Set<Relationship>
    ) {
        const relationshipsAllowed = this.allRelationshipsSet();

        // scope guard: only top-level elements (SoftwareSystem, Person, CustomElement) are allowed on System Landscape
        const isAllowed = (element: NamedElement | undefined) : element is (SoftwareSystem | Person | CustomElement) => isSoftwareSystem(element) || isPerson(element) || isCustomElement(element);

        // process include/exclude operations in declaration order
        const orderedOps = this.getIncludeExclude(view);
        for (const op of orderedOps) {
            const prop = op.prop;
            const isInclude = isIncludeProperty(prop);

            if (isInclude && this.selectsAllElements(prop)) {
                // add all SoftwareSystem and Person elements (top-level only)
                this.elements.forEach(el => {
                    if(isSoftwareSystem(el) || isPerson(el)) elementsAtView.add(el);
                });
                
                // add any CustomElement that has a relationship with an already visible element
                const include = new Set<RelationshipMember>();
                for (const r of relationshipsAllowed) {
                    if (elementsAtView.has(r.target) && isAllowed(r.source)) include.add(r.source);
                    if (elementsAtView.has(r.source) && isAllowed(r.target)) include.add(r.target);
                }
                include.forEach(el => elementsAtView.add(el));

                // add relationships between visible elements
                relationshipsAllowed.forEach(r => {
                    if (elementsAtView.has(r.source) && elementsAtView.has(r.target)) relationshipsAtView.add(r.relationship);
                });
            }

            // process explicit expression-based include/exclude directives
            prop.expressions.forEach((expr: { expression: ViewExpression; }) => {
                // `*` and `element==*` are applied by the include branch above.
                if (this.isAllElementsExpression(expr.expression)) return;
                const res = this.applyExpression(expr.expression, elementsAtView, relationshipsAllowed, isAllowed);
                if(res) {
                    // update relationship visibility based on element changes
                    relationshipsAllowed.forEach(r => {
                        if (isInclude) {
                            if (elementsAtView.has(r.source) && res.has(r.target)) relationshipsAtView.add(r.relationship);
                            if (elementsAtView.has(r.target) && res.has(r.source)) relationshipsAtView.add(r.relationship);
                            if (res.has(r.target) && res.has(r.source)) relationshipsAtView.add(r.relationship);
                        } else if (res.has(r.source) || res.has(r.target)) relationshipsAtView.delete(r.relationship);
                    });
                    // update element visibility
                    res.forEach(e => {
                        if(isRelationshipMember(e)) {
                            isInclude ? elementsAtView.add(e) : elementsAtView.delete(e);
                        } else if(isRelationship(e)) {
                            this.applyRelationshipVisibility(e, isInclude, elementsAtView, relationshipsAtView);
                        }
                    });
                }
            });
        }
        this.filterDuplicateRelationships(relationshipsAtView);
    }

    /**
     * Resolves a Deployment view for a specific environment (and optionally
     * a SoftwareSystem): determines which deployment elements and relationships
     * should appear on the diagram based on include/exclude directives.
     * 
     * On a Deployment diagram, the following elements are shown:
     * - DeploymentNodes and InfrastructureNodes matching the environment
     * - SoftwareSystemInstances and ContainerInstances in the environment
     *   (optionally filtered by a specific SoftwareSystem)
     * - CustomElements (if they have relationships)
     * - SoftwareSystems, Persons, Containers, Components are never displayed directly
     * 
     * The function processes include/exclude operations in declaration order
     * (sorted by CST offset), building the final set of visible elements
     * (elementsAtView) and relationships (relationshipsAtView).
     */
    private collectDeploymentParents(el: any, elementsAtView: Set<RelationshipMember>, environment?: string): void {
        const seen = new Set<string>();
        const addParent = (node: any) => {
            if (!node || seen.has(this.getId(node))) return;
            seen.add(this.getId(node));
            // Only add DeploymentNode (they have IDs in the AST).
            // Groups are not added — their children use the 'group' attribute instead
            if (isDeploymentNode(node)) {
                if (!environment || this.getEnvironment(node) === environment) {
                    elementsAtView.add(node as RelationshipMember);
                }
            }
        };
        // 1. Climb the direct $container chain (inline elements)
        let current: any = el.$container;
        while (current) {
            if (isDeploymentEnvironment(current)) break;
            // An element contributed via `!element` is parented by the extended
            // element, not by the directive.
            if (isElementExtension(current)) {
                current = this.resolveElementExtensionTarget(current);
                continue;
            }
            addParent(current);
            if (isDeploymentNode(current)) break; // only Groups above DeploymentNode, stop here
            current = current.$container;
        }
        // 2. Fallback for !include: find the Include directive and climb from there
        const docUri = AstUtils.getDocument(el)?.uri.toString();
        if (docUri) {
            const includes = this.includeContexts.get(docUri);
            if (includes) {
                for (const inc of includes) {
                    current = inc.$container;
                    while (current) {
                        if (isDeploymentEnvironment(current)) break;
                        addParent(current);
                        if (isDeploymentNode(current)) break;
                        current = current.$container;
                    }
                }
            }
        }
    }

    /**
     * Resolves elements and relationships for a DeploymentView within a given environment
     * and optional SoftwareSystem scope. Collects deployment nodes, infrastructure nodes,
     * software system instances, and container instances matching the environment,
     * then resolves their relationships within the deployment context.
     */
    /**
     * Deployment-model elements (nodes, infrastructure nodes, instances, custom
     * elements) with their environment, used to resolve deployment views.
     */
    private deploymentIndex: { elements: NamedElement[]; environmentOf: Map<NamedElement, string | undefined> } | undefined;

    private deploymentElements(): { elements: NamedElement[]; environmentOf: Map<NamedElement, string | undefined> } {
        if (this.deploymentIndex) return this.deploymentIndex;
        const elements: NamedElement[] = [];
        const environmentOf = new Map<NamedElement, string | undefined>();
        for (const el of this.elements) {
            if (isDeploymentNode(el) || isInfrastructureNode(el) || isSoftwareSystemInstance(el) || isContainerInstance(el) || isCustomElement(el)) {
                elements.push(el);
                environmentOf.set(el, this.getEnvironment(el));
            }
        }
        this.deploymentIndex = { elements, environmentOf };
        return this.deploymentIndex;
    }

    /** Environment of a deployment element, from the index built by {@link deploymentElements}. */
    private deploymentEnvironmentOf(el: NamedElement): string | undefined {
        return this.deploymentElements().environmentOf.get(el);
    }

    private resolveDeployment(
        view: DeploymentView,
        elementsAtView: Set<RelationshipMember>,
        relationshipsAtView: Set<Relationship>,
        environment?: string,
        softwareSystem?: SoftwareSystem
    ) {
        // collect all relationships for deployment elements matching the environment
        const rels = new Set<ImpliedRelationship>();
        for (const el of this.deploymentElements().elements) {
            if (isDeploymentNode(el)) {
                if (!environment || environment === this.deploymentEnvironmentOf(el)) this.extractRelationshipsForDeploymentNode(el).forEach(r => rels.add(r));
            } else if (isInfrastructureNode(el)) {
                if (!environment || environment === this.deploymentEnvironmentOf(el)) this.extractRelationshipsForInfrastructureNode(el).forEach(r => rels.add(r));
            } else if (isSoftwareSystemInstance(el)) {
                if (!environment || environment === this.deploymentEnvironmentOf(el)) this.extractRelationshipsForSoftwareSystemInstance(el).forEach(r => rels.add(r));
            } else if (isContainerInstance(el)) {
                if (!environment || environment === this.deploymentEnvironmentOf(el)) this.extractRelationshipsForContainerInstance(el).forEach(r => rels.add(r));
            } else if(isCustomElement(el)) this.extractRelationshipsForCustom(el).forEach(rel => rels.add(rel));
        }

        // scope guard: only deployment elements matching the environment (and optionally softwareSystem) are allowed
        const allowedDocuments = this.allowedViewDocuments(view);
        const isAllowed = (el: NamedElement | undefined) : el is (DeploymentNode | InfrastructureNode | SoftwareSystemInstance | ContainerInstance | CustomElement) => {
            // Elements contributed by a workspace that extends the view's workspace are
            // not visible: the reference resolves views while parsing, so a view only
            // sees the model of its own document and the documents it extends/includes.
            if (!this.isInAllowedDocuments(el, allowedDocuments)) return false;
            // DeploymentNode and InfrastructureNode must match the environment
            if(isDeploymentNode(el) || isInfrastructureNode(el)) {
                return (!environment || environment === this.deploymentEnvironmentOf(el));
            }
            // SoftwareSystemInstance must match environment and optionally the scope SoftwareSystem
            if(isSoftwareSystemInstance(el)) {
                return ((!environment || environment === this.deploymentEnvironmentOf(el)));
            }
            // ContainerInstance must match environment and optionally belong to the scope SoftwareSystem
            if(isContainerInstance(el)) {
                return ((!environment || environment === this.deploymentEnvironmentOf(el)));
            }
            // CustomElement is always allowed
            return isCustomElement(el);
        };

        // process include/exclude operations in declaration order
        const orderedOps = this.getIncludeExclude(view);

        for (const op of orderedOps) {
            const prop = op.prop;
            const isInclude = isIncludeProperty(prop);

            if (isInclude && this.selectsAllElements(prop)) {
                // add all deployment elements matching the environment
                for (const el of this.deploymentElements().elements) {
                    if (!this.isInAllowedDocuments(el, allowedDocuments)) continue;
                    if(isDeploymentNode(el) || isInfrastructureNode(el)) {
                        if(!environment || environment === this.deploymentEnvironmentOf(el)) elementsAtView.add(el);
                    }
                    if(isSoftwareSystemInstance(el)) {
                        if ((!environment || environment === this.deploymentEnvironmentOf(el)) && (!softwareSystem || softwareSystem === this.el(el.softwareSystem.ref))) elementsAtView.add(el);
                    }
                    if(isContainerInstance(el)) {
                        if ((!environment || environment === this.deploymentEnvironmentOf(el)) && (!softwareSystem || (el.container.ref !== undefined && this.resolveContainerParent(el.container.ref) === softwareSystem))) elementsAtView.add(el);
                    }
                }

                // add any additional element that has a relationship with an already visible element
                const include = new Set<RelationshipMember>();
                for (const r of rels) {
                    if (elementsAtView.has(r.target) && isAllowed(r.source)) include.add(r.source);
                    if (elementsAtView.has(r.source) && isAllowed(r.target)) include.add(r.target);
                }
                include.forEach(el => elementsAtView.add(el));

                // add relationships between visible elements
                rels.forEach(r => {
                    if (elementsAtView.has(r.source) && elementsAtView.has(r.target)) relationshipsAtView.add(r.relationship);
                });
            }

            // process explicit expression-based include/exclude directives
            prop.expressions.forEach((expr: { expression: ViewExpression; }) => {
                // `*` and `element==*` are applied by the include branch above.
                if (this.isAllElementsExpression(expr.expression)) return;
                const res = this.applyExpression(expr.expression, elementsAtView, rels, isAllowed);
                if(res) {
                    // update relationship visibility based on element changes
                    rels.forEach(r => {
                        if (isInclude) {
                            if (elementsAtView.has(r.source) && res.has(r.target)) relationshipsAtView.add(r.relationship);
                            if (elementsAtView.has(r.target) && res.has(r.source)) relationshipsAtView.add(r.relationship);
                            if (res.has(r.target) && res.has(r.source)) relationshipsAtView.add(r.relationship);
                        } else if (res.has(r.source) || res.has(r.target)) relationshipsAtView.delete(r.relationship);
                    });
                    // update element visibility
                    res.forEach(e => {
                        if(isRelationshipMember(e)) {
                            isInclude ? elementsAtView.add(e) : elementsAtView.delete(e);
                        } else if(isRelationship(e)) {
                            this.applyRelationshipVisibility(e, isInclude, elementsAtView, relationshipsAtView);
                        }
                    });
                }
            });
        }
        
        // After processing all include/exclude directives, add parent DeploymentNode elements
        const currentElements = Array.from(elementsAtView);
        currentElements.forEach(el => this.collectDeploymentParents(el, elementsAtView, environment));

        // A deployment view cannot show both a software system instance and its
        // container instances (DeploymentView.checkElementCanBeAdded): drop the
        // container instances when their software system instance is visible.
        const visibleSystems = new Set(
            Array.from(elementsAtView)
                .filter(isSoftwareSystemInstance)
                .map(ssi => this.el(ssi.softwareSystem.ref)));
        for (const el of Array.from(elementsAtView)) {
            if (isContainerInstance(el)) {
                const system = el.container.ref ? this.resolveContainerParent(el.container.ref) : undefined;
                if (system && visibleSystems.has(system)) {
                    elementsAtView.delete(el);
                }
            }
        }
        rels.forEach(r => {
            if (!elementsAtView.has(r.source) || !elementsAtView.has(r.target)) {
                relationshipsAtView.delete(r.relationship);
            }
        });

        this.filterDuplicateRelationships(relationshipsAtView);
    }

    /**
     * Resolves the context element for an implicit or source-less relationship.
     * When a relationship is defined as `-> target` (without an explicit source),
     * or uses `sourceThis`/`targetThis`, the actual source/target element must be
     * resolved by climbing up the AST container hierarchy.
     * 
     * The method first attempts to find the parent via `$container` (works when
     * the relationship is defined inside a Container/Component/SoftwareSystem).
     * If that fails (e.g. for relationships in !include files), it falls back to
     * looking up the Include directive that referenced the file and climbs from there.
     * 
     * @param rel The relationship or implicit relationship node
     * @returns The parent element (SoftwareSystem, Container, Component, DeploymentNode,
     *          InfrastructureNode, SoftwareSystemInstance, or ContainerInstance), or undefined
     */
    private resolveContextElement(rel: AstNode): RelationshipMember | undefined {
        // try climbing the AST container chain first (works for inline relationships)
        let parent: AstNode | undefined = rel.$container;
        while (parent) {
            // A relationship declared directly inside an `!element` block is
            // contexted by the extended element, not by the directive.
            if (isElementExtension(parent)) {
                parent = this.resolveElementExtensionTarget(parent);
                continue;
            }
            // check for logical C4 elements
            const el = this.el(parent);
            if (isPerson(el) || isSoftwareSystem(el) || isContainer(el) || isComponent(el) || isCustomElement(el)) {
                return el;
            }
            // check for physical deployment elements
            if (isDeploymentNode(el) ||
                isInfrastructureNode(el) ||
                isSoftwareSystemInstance(el) ||
                isContainerInstance(el)) {
                return el;
            }
            parent = parent.$container;
        }
        
        // fallback: if the relationship is defined in an !include file, $container
        // points to the root of the included file, not to the parent element.
        // Look up the Include directive that references this file and climb from there.
        const relDocUri = AstUtils.getDocument(rel)?.uri.toString();
        if (relDocUri) {
            const includes = this.includeContexts.get(relDocUri);
            if (includes && includes.length > 0) {
                for (const includeDirective of includes) {
                    parent = includeDirective.$container;
                    while (parent) {
                        if (isPerson(parent) || isSoftwareSystem(parent) || isContainer(parent) || isComponent(parent) || isCustomElement(parent)) {
                            return parent;
                        }
                        if (isDeploymentNode(parent) || 
                            isInfrastructureNode(parent) || 
                            isSoftwareSystemInstance(parent) || 
                            isContainerInstance(parent)) {
                            return parent;
                        }
                        parent = parent.$container;
                    }
                }
            }
        }
        
        return undefined;
    }

    /**
     * Applies an explicitly included/excluded relationship to the view. An
     * included relationship is added only when both resolved endpoints are
     * visible; an excluded relationship is removed unconditionally.
     */
    private applyRelationshipVisibility(
        relationship: Relationship,
        isInclude: boolean,
        elementsAtView: Set<RelationshipMember>,
        relationshipsAtView: Set<Relationship>
    ): void {
        if (!isInclude) {
            relationshipsAtView.delete(relationship);
            return;
        }
        const source = this.resolveSource(relationship);
        const target = this.resolveTarget(relationship);
        if (source && target && elementsAtView.has(source) && elementsAtView.has(target)) {
            relationshipsAtView.add(relationship);
        }
    }

    /**
     * Resolves a view's animation steps. Each step lists the elements that become
     * visible in that frame; a relationship is included when one endpoint appears
     * in the step and the other is already visible. Steps are emitted in
     * declaration order, starting at 1.
     */
    private resolveAnimations(
        view: any,
        elementsAtView: Set<RelationshipMember>,
        relationshipsAtView: Set<Relationship>,
        kind: 'static' | 'custom' | 'deployment'
    ): any[] | undefined {
        const steps = (view.animationProps ?? []).flatMap((prop: any) => prop.steps ?? []);
        if (steps.length === 0) return undefined;

        const shown = new Set<string>();
        const animations: any[] = [];
        let order = 0;

        for (const step of steps) {
            const introduced = new Set<RelationshipMember>();
            for (const wrapper of step.elements ?? []) {
                const expression = wrapper?.expression ?? wrapper;
                const resolved = this.resolveElementsFromExpression(expression);
                const candidates = kind === 'deployment'
                    ? resolved.flatMap(element => this.expandDeploymentAnimationElement(element))
                    : resolved;
                for (const element of candidates) {
                    if (!this.animationAccepts(kind, element)) continue;
                    if (!elementsAtView.has(element as RelationshipMember)) continue;
                    const id = this.getId(element);
                    if (shown.has(id)) continue;
                    introduced.add(element as RelationshipMember);
                    // A deployment step also reveals the enclosing deployment nodes.
                    if (kind === 'deployment') {
                        let node = this.resolveDeploymentNodeParent(element as AstNode);
                        while (node) {
                            if (elementsAtView.has(node as RelationshipMember) && !shown.has(this.getId(node))) {
                                introduced.add(node as RelationshipMember);
                            }
                            node = this.resolveDeploymentNodeParent(node);
                        }
                    }
                }
            }

            const introducedIds = new Set(Array.from(introduced).map(element => this.getId(element)));
            const relationshipIds = new Set<string>();
            for (const relationship of relationshipsAtView) {
                const source = this.resolveSource(relationship);
                const target = this.resolveTarget(relationship);
                if (!source || !target) continue;
                const sourceId = this.getId(source);
                const targetId = this.getId(target);
                const sourceVisible = introducedIds.has(sourceId) || shown.has(sourceId);
                const targetVisible = introducedIds.has(targetId) || shown.has(targetId);
                if (sourceVisible && targetVisible && (introducedIds.has(sourceId) || introducedIds.has(targetId))) {
                    relationshipIds.add(this.getId(relationship));
                }
            }

            order += 1;
            animations.push({
                order,
                elements: Array.from(introducedIds).sort(),
                relationships: relationshipIds.size > 0 ? Array.from(relationshipIds).sort() : undefined
            });

            for (const id of introducedIds) shown.add(id);
        }

        return animations;
    }

    /** Whether an element can take part in an animation step of the given view kind. */
    private animationAccepts(kind: 'static' | 'custom' | 'deployment', element: any): boolean {
        if (kind === 'custom') return isCustomElement(element);
        if (kind === 'deployment') {
            return isSoftwareSystemInstance(element) || isContainerInstance(element) || isInfrastructureNode(element);
        }
        return isPerson(element) || isSoftwareSystem(element) || isContainer(element) || isComponent(element);
    }

    /**
     * In a deployment view an animation step naming a software system or container
     * stands for its instances.
     */
    private expandDeploymentAnimationElement(element: NamedElement): NamedElement[] {
        if (!isSoftwareSystem(element) && !isContainer(element)) {
            return [element];
        }
        if (this.instancesByElement === undefined) {
            const index = new Map<NamedElement, NamedElement[]>();
            for (const instance of this.deploymentInstances()) {
                const reference = isSoftwareSystemInstance(instance)
                    ? instance.softwareSystem?.ref
                    : isContainerInstance(instance) ? instance.container?.ref : undefined;
                const resolved = this.el(reference);
                if (!resolved) continue;
                const list = index.get(resolved);
                if (list === undefined) index.set(resolved, [instance]);
                else list.push(instance);
            }
            this.instancesByElement = index;
        }
        return this.instancesByElement.get(element) ?? [];
    }

    /** Deployment instances grouped by the element they instantiate, in element order. */
    private instancesByElement: Map<NamedElement, NamedElement[]> | undefined;

    /**
     * Removes duplicate relationships from a set. For pairs sharing the same source,
     * target and description, only the relationship with the lowest CST offset
     * (declared earliest in source code) is kept; the model parser rejects exact
     * duplicates anyway. Relationships between the same pair with different
     * descriptions are distinct and are all kept.
     * @param relationshipsSet The set of relationships to filter for duplicates
     */
    private filterDuplicateRelationships(relationshipsSet: Set<Relationship>): void {
        // Map: "sourceId|targetId|description" -> relationship with the smallest offset
        const bestPerPair = new Map<string, Relationship>();

        for (const rel of relationshipsSet) {
            const source = this.resolveSource(rel);
            const target = this.resolveTarget(rel);
            if (!source || !target) continue;

            const sourceId = this.getId(source);
            const targetId = this.getId(target);
            const key = `${sourceId}|${targetId}|${this.description(rel)}`;

            const existing = bestPerPair.get(key);
            if (!existing) {
                bestPerPair.set(key, rel);
            } else {
                const existingOffset = existing.$cstNode?.offset ?? Number.MAX_SAFE_INTEGER;
                const currentOffset = rel.$cstNode?.offset ?? Number.MAX_SAFE_INTEGER;
                if (currentOffset < existingOffset) {
                    // Remove the existing (later) relationship, keep the new (earlier) one
                    relationshipsSet.delete(existing);
                    bestPerPair.set(key, rel);
                } else {
                    // Remove the current (later) relationship, keep the existing (earlier) one
                    relationshipsSet.delete(rel);
                }
            }
        }
    }    

    /** Maps shorthand autolayout direction codes (lr, rl, bt, tb) to Structurizr PascalCase format. */
    private mapDirection(dir?: string): string {
        switch (dir?.toLowerCase()) {
            case 'lr': return 'LeftRight';
            case 'rl': return 'RightLeft';
            case 'bt': return 'BottomTop';
            case 'tb': return 'TopBottom';
            default:
                // Structurizr autoLayout default direction is TopBottom.
                return 'TopBottom';
        }
    }

    /**
     * Extracts System Context views from the workspace. Each view is scoped to a SoftwareSystem
     * and includes that system, its direct relationships, and related people/systems.
     */
    private extractSystemContextViews(workspace: Workspace, model: any) {
        const views = this.workspaceViews(workspace).filter(isSystemContextView)
        .map(view => {
            // Normalise the scope to the materialised element.
            const scopeSystem = this.el(view.softwareSystem?.ref);
            if(scopeSystem === undefined) return undefined;
            const elements = new Set<RelationshipMember>();
            const relationships = new Set<Relationship>();
            this.resolveSystemContext(view, elements, relationships, scopeSystem);
            return {
                softwareSystemId: this.getId(scopeSystem),
                name: this.viewName(view),
                key: this.substitute(this.services.workspace.ViewKeyProvider.getKey(view)),
                ...this.viewOrderFields(view),
                title: this.substitute(view.titleProps?.at(0)?.value),
                description: this.description(view),
                properties: this.viewProperties(view),
                elements: this.onlyIfNotEmpty(Array.from(elements).map(el => this.elementJson(el))),
                relationships: this.onlyIfNotEmpty(Array.from(relationships).map(rel => this.relationshipViewJson(rel))),
                enterpriseBoundaryVisible: true,
                automaticLayout: this.transformAutoLayout(view),
                // Transient: consumed by applyGraphvizAutoLayouts in the plugin.
                ...this.graphvizFields(view, this.transformAutoLayout(view), scopeSystem, false, elements, relationships),
                animations: this.resolveAnimations(view, elements, relationships, 'static'),
            };
        });
        return views && views?.length > 0 ? views : undefined; 
    }    

    /**
     * Extracts Container views from the workspace for a given SoftwareSystem scope.
     * Resolves all container-level elements and their relationships within the system.
     */
    private extractContainerViews(workspace: Workspace, model: any) {
        const views = this.workspaceViews(workspace).filter(isContainerView)
            .map(view => {
                const scopeSystem = this.el(view.softwareSystem?.ref);
                if(scopeSystem === undefined) return undefined;
                let elements = new Set<RelationshipMember>();
                let relationships = new Set<Relationship>();
                this.resolveContainer(view, elements, relationships, scopeSystem);
                return {
                    softwareSystemId: this.getId(scopeSystem),
                    name: this.viewName(view),
                    key: this.substitute(this.services.workspace.ViewKeyProvider.getKey(view)),
                    ...this.viewOrderFields(view),
                    externalSoftwareSystemBoundariesVisible: false,
                    title: this.substitute(view.titleProps?.at(0)?.value),
                    description: this.description(view),
                    properties: this.viewProperties(view),
                    elements: this.onlyIfNotEmpty(Array.from(elements).map(el => this.elementJson(el))),// elements,,
                    relationships: this.onlyIfNotEmpty(Array.from(relationships).map(rel => this.relationshipViewJson(rel))),
                    automaticLayout: this.transformAutoLayout(view),
                    // Transient: consumed by applyGraphvizAutoLayouts in the plugin.
                    ...this.graphvizFields(view, this.transformAutoLayout(view), scopeSystem, true, elements, relationships),
                    animations: this.resolveAnimations(view, elements, relationships, 'static'),
                }
            });
        return views && views.length > 0 ? views : undefined;
    }

    /**
     * Extracts Component views from the workspace, scoped to a specific Container.
     * Shows the components within a container, their relationships, and related people/systems.
     */
    private extractComponentViews(workspace: Workspace, model: any) {
        const views = this.workspaceViews(workspace).filter(isComponentView)
            .map(view => {
                const scopeContainer = this.el(view.container?.ref);
                if(scopeContainer === undefined) return undefined;
                const elements = new Set<RelationshipMember>();
                const relationships = new Set<Relationship>();
                this.resolveComponent(view, elements, relationships, scopeContainer);
                return {
                    containerId: this.getId(scopeContainer),
                    name: this.viewName(view),
                    key: this.substitute(this.services.workspace.ViewKeyProvider.getKey(view)),
                    ...this.viewOrderFields(view),
                    externalContainerBoundariesVisible: false,
                    title: this.substitute(view.titleProps?.at(0)?.value),
                    description: this.description(view),
                    properties: this.viewProperties(view),
                    elements: this.onlyIfNotEmpty(Array.from(elements).map(el => this.elementJson(el))),// elements,,
                    relationships: this.onlyIfNotEmpty(Array.from(relationships).map(rel => this.relationshipViewJson(rel))),
                    automaticLayout: this.transformAutoLayout(view),
                    // Transient: consumed by applyGraphvizAutoLayouts in the plugin.
                    ...this.graphvizFields(view, this.transformAutoLayout(view), scopeContainer, true, elements, relationships),
                    animations: this.resolveAnimations(view, elements, relationships, 'static'),
                };
            });
        return views && views.length > 0 ? views : undefined;
    }

    /**
     * Resolves the deployment environment name for a deployment-related element by climbing
     * the AST $container chain. For !include files, looks up the Include directive context
     * since $container points to the document root rather than the logical parent.
     */
    private getEnvironment(deploymentNode: AstNode): string | undefined {
        const parent = deploymentNode.$container;
        if(parent) {
            if(isDeploymentEnvironment(parent)) {
                return C4Utils.stripQuotes(parent.name);
            }
            if(isDeploymentNode(parent) || isSoftwareSystemInstance(parent) || isContainerInstance(parent) || isInfrastructureNode(parent) || isGroup(parent)) {
                return this.getEnvironment(parent);
            }
            // A node contributed by `!element` is parented by the ElementExtension;
            // continue from the extended element to inherit its environment.
            if (isElementExtension(parent)) {
                const target = this.resolveElementExtensionTarget(parent);
                if (target && target !== deploymentNode) {
                    if (isDeploymentEnvironment(target)) {
                        return C4Utils.stripQuotes(target.name);
                    }
                    return this.getEnvironment(target);
                }
            }
        }
        
        // Fallback for !include files: find the Include directive that references this file
        const docUri = AstUtils.getDocument(deploymentNode)?.uri.toString();
        if (docUri) {
            const includes = this.includeContexts.get(docUri);
            if (includes && includes.length > 0) {
                for (const includeDirective of includes) {
                    let current: AstNode | undefined = includeDirective.$container;
                    while (current) {
                        if (isDeploymentEnvironment(current)) {
                            return C4Utils.stripQuotes(current.name);
                        }
                        if (isDeploymentNode(current) || isSoftwareSystemInstance(current) || isContainerInstance(current) || isInfrastructureNode(current) || isGroup(current)) {
                            return this.getEnvironment(current);
                        }
                        current = current.$container;
                    }
                }
            }
        }
        
        return undefined;
    }
    
    /**
     * Extracts Deployment views from the workspace, resolving deployment elements
     * (nodes, infrastructure, instances) within a given environment.
     * Optionally scoped to a SoftwareSystem for targeted deployment visualization.
     */
    private extractDeploymentViews(workspace: Workspace, model: any) {
        const views = this.workspaceViews(workspace).filter(isDeploymentView)
            .map(view => {
                const scopeSystem = this.el(view.softwareSystem?.ref);
                const environment = view.environment?.ref ? C4Utils.stripQuotes(view.environment.ref.name) : undefined;
                const elements = new Set<RelationshipMember>();
                const relationships = new Set<Relationship>();
                this.resolveDeployment(view, elements, relationships, environment, scopeSystem);
                return {
                    name: this.viewName(view),
                    key: this.substitute(this.services.workspace.ViewKeyProvider.getKey(view)),
                    ...this.viewOrderFields(view),
                    title: this.substitute(view.titleProps?.at(0)?.value),
                    description: this.description(view),
                    properties: this.viewProperties(view),
                    softwareSystemId: scopeSystem ? this.getId(scopeSystem) : undefined,
                    environment: environment,
                    elements: this.onlyIfNotEmpty(Array.from(elements).map(el => this.elementJson(el))),// elements,,
                    relationships: this.onlyIfNotEmpty(Array.from(relationships).map(rel => this.relationshipViewJson(rel))),
                    automaticLayout: this.transformAutoLayout(view),
                    // Transient: consumed by applyGraphvizAutoLayouts in the plugin.
                    ...this.graphvizFields(view, this.transformAutoLayout(view), undefined, false, elements, relationships),
                    animations: this.resolveAnimations(view, elements, relationships, 'deployment'),
                };
            });
        return views && views.length > 0 ? views : undefined;
    }
    
    /**
     * Extracts Dynamic views from the workspace. Processes sequenced interaction steps
     * between elements with ordering and optional parallel block grouping.
     */
    private extractDynamicViews(workspace: Workspace) {
        const viewsList = this.workspaceViews(workspace);
        if (!Array.isArray(viewsList)) return undefined;
        const views = viewsList
            .filter(isDynamicView)
            .map(view => {
                const scopeElement = this.el(view.element?.ref);
                const content = this.resolveDynamic(view);
                // Dynamic views are always laid out automatically (no manual positions
                // in the DSL), so run them through the same Graphviz pipeline as the
                // other view types. transformAutoLayout returns the DSL parameters or
                // the
                // Structurizr defaults (TopBottom / 300 / 300) when absent.
                const autoLayout = this.transformAutoLayout(view);
                return {
                    name: this.viewName(view),
                    key: this.substitute(this.services.workspace.ViewKeyProvider.getKey(view)),
                    ...this.viewOrderFields(view),
                    title: this.substitute(view.titleProps?.[0]?.value),
                    description: this.description(view),
                    properties: this.viewProperties(view),
                    elementId: scopeElement ? this.getId(scopeElement) : undefined,
                    externalBoundariesVisible: false,
                    elements: this.onlyIfNotEmpty(content.elements),
                    relationships: this.onlyIfNotEmpty(content.relationships),
                    automaticLayout: this.transformAutoLayout(view),
                    // Transient: consumed by applyGraphvizAutoLayouts in the plugin.
                    // Dynamic views use the scope element as a frame
                    // (cluster_<containerId>), so pass scopeAsFrame=true; the scope
                    // cluster is emitted first, then external elements.
                    ...this.graphvizFields(view, autoLayout, scopeElement, true, content.graphvizElements, content.graphvizEdges, true)
                };
            });

        return views.length ? views : undefined;
    }

    /**
     * Extracts Filtered views from the workspace. A filtered view references a base view
     * and filters its elements by tags using either Include or Exclude mode.
     */
    private extractFilteredViews(workspace: Workspace) {
        const allViews = this.workspaceViews(workspace);
        const views = allViews.filter(isFilteredView)
            .map(view => {
                const baseKey = this.substitute(view.baseKey);
                const baseView = allViews.find(candidate =>
                    this.substitute(this.services.workspace.ViewKeyProvider.getKey(candidate)) === baseKey);
                const baseName = baseView ? this.viewName(baseView) : undefined;
                return {
                    name: baseName ? `Filtered: ${baseName}` : undefined,
                    key: this.substitute(this.services.workspace.ViewKeyProvider.getKey(view)),
                    ...this.viewOrderFields(view),
                    baseViewKey: baseKey,
                    mode: view.mode === 'include' ? 'Include' : 'Exclude',
                    tags: this.parseTags(view.tagsProp),
                    title: this.substitute(view.titleProps?.at(0)?.value),
                    description: this.description(view),
                    properties: this.viewProperties(view)
                };
            });
        return views && views?.length > 0 ? views : undefined;
    }
    
    /**
     * Resolves the content of a DynamicView. Traverses interaction steps with sequential ordering,
     * handles parallel step blocks, matches steps against global relationships (detecting both
     * forward and response directions), and collects unique elements appearing in the view.
     */
    private resolveDynamic(view: DynamicView) {
        const steps: any[] = [];
        const uniqueElements = new Set<NamedElement>();
        // Edges for the Graphviz layout graph, one per dynamic step. Each edge is a
        // minimal synthetic relationship (source/target AST refs + the step text)
        // that buildGraphvizDot consumes via resolveSource/resolveTarget. The `id`
        // matches the step's view.relationships[].id so the layout writes vertices
        // back onto the same step entries.
        const graphvizEdges: any[] = [];

        // Global counter for top-level sequential steps
        let globalSequence = 1;

        // Recursive helper for traversing steps (including parallel blocks)
        const traverse = (members: DynamicMember[], currentParallelOrder?: string, isParallelBlock = false) => {
            const blockOrder = currentParallelOrder || globalSequence.toString();

            members.forEach(member => {
                if (isDynamicStep(member)) {
                    // Normalise to the materialised elements used by resolveSource/resolveTarget.
                    const source = this.el(member.from?.ref);
                    const target = this.el(member.target?.ref);
                    if (!source || !target) {
                        // Relationship reference row: the step names an existing model
                        // relationship instead of both endpoints.
                        if (source && !target && isRelationship(source)) {
                            const finalOrder = member.order
                                ? member.order.toString()
                                : isParallelBlock ? blockOrder : (globalSequence++).toString();
                            const stepDescription = this.description(member) ?? this.description(source);
                            steps.push({
                                id: this.getId(source),
                                order: finalOrder,
                                description: stepDescription
                            });
                            const relSource = this.resolveSource(source);
                            const relTarget = this.resolveTarget(source);
                            if (relSource) uniqueElements.add(relSource);
                            if (relTarget) uniqueElements.add(relTarget);
                            const labelText = stepDescription ? `${finalOrder}: ${stepDescription}` : undefined;
                            graphvizEdges.push({
                                id: this.getId(source),
                                source: { ref: relSource },
                                target: { ref: relTarget },
                                description: labelText
                            });
                        }
                        return;
                    }

                    // Register participants on the diagram canvas
                    uniqueElements.add(source);
                    uniqueElements.add(target);

                    // Calculate step order
                    let finalOrder: string;
                    if (member.order) {
                        finalOrder = member.order.toString();
                    } else if (isParallelBlock) {
                        finalOrder = blockOrder;
                    } else {
                        finalOrder = (globalSequence++).toString();
                    }

                    // Find the relationship the step walks along. A step names two
                    // elements, while the model may only relate their ancestors or
                    // descendants, so the lookup covers the emitted relationships -
                    // declared and implied - not just the declared ones.
                    const candidates = this.collectAllRelationships();
                    let modelRel = candidates.find(rel => rel.source === source && rel.target === target)?.relationship;

                    let isResponse = false;

                    // If no direct relationship, look for reverse (response) relationship
                    if (!modelRel) {
                        modelRel = candidates.find(rel => rel.source === target && rel.target === source)?.relationship;

                        if (modelRel) {
                            isResponse = true;
                        }
                    }

                    // If relationship found (direct or reverse), emit the step
                    if (modelRel) {
                        const stepDescription = this.description(member) || (isResponse ? undefined : this.description(modelRel));
                        // `response` is only emitted when the step is a reverse
                        // (response) relationship; the field is omitted from JSON
                        // for forward steps.
                        steps.push({
                            id: this.getId(modelRel),
                            order: finalOrder,
                            description: stepDescription,
                            // A `url` on the step belongs to the relationship view, not the model.
                            url: this.url(member),
                            ...(isResponse ? { response: true } : {})
                        });
                        // Layout edge: direction source -> target of the step, so the
                        // layout places the participants in step order. The
                        // label text mirrors what the webview renders ("N: text").
                        const labelText = stepDescription ? `${finalOrder}: ${stepDescription}` : undefined;
                        graphvizEdges.push({
                            id: this.getId(modelRel),
                            source: { ref: source },
                            target: { ref: target },
                            description: labelText
                        });
                    }
                }
                else if (isParallelStepBlock(member)) {
                    const nextBlockOrder = isParallelBlock ? blockOrder : (globalSequence++).toString();
                    if (member.members) {
                        traverse(member.members, nextBlockOrder, true);
                    }
                }
            });
        };

        if (view.members) {
            traverse(view.members, undefined, false);
        }

        const elements = Array.from(uniqueElements).map(el => this.elementJson(el));

        return {
            elements: elements,
            relationships: steps,
            graphvizElements: uniqueElements,
            graphvizEdges
        };
    }

    /** Escapes double quotes in a string for safe JSON output. */
    private escapeQuotes(str: string): string {
        return str.replace(/"/g, '\\"');
    }

    /** Parses a comma-separated tag string into a cleaned array of tags. */
    private readonly parseTags = (p: string | undefined): string[] =>
        (this.substitute(p) ?? '').split(',').map(C4Utils.stripQuotes).filter(Boolean);

};

/**
 * Public API for JSON generation. Delegates to the internal JsonGenerator class
 * which handles the full workspace-to-JSON transformation.
 */
export class C4JsonGenerator {

    private readonly services: C4Services;
    /**
     * Inner generator of the last generate() call per workspace URI. Kept so the
     * text measurement pass can re-run the auto-layout with the widths the renderer
     * measured, without rebuilding the DOT graph from the AST.
     */
    private readonly generators = new Map<string, JsonGenerator>();
    /** Shared by every generate() call so an unchanged DOT is laid out once. */
    private readonly layoutCache = new GraphvizLayoutCache();

    constructor(services: C4Services) {
        this.services = services;
    }

    /**
     * Generates a Structurizr-compatible JSON representation of the given workspace.
     * @param workspace The workspace AST node to generate JSON for
     * @param uri Root workspace URI, used to keep the layout state per workspace
     * @returns A JSON object matching the Structurizr output format
     */
    public async generate(workspace: Workspace, uri?: string): Promise<any> {
        const jsonGenerator : JsonGenerator = new JsonGenerator(this.services, this.layoutCache);
        this.generators.set(uri ?? '', jsonGenerator);
        return await jsonGenerator.generate(workspace);
    }

    /**
     * Texts the renderer measures to size frames, keyed by view key, for the last
     * generated JSON of the given workspace URI.
     */
    public getTextMeasurements(uri?: string): Record<string, ViewTextMeasurements> {
        return this.generators.get(uri ?? '')?.getTextMeasurements() ?? {};
    }

    /**
     * Re-runs the auto-layout of the given JSON with the measured text widths.
     * Returns the views to re-render and whether any layout actually changed.
     */
    public async applyTextMeasurements(uri: string | undefined, json: any, widths: Record<string, number>): Promise<{ views: any[]; changed: boolean }> {
        const generator = this.generators.get(uri ?? '');
        return generator ? await generator.applyTextMeasurements(json, widths) : { views: [], changed: false };
    }

    /**
     * Refits the view's paper to coordinates set outside the graphviz layout (drawio
     * import), including the auto-drawn frames. Falls back to elements and vertices only
     * when no frame tree was captured for the view.
     */
    public fitImportedView(uri: string | undefined, viewKey: string, view: any): void {
        const generator = this.generators.get(uri ?? '');
        if (generator) {
            generator.fitImportedView(viewKey, view);
        } else {
            fitViewToContent(view);
        }
    }
}
