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

import { AstNode, AstUtils, Reference } from 'langium';
import { Utils } from 'vscode-uri';
import { StringUtils } from './c4-utils';

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
    ImplicitRelationship,
    isImplicitRelationship, isInfrastructureNode,
    isSoftwareSystemInstance, isContainerInstance, isGenericInstance,
    isDeploymentEnvironment, DeploymentNode,
    ViewsBlock, SystemContextView, isWorkspace, isC4Document,
    isViewsBlock, ElementStyle, RelationshipStyle, isStylesBlock,
    StylesBlock, isModelBlock, Include, isGroup, isDeploymentNode,
    isDeploymentView, DynamicMember, isDynamicStep, isParallelStepBlock,
    DynamicView, isContainerView,
    isSystemLandscapeView, isSystemContextView,
    SoftwareSystem,
    Component,
    RelationshipMember,
    isRelationshipMember,
    isComponentView,
    isDynamicView,
    isCustomElement,
    SoftwareSystemInstance,
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
    RelationshipsDirective} from '../generated/ast';
import { C4Services } from './c4-module';
import { SHAPE_NORMALIZE, BORDER_NORMALIZE, ROUTING_NORMALIZE } from './c4-validator';

// Constants from the original Structurizr Java library
const DEFAULT_THEME_URL = "https://static.structurizr.com/themes/default/theme.json";
const DEFAULT_THEME_NAME = "default";

interface Styles {
    elements: ElementStyle [];
    relationships: RelationshipStyle[];
}

interface ImpliedRelationship {
    relationship: Relationship;
    linked: Relationship | undefined;
    source: RelationshipMember;
    target: RelationshipMember;
}

class JsonGenerator {
    private readonly services: C4Services;
    private readonly constants: Map<string, string> = new Map<string, string>();
    private readonly styles: Styles = { elements: [], relationships: [] };
    private readonly themes: Set<string> = new Set<string>;
    private readonly propertiesModel: Record<string, string> = {};
    private readonly propertiesViews: Record<string, string> = {};
    private readonly elements: NamedElement[] = [];
    private readonly relationships: Relationship[] = [];
    /** Maps include file URI → list of Include directives that reference it (for resolving !elements/!relationships context) */
    private readonly includeContexts: Map<string, Include[]> = new Map();
    /** Range-based impliedRelationships flags per document URI: URI → sorted list of {fromOffset, toOffset, enabled} */
    private readonly impliedRangesByDoc: Map<string, Array<{ from: number; to: number; enabled: boolean }>> = new Map();
    /** Group separator character, defaults to "/". Can be configured via structurizr.groupSeparator property */
    private groupSeparator: string = '/';
    /** Maps element ID (via getId) → group path string. Replaces mutation of AST $cstNode.groupPath */
    private readonly groupPathMap: Map<string, string> = new Map();
    /** Overlay modifications applied by !elements directives: element ID → modifications */
    private readonly elementOverlays: Map<string, {
        tags?: string[];
        url?: string;
        properties?: Record<string, string>;
        perspectives?: any[];
    }> = new Map();
    /** Overlay modifications applied by !relationships directives: relationship ID → modifications */
    private readonly relationshipOverlays: Map<string, {
        tags?: string[];
        url?: string;
        properties?: Record<string, string>;
        perspectives?: any[];
    }> = new Map();

    /** Terminology overrides for diagram rendering (person, softwareSystem, container, etc.), populated from workspace terminology blocks */
    private terminology: Record<string, string> = {};

    constructor(services: C4Services) {
        this.services = services;
    }

    /**
     * Entry point: generates the complete Structurizr-compatible JSON for the given workspace.
     * Orchestrates all collection phases (constants, styles, themes, properties, terminology,
     * elements, relationships) and then assembles the final model + views output.
     */
    public generate(workspace: Workspace) {

        this.collectConstants(workspace);
        this.collectStyles(workspace);
        this.collectThemes(workspace);
        this.collectProperties(workspace);
        this.collectTerminology(workspace);

        // Read group separator from model properties, default is "/"
        this.groupSeparator = this.propertiesModel["structurizr.groupSeparator"]
            ? StringUtils.stripQuotes(this.propertiesModel["structurizr.groupSeparator"])
            : '/';

        this.collectElementsRelationships(workspace);
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

        const themesArray = Array.from(this.themes);

        const model = {
            properties: this.propertiesModel,
            customElements: this.extractCustomElements(),
            people: this.extractPeople(),
            softwareSystems: this.extractSystems(),
            deploymentNodes: this.extractAllRootDeploymentNodes()
        };

        // Assemble the final JSON output object in Structurizr-compatible format
        const jsonOutput = {
            name: this.substitute(workspace.name) || "Name",
            description: this.description(workspace) || "Description",
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
                configuration: {
                    properties: this.propertiesViews,
                    themes: themesArray.length > 0 ? themesArray : undefined,
                    styles: this.styles,
                    terminology: Object.keys(this.terminology).length > 0 ? this.terminology : undefined
                }
            }
        };
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

        const anyNode = node as any;

        // Direct TerminologyBlock on workspace
        if (anyNode.terminology) {
            this.extractTerminologyBlock(anyNode.terminology);
        }

        // Terminology via workspaces array (C4Document wrapper)
        if (anyNode.workspaces) {
            for (const ws of anyNode.workspaces) {
                if (ws.terminology) {
                    this.extractTerminologyBlock(ws.terminology);
                }
            }
        }

        // Recurse into includes
        if (anyNode.includes) {
            for (const inc of anyNode.includes as Include[]) {
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
     * deploymentNode, infrastructureNode, relationship, metadata.
     */
    private extractTerminologyBlock(blocks: any[]): void {
        for (const block of blocks) {
            const termBlock = block as any;
            if (termBlock.person?.length > 0) {
                this.terminology['person'] = termBlock.person[0];
            }
            if (termBlock.softwareSystem?.length > 0) {
                this.terminology['softwareSystem'] = termBlock.softwareSystem[0];
            }
            if (termBlock.container?.length > 0) {
                this.terminology['container'] = termBlock.container[0];
            }
            if (termBlock.component?.length > 0) {
                this.terminology['component'] = termBlock.component[0];
            }
            if (termBlock.deploymentNode?.length > 0) {
                this.terminology['deploymentNode'] = termBlock.deploymentNode[0];
            }
            if (termBlock.infrastructureNode?.length > 0) {
                this.terminology['infrastructureNode'] = termBlock.infrastructureNode[0];
            }
            if (termBlock.relationship?.length > 0) {
                this.terminology['relationship'] = termBlock.relationship[0];
            }
            if (termBlock.metadata?.length > 0) {
                this.terminology['metadata'] = termBlock.metadata[0];
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

        // Get or create the ranges array for this document
        if (docUri && !this.impliedRangesByDoc.has(docUri)) {
            this.impliedRangesByDoc.set(docUri, []);
        }
        const ranges = docUri ? this.impliedRangesByDoc.get(docUri)! : null;

        // Current flag value
        let currentFlag = inheritedFlag ?? true;
        let currentOffset = inheritFromOffset;
        const allNodes: AstNode[] = [];
        const collectChildren = (parent: AstNode) => {
            const anyParent = parent as any;
            const directChildren: AstNode[] = [];
            for (const key of Object.keys(parent)) {
                if (key.startsWith('$')) continue;
                const val = (parent as any)[key];
                if (Array.isArray(val)) {
                    for (const item of val) {
                        if (item && typeof item === 'object' && item.$type) {
                            directChildren.push(item);
                        }
                    }
                } else if (val && typeof val === 'object' && val.$type) {
                    directChildren.push(val);
                }
            }
            directChildren.sort((a, b) => (a.$cstNode?.offset ?? 0) - (b.$cstNode?.offset ?? 0));
            
            for (const child of directChildren) {
                allNodes.push(child);
                collectChildren(child);
            }
        };
        collectChildren(node);

        // Collect all ImpliedRelationshipsProperty nodes with their offset and value
        const directiveOffsets: Array<{ offset: number; enabled: boolean }> = [];
        for (const currentNode of allNodes) {
            if (isImpliedRelationshipsProperty(currentNode)) {
                const rawVal = (currentNode as any).value;
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
        const anyNode = node as any;
        if (Array.isArray(anyNode.includes)) {
            for (const includeDirective of anyNode.includes) {
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
     * Unified method for collecting constants (!constant directives) across documents and includes.
     */
    private collectConstants(node: AstNode | undefined, visited: Set<string> = new Set<string>()): void {
        if (!node) return;

        const docUri = AstUtils.getDocument(node)?.uri.toString();
        if (docUri) {
            if (visited.has(docUri)) return;
            visited.add(docUri);
        }

        const anyNode = node as any;

        // Collect constants from the current file
        if (Array.isArray(anyNode.constants)) {
            for (const c of anyNode.constants) {
                if (c.name && c.value) {
                    this.constants.set(c.name, c.value);
                }
            }
        }

        // Recurse into !include files
        if (Array.isArray(anyNode.includes)) {
            for (const inc of anyNode.includes) {
                if (inc.file) {
                    const root = this.resolveIncludedRoot(node, inc.file);
                    this.collectConstants(root, visited);
                }
            }
        }
    }

    /**
     * Resolves the root AST node of an included file by its relative path from the context node.
     * Looks up the target document in LangiumDocuments and returns its parsed AST root.
     */
    private resolveIncludedRoot(contextNode: AstNode, relativePath: string): AstNode | undefined {
        const sourceDoc = AstUtils.getDocument(contextNode);
        const targetUri = Utils.resolvePath(Utils.dirname(sourceDoc.uri), relativePath);
        try {
            const doc = this.services.shared.workspace.LangiumDocuments.getDocument(targetUri);
            return doc?.parseResult.value;
        } catch (e) {
            console.error(`[C4 Gen] Could not resolve include file: ${relativePath}`);
            return undefined;
        }
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
        }
        const anyNode = node as any;
        anyNode.includes?.forEach((includeDirective: Include) => {
            if (includeDirective.file) {
                const includedRoot = this.resolveIncludedRoot(node, includeDirective.file);
                if (includedRoot) {
                    this.collectStyles(includedRoot, visited);
                }
            }
        });
    }
    
    /**
     * Processes a StylesBlock: transforms element styles and relationship styles,
     * then recurses into any include directives within the block.
     */
    private processStylesBlock(block: StylesBlock, visited: Set<string>) {
        block.elementStyles?.forEach(style => this.styles.elements.push(this.transformElementStyle(style)));
        block.relationshipStyles?.forEach(style => this.styles.relationships.push(this.transformRelationshipStyle(style)));
        if (block.includes && Array.isArray(block.includes)) {
            for (const inc of block.includes) {
                if (inc.file) {
                    const root = this.resolveIncludedRoot(block, inc.file);
                    this.collectStyles(root, visited);
                }
            }
        }
    }

    /**
     * Safely adds a property to the result object if the value is defined.
     * Supports extracting .value from Langium property objects.
     */
    private addIfDefined(target: any, key: string, prop: any[] | string | undefined) {
        if(typeof prop === 'string') {
            target[key] = StringUtils.stripQuotes(prop);
        } else {
            const val = prop?.at(0);
            if (val !== undefined && val !== null) {
                // If it's an object with a 'value' field (e.g., { value: '#ffffff' }), extract it
                // If it's a primitive (string, number, boolean), use as-is
                target[key] = (typeof val === 'object' && 'value' in val) ? val.value : val;
            }
        }
    }

    /**
     * Transforms an ElementStyle AST node into a plain JSON object.
     * Normalizes shape, border, and other style properties to PascalCase (Structurizr convention).
     */
    private transformElementStyle(style: ElementStyle) {
        const result: any = { };
        this.addIfDefined(result, 'tag', style.tag);
        this.addIfDefined(result, 'background', style.backgroundProps);
        this.addIfDefined(result, 'color', style.colorProps);
        this.addIfDefined(result, 'shape', style.shapeProps);
        // Normalize shape to PascalCase (Box, Cylinder, WebBrowser, etc.)
        if (result.shape && typeof result.shape === 'string') {
            const normalized = SHAPE_NORMALIZE[result.shape.toLowerCase()];
            if (normalized) {
                result.shape = normalized;
            }
        }
        this.addIfDefined(result, 'icon', style.iconProps);
        this.addIfDefined(result, 'width', style.widthProps);
        this.addIfDefined(result, 'height', style.heightProps);
        this.addIfDefined(result, 'border', style.borderProps);
        // Normalize border to PascalCase (Solid, Dashed, Dotted)
        if (result.border && typeof result.border === 'string') {
            const normalized = BORDER_NORMALIZE[result.border.toLowerCase()];
            if (normalized) {
                result.border = normalized;
            }
        }
        this.addIfDefined(result, 'opacity', style.opacityProps);
        this.addIfDefined(result, 'fontSize', style.fontSizeProps);
        this.addIfDefined(result, 'metadata', style.metadataProps);

        return result;
    }

    /**
     * Transforms a RelationshipStyle AST node into a plain JSON object.
     * Normalizes routing and style properties to PascalCase.
     */
    private transformRelationshipStyle(style: RelationshipStyle) {
        const result: any = {};

        this.addIfDefined(result, 'tag', style.tag);
        this.addIfDefined(result, 'thickness', style.thicknessProps);
        this.addIfDefined(result, 'color', style.colorProps);
        this.addIfDefined(result, 'fontSize', style.fontSizeProps);
        this.addIfDefined(result, 'width', style.widthProps);
        this.addIfDefined(result, 'dashed', style.dashedProp);
        this.addIfDefined(result, 'routing', style.routingProps);
        // Normalize routing (Direct, Orthogonal, Curved)
        if (result.routing && typeof result.routing === 'string') {
            const normalized = ROUTING_NORMALIZE[result.routing.toLowerCase()];
            if (normalized) result.routing = normalized;
        }
        this.addIfDefined(result, 'position', style.positionProps);
        this.addIfDefined(result, 'opacity', style.opacityProps);
        this.addIfDefined(result, 'jump', style.jumpProps);
        this.addIfDefined(result, 'style', style.styleProps);
        // Normalize style for relationship (Solid, Dashed, Dotted)
        if (result.style && typeof result.style === 'string') {
            const normalized = BORDER_NORMALIZE[result.style.toLowerCase()];
            if (normalized) result.style = normalized;
        }

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

        // Helper to extract themes from a ViewsBlock
        const extractFromViews = (views: ViewsBlock) => {
            // Single theme (!theme)
            const t = StringUtils.stripQuotes(views.themeProps?.at(0)?.value);
            if (t) {
                this.themes.add(t === DEFAULT_THEME_NAME ? DEFAULT_THEME_URL : t);
            }
            // Theme array (!themes)
            const themes = views.themesProps?.at(0);
            themes?.values.map(t => StringUtils.stripQuotes(t)).
            filter(t => t !== undefined).
            map(t => t === DEFAULT_THEME_NAME ? DEFAULT_THEME_URL : t).
            forEach(t => this.themes.add(t))
        };

        if (isViewsBlock(node)) {
            extractFromViews(node);
        } else if (isWorkspace(node) || isC4Document(node)) {
            const views = node.viewsBlocks?.at(0);
            if (views) extractFromViews(views);
        }

        const anyNode = node as any;

        // Recurse into includes
        anyNode.includes?.forEach((includeDirective : Include) => {
            if (includeDirective.file) {
                const includedRoot = this.resolveIncludedRoot(node, includeDirective.file);
                if (includedRoot) {
                    this.collectThemes(includedRoot, visited);
                }
            }
        });
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
                    const name = StringUtils.stripQuotes(prop.name);
                    const value = StringUtils.stripQuotes(prop.value);
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
                    const name = StringUtils.stripQuotes(prop.name);
                    const value = StringUtils.stripQuotes(prop.value);
                    if (name && value) {
                        this.propertiesViews[name] = value;
                    }
                }
            }
        }

        const anyNode = node as any;
        // Recurse into included files
        if (Array.isArray(anyNode.includes)) {
            for (const includeDirective of anyNode.includes) {
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
    private collectLocal(node: any, groupStack: string[] = []) {
        // Handle C4Document root wrapper: delegate to workspace or model block
        if (isC4Document(node)) {
            if (node.workspaces.at(0)) {
                this.collectLocal(node.workspaces.at(0), groupStack);
                return;
            }
            if (node.modelBlocks.at(0)) {
                this.collectLocal(node.modelBlocks.at(0), groupStack);
                return;
            }
        }
        if(isWorkspace(node)) {
            if (node.modelBlocks.at(0)) {
                this.collectLocal(node.modelBlocks.at(0), groupStack);
            }
            return;
        }
        // Universal collection handler: processes groups, relationships, and named elements
        const processItems = (items: any[]) => {
            for (const item of items) {
                if (isGroup(item)) {
                    // Groups add another recursion level with an extended group stack
                    this.collectLocal(item, [...groupStack, StringUtils.stripQuotes(item.name) || ""]);
                }
                else if (isRelationship(item)) {
                    this.relationships.push(item);
                }
                else if (isImplicitRelationship(item)) {
                    this.relationships.push(this.createSyntheticRelationship(item));
                }
                else if (isNamedElement(item)) {
                    // Store group path in the map instead of mutating AST
                    if (groupStack.length > 0) {
                        this.groupPathMap.set(this.getId(item), groupStack.join(this.groupSeparator));
                    }
                    this.elements.push(item);
                    // Recurse into element children (SoftwareSystem → Containers, etc.) with empty group stack
                    this.collectLocal(item, []);
                }
            }
        };
        // Process all possible element collections on the current node
        if (node.nodes) processItems(node.nodes);
        if (node.groups) processItems(node.groups);
        if (node.children) processItems(node.children);
        if (node.infrastructureNodes) processItems(node.infrastructureNodes);
        if (node.softwareSystemInstances) processItems(node.softwareSystemInstances);
        if (node.containerInstances) processItems(node.containerInstances);
        if (node.genericInstances) processItems(node.genericInstances);
        if (node.elements) processItems(node.elements);
        if (node.relationships) processItems(node.relationships);
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
            technology: this.technology(relationship.relationship),
            tags: this.extractTags(relationship.relationship, 'Relationship'),
            linkedRelationshipId: relationship.linked ? this.getId(relationship.linked) : undefined
        };
        // Apply overlay URL
        if (overlay?.url) {
            result.url = overlay.url;
        }
        // Apply overlay properties
        if (overlay?.properties && Object.keys(overlay.properties).length > 0) {
            result.properties = { ...overlay.properties };
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
                $refText: (source as any)?.name || ""
            },
            target: implicit.target,
            targetThis: implicit.targetThis,
            description: implicit.description,
            technology: implicit.technology,
            tags: (implicit as any).tags || []
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
        const anyNode = node as any;
        // Collect elements and relationships from the current node (works for Workspace, ModelBlock, included files)
        this.collectLocal(anyNode);
        // Recursively process nested elements (SoftwareSystem → Containers, etc.)
        if (anyNode.elements && Array.isArray(anyNode.elements)) {
            for (const el of anyNode.elements) {
                this.collectElementsRelationships(el, visited);
            }
        }
        // Universal include processing (works for any root type)
        if (anyNode.includes && Array.isArray(anyNode.includes)) {
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
     */
    private resolveParentWorkspace(currentWs: Workspace, relativePath: string): Workspace | undefined {
        const currentDoc = AstUtils.getDocument(currentWs);
        const sourceUri = currentDoc.uri;
        const parentUri = Utils.resolvePath(Utils.dirname(sourceUri), relativePath);
        try {
            const langiumDocuments = this.services.shared.workspace.LangiumDocuments;
            const parentDoc = langiumDocuments.getDocument(parentUri);
            if (parentDoc) {
                const root = parentDoc.parseResult.value;
                if (isWorkspace(root)) return root;
                if (isC4Document(root)) return root.workspaces.at(0);
            }
        } catch (e) {
            console.error(`[C4 Gen] Error accessing LangiumDocuments:`, e);
        }
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
    private generateFlatId(element: any): string {
        let hashInput: string;

        if (isImplicitRelationship(element)) {
            // Implicit relationship: hash includes source + target element IDs and CST offset
            const source = this.resolveSource(element);
            const target = this.resolveTarget(element);
            const sourceId = source ? this.generateFlatId(source) : 'unknown_src';
            const targetId = target ? this.generateFlatId(target) : 'unknown_dst';
            const offset = element.$cstNode?.offset ?? '0';
            hashInput = `implicit|${sourceId}|${targetId}|${offset}`;
        } 
        else if (isRelationship(element)) {
            // Explicit relationship: hash includes source + target element IDs and CST offset
            const source = this.resolveSource(element);
            const target = this.resolveTarget(element);
            const sourceId = source ? this.generateFlatId(source) : 'unknown_src';
            const targetId = target ? this.generateFlatId(target) : 'unknown_dst';
            const offset = element.$cstNode?.offset ?? '0';
            hashInput = `relationship|${sourceId}|${targetId}|${offset}`;
        } 
        else {
            // Static/physical element (Person, SoftwareSystem, Container, DeploymentNode, etc.):
            // hash is based on $type + CST offset alone
            const type = element?.$type || 'element';
            const offset = element?.$cstNode?.offset ?? '0';
            hashInput = `${type}|${offset}`;
        }

        // Generate a stable hash from the input string
        const hash = StringUtils.generateHash(hashInput);
        
        // Determine prefix based on element type
        let prefix = 'element';
        if (isRelationship(element) || isImplicitRelationship(element)) {
            prefix = 'relationship';
        } else if (element?.$type) {
            prefix = element.$type.toLowerCase();
        }

        return `${prefix}_${hash}`;
    }

    /** Returns a stable generated ID for any element or relationship. Delegates to generateFlatId(). */
    private getId(element: any): string {
        if (!element) return 'unknown';
        return this.generateFlatId(element);
    }

    /**
     * Applies overlay URL, properties, and perspectives from !elements directives
     * to the element JSON output object. Tags are handled separately in extractTags().
     */
    private applyElementOverlay(result: any, node: any): void {
        const nodeId = this.getId(node);
        const overlay = this.elementOverlays.get(nodeId);
        if (!overlay) return;

        if (overlay.url) {
            result.url = overlay.url;
        }
        if (overlay.properties && Object.keys(overlay.properties).length > 0) {
            result.properties = { ...overlay.properties };
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
        return (value) ? StringUtils.stripQuotes(value.replace(/\$\{([^}]+)\}/g, (match, varName) => this.constants.get(varName) ?? match)) : undefined;
    }

    /** Returns the description text for a node, with constant substitution applied. */
    private description(node: any) {
        return this.substitute(node?.description ?? node?.descriptionProps?.[0]?.value);
    }

    /** Returns the technology text for a node, with constant substitution applied. */
    private technology(node: any) {
        return this.substitute(node?.technology ?? node?.technologyProps?.[0]?.value);
    }

    /** Helper to create a minimal element JSON stub with id and default position. */
    private readonly elementJson = (el: any) => ({ id: this.getId(el), x: 0, y: 0 });

    /** Extracts all Person elements from the collected elements list into JSON format. */
    private extractPeople() {
        const peoples = this.elements
            .filter(isPerson)
            .map(p => {
                const result: any = {
                    id: this.getId(p),
                    name: this.substitute(p.name),
                    group: this.extractGroup(p),
                    tags: this.extractTags(p, 'Element', 'Person'),
                    relationships: this.extractRelationshipsForPerson(p).map(el => this.relationshipToJson(el))
                };
                this.applyElementOverlay(result, p);
                return result;
            });
        return peoples && peoples.length > 0 ? peoples : undefined;
    }

    /** Returns the group path for a given element/node, if it belongs to a group. */
    private extractGroup(node: any) : string | undefined {
        return this.groupPathMap.get(this.getId(node));
    }

    private readonly resolveTarget = (rel : Relationship | ImplicitRelationship) => (rel.target?.ref === undefined || rel.targetThis) ? this.resolveContextElement(rel) : rel.target.ref;
    private readonly resolveSource = (rel : Relationship | ImplicitRelationship) => (isImplicitRelationship(rel) || rel.source?.ref === undefined || rel.sourceThis) ? this.resolveContextElement(rel) : rel.source.ref;

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
    private extractRelationshipsForContainer(container: Container) {
        const rels: ImpliedRelationship[] = [];
        for (const rel of this.relationships) {
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

                        let targetComponent : Component | undefined = undefined;
                        let targetContainer : Container | undefined = undefined;
                        let targetSoftwareSystem : SoftwareSystem | undefined = undefined;
                        let sourceSoftwareSystem : SoftwareSystem | undefined = undefined; 

                        sourceSoftwareSystem = this.resolveConatinerParent(sourceContainer);

                        if(isComponent(target)) {
                            targetComponent = target;
                            targetContainer = this.resolveComponentParent(targetComponent);
                            if(targetContainer) {
                                targetSoftwareSystem = this.resolveConatinerParent(targetContainer);
                            }
                        } else if(isContainer(target)) {
                            targetContainer = target;
                            targetSoftwareSystem = this.resolveConatinerParent(targetContainer);
                        } else if(isSoftwareSystem(target)) {
                            targetSoftwareSystem = target;
                        }

                        // implied: source Container → target Container (same-level sibling)
                        // skip self-reference and exact duplicate of the explicit relationship
                        if(targetContainer && sourceContainer !== targetContainer && targetContainer !== target) {
                            rels.push(this.createRelationshipEx(sourceContainer, targetContainer, rel));
                        }
                        // implied: source Container → target SoftwareSystem (parent of target)
                        // skip relationship to own parent system and exact duplicate
                        if(targetSoftwareSystem && targetSoftwareSystem !== sourceSoftwareSystem && targetSoftwareSystem !== target) { 
                            rels.push(this.createRelationshipEx(sourceContainer, targetSoftwareSystem, rel));
                        }

                        if(sourceSoftwareSystem) {
                            // implied: source SoftwareSystem → target Component (child of another container)
                            // skip relationship to own child component
                            if(targetComponent && sourceContainer !== targetContainer) {
                                rels.push(this.createRelationshipEx(sourceSoftwareSystem, targetComponent, rel));
                            }
                            // implied: source SoftwareSystem → target Container (under a different system)
                            // skip relationship to own child container
                            if(targetContainer && sourceContainer !== targetContainer) {
                                rels.push(this.createRelationshipEx(sourceSoftwareSystem, targetContainer, rel));
                            }
                            // implied: source SoftwareSystem → target SoftwareSystem (cross-system)
                            // skip self-reference
                            if(targetSoftwareSystem && sourceSoftwareSystem !== targetSoftwareSystem) {
                                rels.push(this.createRelationshipEx(sourceSoftwareSystem, targetSoftwareSystem, rel));                            
                            }
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
    private extractRelationshipsForComponent(component: Component) {
        const rels: ImpliedRelationship[] = [];
        for (const rel of this.relationships) {
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
                        let targetComponent : Component | undefined = undefined;
                        let targetContainer : Container | undefined = undefined;
                        let targetSoftwareSystem : SoftwareSystem | undefined = undefined;
                        let sourceContainer : Container | undefined = undefined;
                        let sourceSoftwareSystem : SoftwareSystem | undefined = undefined; 

                        sourceContainer = this.resolveComponentParent(sourceComponent);
                        if(sourceContainer) {
                            sourceSoftwareSystem = this.resolveConatinerParent(sourceContainer);
                        }

                        if(isComponent(target)) {
                            targetComponent = target;
                            targetContainer = this.resolveComponentParent(targetComponent);
                            if(targetContainer) {
                                targetSoftwareSystem = this.resolveConatinerParent(targetContainer);
                            }
                        } else if(isContainer(target)) {
                            targetContainer = target;
                            targetSoftwareSystem = this.resolveConatinerParent(targetContainer);
                        } else if(isSoftwareSystem(target)) {
                            targetSoftwareSystem = target;
                        }

                        // implied: source Component → target Container (parent of target)
                        // skip self-referencing parent container and exact duplicate
                        if(targetContainer && sourceContainer !== targetContainer && targetContainer !== target) { 
                            rels.push(this.createRelationshipEx(sourceComponent, targetContainer, rel));
                        }
                        // implied: source Component → target SoftwareSystem (grandparent of target)
                        // skip self-referencing parent system and exact duplicate
                        if(targetSoftwareSystem && sourceSoftwareSystem !== targetSoftwareSystem && targetSoftwareSystem !== target) { 
                            rels.push(this.createRelationshipEx(sourceComponent, targetSoftwareSystem, rel));
                        }

                        if(sourceContainer) {
                            // implied: source Container → target Component (sibling component in another container)
                            // skip self-reference
                            if(targetComponent && sourceComponent !== targetComponent) {
                                rels.push(this.createRelationshipEx(sourceContainer, targetComponent, rel));
                            }
                            // implied: source Container → target Container (sibling)
                            // skip self-reference
                            if(targetContainer && sourceContainer !== targetContainer) {
                                rels.push(this.createRelationshipEx(sourceContainer, targetContainer, rel));
                            }
                            // implied: source Container → target SoftwareSystem (parent of target)
                            // skip relationship to own parent system                        
                            if(targetSoftwareSystem && sourceSoftwareSystem!== targetSoftwareSystem) {
                                rels.push(this.createRelationshipEx(sourceContainer, targetSoftwareSystem, rel));
                            }

                            if(sourceSoftwareSystem) {
                                // implied: source SoftwareSystem → target Component (grandparent → component)
                                // skip relationship to own child component
                                if(targetComponent && sourceComponent !== targetComponent) {
                                    rels.push(this.createRelationshipEx(sourceSoftwareSystem, targetComponent, rel));
                                }
                                // implied: source SoftwareSystem → target Container (grandparent → sibling container)
                                // skip relationship to own child container
                                if(targetContainer && sourceContainer !== targetContainer) {
                                    rels.push(this.createRelationshipEx(sourceSoftwareSystem, targetContainer, rel));
                                }
                                // implied: source SoftwareSystem → target SoftwareSystem (cross-system)
                                // skip self-reference
                                if(targetSoftwareSystem && sourceSoftwareSystem !== targetSoftwareSystem) {
                                    rels.push(this.createRelationshipEx(sourceSoftwareSystem, targetSoftwareSystem, rel));                            
                                }
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
    private extractRelationshipsForSoftwareSystem(softwareSystem: SoftwareSystem) {
        const rels: ImpliedRelationship[] = [];
        for (const rel of this.relationships) {
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
                        let targetContainer : Container | undefined = undefined;
                        let targetSoftwareSystem : SoftwareSystem | undefined = undefined;

                        if(isComponent(target)) {
                            targetContainer = this.resolveComponentParent(target);
                            if(targetContainer) {
                                targetSoftwareSystem = this.resolveConatinerParent(targetContainer);
                            }
                        } else if(isContainer(target)) {
                            targetSoftwareSystem = this.resolveConatinerParent(target);
                        }

                        // implied: source SoftwareSystem → target Container (under a different system)
                        // skip relationship to own child container
                        if(targetContainer && sourceSoftwareSystem !== targetSoftwareSystem) {
                            rels.push(this.createRelationshipEx(sourceSoftwareSystem, targetContainer, rel));
                        }
                        // implied: source SoftwareSystem → target SoftwareSystem (cross-system)
                        // skip self-reference
                        if(targetSoftwareSystem && sourceSoftwareSystem !== targetSoftwareSystem) {
                            rels.push(this.createRelationshipEx(sourceSoftwareSystem, targetSoftwareSystem, rel));
                        }
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
    private extractRelationshipsForPerson(person: Person) {
        const rels: ImpliedRelationship[] = [];
        for (const rel of this.relationships) {
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
                        let targetContainer : Container | undefined = undefined;
                        let targetSoftwareSystem : SoftwareSystem | undefined = undefined;

                        if(isComponent(target)) {
                            targetContainer = this.resolveComponentParent(target);
                            if(targetContainer) {
                                targetSoftwareSystem = this.resolveConatinerParent(targetContainer);
                            }
                        } else if(isContainer(target)) {
                            targetSoftwareSystem = this.resolveConatinerParent(target);
                        }
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
    private extractRelationshipsForCustom(custom: CustomElement) {
        const rels: ImpliedRelationship[] = [];
        for (const rel of this.relationships) {
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
                        let targetContainer : Container | undefined = undefined;
                        let targetSoftwareSystem : SoftwareSystem | undefined = undefined;

                        if(isComponent(target)) {
                            targetContainer = this.resolveComponentParent(target);
                            if(targetContainer) {
                                targetSoftwareSystem = this.resolveConatinerParent(targetContainer);
                            }
                        } else if(isContainer(target)) {
                            targetSoftwareSystem = this.resolveConatinerParent(target);
                        }
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
    private extractRelationshipsForDeploymentNode(deploymentNode: DeploymentNode) {
        const rels: ImpliedRelationship[] = [];
        for (const rel of this.relationships) {
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
    private extractRelationshipsForInfrastructureNode(infrastructureNode: InfrastructureNode) {
        const rels: ImpliedRelationship[] = [];
        for (const rel of this.relationships) {
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
    private extractRelationshipsForSoftwareSystemInstance(softwareSystemInstance: SoftwareSystemInstance) {
        const softwareSystemInstanceRels: ImpliedRelationship[] = [];

        // collect direct explicit relationships where this instance is the source
        for (const rel of this.relationships) {
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
        const parentSoftwareSystem = softwareSystemInstance.softwareSystem.ref;
        if (parentSoftwareSystem) {
            const allParentRels = new Set<ImpliedRelationship>();
            // collect relationships from the parent SoftwareSystem itself
            this.extractRelationshipsForSoftwareSystem(parentSoftwareSystem).forEach(rel => allParentRels.add(rel));
            this.elements.forEach(el => {
                if(isContainer(el)) {
                    if(this.resolveConatinerParent(el) == parentSoftwareSystem) {
                        this.extractRelationshipsForContainer(el).forEach(rel => allParentRels.add(rel));
                    }
                } else if(isComponent(el)) {
                    const container = this.resolveComponentParent(el);
                    if(container) {
                        this.extractRelationshipsForContainer(container).forEach(rel => allParentRels.add(rel));                        
                        if(this.resolveConatinerParent(container) == parentSoftwareSystem) {
                            this.extractRelationshipsForComponent(el).forEach(rel => allParentRels.add(rel));
                        }
                    }
                }
            });

            if (allParentRels.size > 0) {
                const softwareSystemInstanceEnv = this.getEnvironment(softwareSystemInstance);
                this.elements.forEach(el => {
                    if (isSoftwareSystemInstance(el)) {
                        const elementEnv = this.getEnvironment(el);
                        for (const rel of allParentRels) {
                            if (this.shouldGenerateImplied(rel.relationship)) {
                                if (rel.target === el.softwareSystem.ref && elementEnv === softwareSystemInstanceEnv
                                    && this.hasCommonDeploymentGroup(softwareSystemInstance, el)) {
                                    softwareSystemInstanceRels.push(this.createRelationshipEx(softwareSystemInstance, el, rel.relationship));
                                }
                            }
                        }
                    } else if (isContainerInstance(el)) {
                        const elementEnv = this.getEnvironment(el);
                        for (const rel of allParentRels) {
                            if (this.shouldGenerateImplied(rel.relationship)) {
                                if (rel.target === el.container.ref && elementEnv === softwareSystemInstanceEnv
                                    && this.hasCommonDeploymentGroup(softwareSystemInstance, el)) {
                                    softwareSystemInstanceRels.push(this.createRelationshipEx(softwareSystemInstance, el, rel.relationship));
                                }
                            }
                        }
                    }
                });
            }
        }

        return softwareSystemInstanceRels;
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
    private extractRelationshipsForContainerInstance(containerInstance: ContainerInstance) {
        const rels: ImpliedRelationship[] = [];

        // collect direct explicit relationships where this instance is the source
        for (const rel of this.relationships) {
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
        // Only relationships between instances within the same DeploymentNode are projected
        // (cross-node relationships, e.g. service1Api -> service2Api, are NOT projected).
        const thisNode = this.resolveDeploymentNodeParent(containerInstance);
        const env = this.getEnvironment(containerInstance);
        const parentContainer = containerInstance.container.ref;
        if(parentContainer) {
            const allParentRels = new Set<ImpliedRelationship>();
            this.extractRelationshipsForContainer(parentContainer).forEach(rel => allParentRels.add(rel));
            this.elements.forEach(el => {
                if(isComponent(el)) {
                    if(this.resolveComponentParent(el) === parentContainer) {
                        this.extractRelationshipsForComponent(el).forEach(rel => allParentRels.add(rel));
                    }
                }
            });
            this.elements.forEach(el => {
                if(isSoftwareSystemInstance(el)) {
                    for(const relContainer of allParentRels) {
                        if(this.shouldGenerateImplied(relContainer.relationship)) {
                            if(relContainer.target === el.softwareSystem.ref && env === this.getEnvironment(el)) {
                                const targetNode = this.resolveDeploymentNodeParent(el);
                                if (thisNode && targetNode && thisNode === targetNode
                                    && this.hasCommonDeploymentGroup(containerInstance, el)) {
                                    rels.push(this.createRelationshipEx(containerInstance, el, relContainer.relationship));
                                }
                            }
                        }
                    }
                } else if(isContainerInstance(el)) {
                    for(const relContainer of allParentRels) {
                        if(this.shouldGenerateImplied(relContainer.relationship)) {
                            if(env === this.getEnvironment(el)) {
                                const shouldProject = (relContainer.target === el.container.ref) ||
                                    (el.container.ref && this.resolveConatinerParent(el.container.ref) === relContainer.target);
                                if (shouldProject) {
                                    const targetNode = this.resolveDeploymentNodeParent(el);
                                    if (thisNode && targetNode && thisNode === targetNode
                                        && this.hasCommonDeploymentGroup(containerInstance, el)) {
                                        rels.push(this.createRelationshipEx(containerInstance, el, relContainer.relationship));
                                    }
                                }
                            }
                        }
                    }
                }
            });
        }

        return rels;
    }
    
    /**
     * Post-parse resolution for DeploymentGroupOrTag ambiguity on instance nodes
     * (ContainerInstance, SoftwareSystemInstance, GenericInstance).
     *
     * Called after collectLocal() completes, so all DeploymentGroups are already
     * in this.elements. For each instance node with node.value set (from the
     * DeploymentGroupOrTag grammar fragment):
     * - If the value matches a known DeploymentGroup name → it was intended as a
     *   deployment group. The value is cleared and the node is left unchanged
     *   (the deployment group reference cannot be added programmatically to the
     *   Reference array, but the value is no longer ambiguous).
     * - If the value does NOT match any DeploymentGroup → it's a tag. The value
     *   is added to node.tags.
     */
    private resolveAllInstanceValues(): void {
        // 1. Build a set of known DeploymentGroup names
        const deploymentGroupNames = new Set<string>();
        for (const el of this.elements) {
            if ((el as any).$type === 'DeploymentGroup') {
                const groupName = StringUtils.stripQuotes((el as any).name);
                if (groupName) {
                    deploymentGroupNames.add(groupName);
                }
            }
        }

        // 2. Scan all elements for instance nodes with unresolved value
        for (const el of this.elements) {
            if (!isContainerInstance(el) && !isSoftwareSystemInstance(el) && !isGenericInstance(el)) {
                continue;
            }
            const node = el as any;
            if (!node.value) continue;

            const val = StringUtils.stripQuotes(node.value);
            if (!val) {
                node.value = undefined;
                continue;
            }

            if (deploymentGroupNames.has(val)) {
                // Value matches a known DeploymentGroup → it's a group reference
                // Nothing more to do: the group reference was already consumed by the grammar
            } else {
                // Value does not match any DeploymentGroup → treat as tag
                if (!node.tags) node.tags = [];
                if (!node.tags.includes(val)) {
                    node.tags.push(val);
                }
            }
            // Clear value after resolution
            node.value = undefined;
        }
    }

    /**
     * Returns the set of deployment group names for an instance node (ContainerInstance,
     * SoftwareSystemInstance, GenericInstance).
     *
     * Resolution order:
     * 1. Direct deploymentGroups references on the instance
     * 2. If none, inherit from parent DeploymentNode via deploymentGroupProps
     *    (climbs up the $container chain)
     *
     * Deployment groups are used for relationship scoping: implied relationships
     * are only projected between instances that share a common deployment group.
     * See: https://docs.structurizr.com/dsl/cookbook/deployment-groups/
     */
    private getInstanceDeploymentGroupNames(node: any): Set<string> {
        const groups = new Set<string>();

        // 1. Check direct deploymentGroups references on the instance
        if (Array.isArray(node.deploymentGroups)) {
            for (const ref of node.deploymentGroups) {
                if (ref.ref && ref.ref.name) {
                    const name = StringUtils.stripQuotes(ref.ref.name);
                    if (name) groups.add(name);
                }
            }
        }

        // 2. If no direct groups, inherit from parent DeploymentNode chain
        if (groups.size === 0) {
            let current: AstNode | undefined = node.$container;
            while (current) {
                if (isDeploymentNode(current)) {
                    const dn = current as any;
                    if (Array.isArray(dn.deploymentGroupProps)) {
                        for (const prop of dn.deploymentGroupProps) {
                            if (Array.isArray(prop.deploymentGroups)) {
                                for (const ref of prop.deploymentGroups) {
                                    if (ref.ref && ref.ref.name) {
                                        const name = StringUtils.stripQuotes(ref.ref.name);
                                        if (name) groups.add(name);
                                    }
                                }
                            }
                        }
                    }
                    if (groups.size > 0) break; // found groups, stop climbing
                }
                current = current.$container;
            }
        }

        return groups;
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
    private extractTags(node: any, extraTag1?: string, extraTag2?: string): string | undefined {
        // Initialize set for collecting unique, cleaned tags
        const collectedTags = new Set<string>();
        // 1. Add first extra tag (if provided)
        if (extraTag1) {
            const stripped = StringUtils.stripQuotes(extraTag1);
            if (stripped) collectedTags.add(stripped.trim());
        }
        // 2. Add second extra tag (if provided)
        if (extraTag2) {
            const stripped = StringUtils.stripQuotes(extraTag2);
            if (stripped) collectedTags.add(stripped.trim());
        }
        // 3. Process node.tags array (split by comma)
        if (Array.isArray(node.tags)) {
            for (const rawTag of node.tags) {
                if (typeof rawTag !== 'string') continue;
                const stripped = StringUtils.stripQuotes(rawTag);
                if (!stripped) continue;
                for (const subTag of stripped.split(',')) {
                    const trimmed = subTag.trim();
                    if (trimmed.length > 0) {
                        collectedTags.add(trimmed);
                    }
                }
            }
        }
        // 3.5. Fallback: handle DeploymentGroupOrTag.value if not yet resolved
        // (resolveAllInstanceValues() normally clears this, but this handles edge cases)
        if (node.value) {
            const val = StringUtils.stripQuotes(node.value);
            if (val) {
                const trimmed = val.trim();
                if (trimmed) collectedTags.add(trimmed);
            }
        }
        // 4. Process node.tagsProps array
        if (Array.isArray(node.tagsProps)) {
            for (const tagOrValue of node.tagsProps) {
                if (typeof tagOrValue === 'string') {
                    const stripped = StringUtils.stripQuotes(tagOrValue);
                    if (!stripped) continue;
                    for (const subTag of stripped.split(',')) {
                        const trimmed = subTag.trim();
                        if (trimmed.length > 0) collectedTags.add(trimmed);
                    }
                } else if (tagOrValue && typeof tagOrValue === 'object') {
                    const valuesArray = tagOrValue.values || tagOrValue.value;
                    if (Array.isArray(valuesArray)) {
                        valuesArray.forEach((tagObj: any) => {
                            const rawValue = typeof tagObj === 'object' ? tagObj.value : tagObj;
                            if (typeof rawValue === 'string') {
                                const stripped = StringUtils.stripQuotes(rawValue);
                                if (stripped) {
                                    const trimmed = stripped.trim();
                                    if (trimmed) collectedTags.add(trimmed);
                                }
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
        const join = (tags: string[]) =>
            tags.
            map(t => StringUtils.stripQuotes(t)).
            filter(t => t !== undefined).
            join(',');

        return join(Array.from(collectedTags));
    }

    /**
     * Collects nested child elements of a specific type from a parent node.
     * Recursively searches through groups, containers, components, deployment nodes, etc.
     */
    private collectNested<T>(node: any, check: (item: any) => item is T): T[] | undefined {
        let results: T[] = [];
        
        // Check all possible element collections on the current node
        const items = [
            ...(node.elements || []),
            ...(node.containers || []),
            ...(node.components || []),
            ...(node.groups || []),
            ...(node.children || []),
            ...(node.infrastructureNodes || []),
            ...(node.softwareSystemInstances || []),
            ...(node.containerInstances || []),
            ...(node.genericInstances || []),
        ];
        
        for (const item of items) {
            if (check(item)) {
                results.push(item);
            } else if (isGroup(item)) {
                // If it's a group, recurse deeper
                results = results.concat(this.collectNested(item, check) || []);
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
                group: this.extractGroup(container),
                tags: this.extractTags(container, 'Element', 'Container'),
                technology: this.technology(container),
            components: this.collectNested(container, isComponent)?.map(comp => {
                // Get base group path (e.g., "a-api.jar")
                let compGroup = this.extractGroup(comp);
                // Extract inline GroupProperty from grammar
                const groupProperty = (comp as any).groupProps?.at(0);
                if (groupProperty?.value) {
                    const inlineGroupName = StringUtils.stripQuotes(groupProperty.value);
                    if (inlineGroupName) {
                        // Merge external group path with inline group property
                        compGroup = compGroup ? `${compGroup}/${inlineGroupName}` : inlineGroupName;
                    }
                }
                const compResult: any = {
                id: this.getId(comp),
                    name: this.substitute(comp.name),
                    description: this.description(comp),
                    technology: this.technology(comp),
                    group: compGroup || undefined,
                    tags: this.extractTags(comp, 'Element', 'Component'),
                    relationships: this.extractRelationshipsForComponent(comp).map(el => this.relationshipToJson(el))
                };
                this.applyElementOverlay(compResult, comp);
                return compResult;
            }),
            relationships: this.extractRelationshipsForContainer(container).map(el => this.relationshipToJson(el))
        };
        this.applyElementOverlay(result, container);
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
                    relationships: this.extractRelationshipsForCustom(ce).map(el => this.relationshipToJson(el)),
                    tags: this.extractTags(ce, 'Element')
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
        const systems = this.elements
            .filter(isSoftwareSystem)
            .map(s => {
                const result: any = {
                    id: this.getId(s),
                    name: this.substitute(s.name),
                    description: this.description(s),
                    group: this.extractGroup(s),
                    tags: this.extractTags(s, 'Element', 'Software System'),
                    containers: this.collectNested(s, isContainer)?.map(c => this.transformContainer(c)),
                    relationships: this.extractRelationshipsForSoftwareSystem(s).map(el => this.relationshipToJson(el))
                };
                this.applyElementOverlay(result, s);
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
            const groupAny = element as any;
            if (Array.isArray(groupAny.includes)) {
                for (const inc of groupAny.includes) {
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
            }
        } else {
            result.add(element);
        }
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
            environment: this.getEnvironment(node),
            instances: String(node.instances || "1"),
            // Find nested child deployment nodes (traversing through groups)
            children: this.collectNested(node, isDeploymentNode)?.map(child => {
                const childJson = this.transformDeploymentNode(child);
                this.applyElementOverlay(childJson, child);
                return childJson;
            }),
            // Find infrastructure nodes (traversing through groups)
            infrastructureNodes: this.collectNested(node, isInfrastructureNode)?.map(infra => {
                const infraJson: any = {
                    id: this.getId(infra),
                    name: this.substitute(infra.name),
                    group: this.extractGroup(infra),
                    tags: this.extractTags(infra, 'Element', 'Infrastructure Node'),
                    description: this.description(infra),
                    technology: this.technology(infra),
                    relationships: this.extractRelationshipsForInfrastructureNode(infra).map(el => this.relationshipToJson(el))
                };
                this.applyElementOverlay(infraJson, infra);
                return infraJson;
            }),
            // Find software system instances (traversing through groups)
            softwareSystemInstances: this.collectNested(node, isSoftwareSystemInstance)?.
            filter((ssi): ssi is typeof ssi & { softwareSystem: { ref: NonNullable<typeof ssi.softwareSystem.ref> } } => ssi.softwareSystem.ref !== undefined).
            map(ssi => {
                const ssiJson: any = {
                    id: this.getId(ssi),
                    group: this.extractGroup(ssi),
                    tags: this.extractTags(ssi, 'Software System Instance'),
                    softwareSystemId: this.getId(ssi.softwareSystem.ref),
                    environment: this.getEnvironment(ssi),
                    name: this.substitute(ssi.softwareSystem.ref?.name),
                    description: this.description(ssi.softwareSystem.ref),
                    relationships: this.extractRelationshipsForSoftwareSystemInstance(ssi).map(el => this.relationshipToJson(el))
                };
                this.applyElementOverlay(ssiJson, ssi);
                return ssiJson;
            }),
            
            // Find container instances (traversing through groups)
            containerInstances: this.collectNested(node, isContainerInstance)?.
            filter((ci): ci is typeof ci & { container: { ref: NonNullable<typeof ci.container.ref> } } => ci.container.ref !== undefined).map(ci => {
                const ciJson: any = {
                    id: this.getId(ci),
                    containerId: this.getId(ci.container.ref),
                    environment: this.getEnvironment(ci),
                    group: this.extractGroup(ci),
                    tags: this.extractTags(ci, 'Container Instance'),
                    name: ci.container.ref?.name,
                    description: this.description(ci.container.ref),
                    technology: this.technology(ci.container.ref),
                    relationships: this.extractRelationshipsForContainerInstance(ci).map(el => this.relationshipToJson(el)),
                    parentId: this.getId(this.resolveDeploymentNodeParent(ci))
                };
                this.applyElementOverlay(ciJson, ci);
                return ciJson;
            }),

            relationships: this.extractRelationshipsForDeploymentNode(node).map(el => this.relationshipToJson(el))
        };
        this.applyElementOverlay(jsonNode, node);
        return jsonNode;
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
     * Extracts custom views from the workspace and resolves their elements and relationships.
     * Each custom view includes a key, title, description, element/relationship references,
     * and automatic layout settings.
     */
    private extractCustomViews(workspace: Workspace) {
        const views = workspace.viewsBlocks?.at(0)?.views.filter(view => isCustomView(view))
            .map(view => {
                const elements = new Set<RelationshipMember>();
                const relationships = new Set<Relationship>();
                this.resolveCustom(view, elements, relationships);
                return {
                    key: this.substitute(this.services.workspace.ViewKeyProvider.getKey(view)),
                    title: this.substitute(view.titleProps?.at(0)?.value),
                    description: this.description(view),
                    elements: Array.from(elements).map(el => this.elementJson(el)),
                    relationships: Array.from(relationships).map(rel => this.elementJson(rel)),
                    automaticLayout: this.transformAutoLayout(view)
                };
            });
        return views && views.length > 0 ? views : undefined;
    }

    /**
     * Extracts System Landscape views from the workspace, resolving all elements
     * and relationships visible at the landscape level (all elements in the model).
     */
    private extractSystemLandscapeViews(workspace: Workspace, model: any) {
        const views = workspace.viewsBlocks?.at(0)?.views.filter(view => isSystemLandscapeView(view))
            .map(view => {
                const elements = new Set<RelationshipMember>();
                const relationships = new Set<Relationship>();
                this.resolveSystemLandscape(view, elements, relationships);
                return {
                    key: this.substitute(this.services.workspace.ViewKeyProvider.getKey(view)),
                    title: this.substitute(view.titleProps?.at(0)?.value),
                    description: this.description(view),
                    elements: Array.from(elements).map(el => this.elementJson(el)),
                    relationships: Array.from(relationships).map(rel => this.elementJson(rel)),
                    automaticLayout: this.transformAutoLayout(view)
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
    private transformAutoLayout(view: any): any | undefined {
        const autoLayout = view.autoLayoutProps?.[0];
        if (!autoLayout) {
            return undefined;
        }
        const direction = this.mapDirection(autoLayout.direction);
        return {
            applied: false,
            implementation: "Graphviz",
            rankDirection: direction,
            rankSeparation: autoLayout.rankSeparation ?? 100,
            nodeSeparation: autoLayout.nodeSeparation ?? 50,
            edgeSeparation: 50,
            vertices: true
        };
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
    private resolveConatinerParent(container: Container): SoftwareSystem | undefined {
        // first, try climbing the direct AST $container chain (works for inline containers)
        let current: AstNode | undefined = container;
        while (current) {
            if (isSoftwareSystem(current)) {
                return current;
            }
            current = current.$container;
        }
        // fallback for !include files: the container's $container points to the
        // root of the included document.  Look up the Include directive that
        // references this file and climb from there.
        const docUri = AstUtils.getDocument(container)?.uri.toString();
        if (docUri) {
            const includes = this.includeContexts.get(docUri);
            if (includes && includes.length > 0) {
                for (const includeDirective of includes) {
                    current = includeDirective.$container;
                    while (current) {
                        if (isSoftwareSystem(current)) {
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
        // first, try climbing the direct AST $container chain (works for inline components)
        let current: AstNode | undefined = component;
        while (current) {
            if (isContainer(current)) {
                return current;
            }
            current = current.$container;
        }
        // fallback for !include files: the component's $container points to the
        // root of the included document.  Look up the Include directive that
        // references this file and climb from there.
        const docUri = AstUtils.getDocument(component)?.uri.toString();
        if (docUri) {
            const includes = this.includeContexts.get(docUri);
            if (includes && includes.length > 0) {
                for (const includeDirective of includes) {
                    current = includeDirective.$container;
                    while (current) {
                        if (isContainer(current)) {
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
     * Adds a single element to the result set if allowed, with fallback to ContainerInstance/SoftwareSystemInstance
     */
    private addLeafElementWithInstanceFallback(el: NamedElement, res: Set<RelationshipMember | Relationship>, isAllowed: (item: NamedElement | undefined) => item is RelationshipMember): void {
        if (isAllowed(el)) {
            res.add(el as RelationshipMember);
        } else if (isContainer(el)) {
            this.elements.forEach(inst => {
                if (isContainerInstance(inst) && inst.container.ref === el && isAllowed(inst)) {
                    res.add(inst as RelationshipMember);
                }
            });
        } else if (isSoftwareSystem(el)) {
            this.elements.forEach(inst => {
                if (isSoftwareSystemInstance(inst) && inst.softwareSystem.ref === el && isAllowed(inst)) {
                    res.add(inst as RelationshipMember);
                }
            });
        }
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
        if (isSingleElementExpression(e)) {
            const ref = e.element.ref;
            if (isGroup(ref)) {
                // Groups expand to their leaf-level named elements
                const leafElements = new Set<NamedElement>();
                this.collectLeafElements(ref, leafElements);
                leafElements.forEach(el => this.addLeafElementWithInstanceFallback(el, res, isAllowed));
            } else {
                this.addLeafElementWithInstanceFallback(ref as NamedElement, res, isAllowed);
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
                    const groupElements = new Set<NamedElement>();
                    this.collectLeafElements(el, groupElements);
                    groupElements.forEach(ge => {
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
                    const groupElements = new Set<NamedElement>();
                    this.collectLeafElements(el, groupElements);
                    groupElements.forEach(ge => {
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
                    const groupElements = new Set<NamedElement>();
                    this.collectLeafElements(el, groupElements);
                    groupElements.forEach(ge => {
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
            if (e.element.ref) this.elements.forEach(el => {
                // Resolve parent using type-guarded helper functions
                let elParent: NamedElement | undefined;
                if (isComponent(el)) {
                    elParent = this.resolveComponentParent(el);
                } else if (isContainer(el)) {
                    elParent = this.resolveConatinerParent(el);
                } else if (isDeploymentNode(el) || isSoftwareSystemInstance(el) || isContainerInstance(el)) {
                    elParent = this.resolveDeploymentNodeParent(el);
                }
                if (elParent === e.element.ref || this.getId(elParent) === this.getId(e.element.ref)) {
                    if (isAllowed(el)) res.add(el);
                }
            });
        }
        // element.tag==<tag>[,tag]: all elements that have all of the specified tags
        // element.tag!=<tag>[,tag]: all elements that do not have all of the specified tags
        else if (isElementTagExpression(e)) {
            const searchTags = e.values.map(t => StringUtils.stripQuotes(t));
            this.elements.forEach(el => {
                const elTags = this.extractTags(el)?.split(',') || [];
                const hasAllTags = searchTags.every(st => elTags.includes(st));
                const matches = e.operator === '==' ? hasAllTags : !hasAllTags;
                if (matches && isAllowed(el)) res.add(el);
            });
        }
        // element.technology==<technology>: all elements with the specified technology
        // element.technology!=<technology>: all elements without the specified technology
        else if (isElementTechnologyExpression(e)) {
            const searchTech = StringUtils.stripQuotes(e.value);
            this.elements.forEach(el => {
                const elTech = this.technology(el) || '';
                const matches = e.operator === '==' ? elTech === searchTech : elTech !== searchTech;
                if (matches && isAllowed(el)) res.add(el);
            });
        }
        // element.properties[name]==value: all elements that have the specified property with the specified value
        else if (isElementPropertiesExpression(e)) {
            const propName = StringUtils.stripQuotes(e.name);
            const propValue = StringUtils.stripQuotes(e.value);
            this.elements.forEach(el => {
                const props = (el as any).properties?.at(0);
                if (props && Array.isArray(props.items)) {
                    const match = props.items.find((item: any) =>
                        StringUtils.stripQuotes(item.name) === propName &&
                        StringUtils.stripQuotes(item.value) === propValue
                    );
                    if (match && isAllowed(el)) res.add(el);
                }
            });
        }
        // element.group==name
        else if (isElementGroupExpression(e)) {
            const searchGroup = StringUtils.stripQuotes(e.value);
            this.elements.forEach(el => {
                const elGroup = this.extractGroup(el) || '';
                if (elGroup === searchGroup && isAllowed(el)) res.add(el);
            });
        }
        // relationship.tag==<tag>[,tag]: all relationships that have all of the specified tags
        // relationship.tag!=<tag>[,tag]: all relationships that do not have all of the specified tags
        else if (isRelationshipTagExpression(e)) {
            const searchTags = e.values.map(t => StringUtils.stripQuotes(t));
            relationshipsAtScope.forEach(r => {
                const relTags = this.extractTags(r, 'Relationship')?.split(',') || [];
                const hasAllTags = searchTags.every(st => relTags.includes(st));
                const matches = e.operator === '==' ? hasAllTags : !hasAllTags;
                if (matches) {
                    if(elementsAtView.has(r.source) && elementsAtView.has(r.target)) res.add(r.relationship);
                }
            });
        }
        // relationship.source==<identifier>: all relationships with the specified source element
        else if (isRelationshipSourceExpression(e)) {
            if (e.element.ref && elementsAtView.has(e.element.ref)) relationshipsAtScope.forEach(r => {
                if (r.source === e.element.ref && elementsAtView.has(r.target)) res.add(r.relationship);
            });
        }
        // relationship.destination==<identifier>: all relationships with the specified destination element
        else if (isRelationshipDestinationExpression(e)) {
            if (e.element.ref && elementsAtView.has(e.element.ref)) relationshipsAtScope.forEach(r => {
                if (r.target === e.element.ref && elementsAtView.has(r.source)) res.add(r.relationship);
            });
        }
        // relationship.properties[name]==value: all relationships that have the specified property with the specified value
        else if (isRelationshipPropertiesExpression(e)) {
            const propName = StringUtils.stripQuotes(e.name);
            const propValue = StringUtils.stripQuotes(e.value);
            relationshipsAtScope.forEach(r => {
                const props = (r as any).properties?.at(0);
                if (props && Array.isArray(props.items)) {
                    const match = props.items.find((item: any) =>
                        StringUtils.stripQuotes(item.name) === propName &&
                        StringUtils.stripQuotes(item.value) === propValue
                    );
                    if (match) {
                        if(elementsAtView.has(r.source) && elementsAtView.has(r.target)) res.add(r.relationship);
                    }
                }
            });
        }
        // relationship==* | relationship==<id>->* | relationship==*-><id> | relationship==<id1>-><id2>
        // relationship==*: all relationships
        // relationship==<identifier>->*: all relationships with the specified source element
        // relationship==*-><identifier>: all relationships with the specified destination element
        // relationship==<identifier>-><identifier>: all relationships between the two specified elements
        else if (isRelationshipEqExpression(e)) {
            // relationship==*: all relationships
            if (e.all === '*') {
                relationshipsAtScope.forEach(r => {
                    if(elementsAtView.has(r.source) && elementsAtView.has(r.target)) res.add(r.relationship);
                });
            }
            // relationship==*-><id>: all relationships targeting the specified element
            else if (e.starSource === '*') {
                const t = e.target?.ref;
                if (t && elementsAtView.has(t)) relationshipsAtScope.forEach(r => {
                    if (r.target === t && elementsAtView.has(r.source)) res.add(r.relationship);
                });
            }
            // relationship==<id>->*: all relationships originating from the specified source
            else if (e.starTarget === '*') {
                const s = e.source?.ref;
                if (s && elementsAtView.has(s)) relationshipsAtScope.forEach(r => {
                    if (r.source === s && elementsAtView.has(r.target)) res.add(r.relationship);
                });
            }
            // relationship==<id1>-><id2>: a specific relationship between two elements
            else {
                const s = e.source?.ref;
                const t = e.target?.ref;
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
        const allRels = new Set<ImpliedRelationship>();
        // Build a full relationship set for coupling resolution
        this.elements.forEach(el => {
            if (isSoftwareSystem(el)) this.extractRelationshipsForSoftwareSystem(el).forEach(r => allRels.add(r));
            else if (isPerson(el)) this.extractRelationshipsForPerson(el).forEach(r => allRels.add(r));
            else if (isComponent(el)) this.extractRelationshipsForComponent(el).forEach(r => allRels.add(r));
            else if (isContainer(el)) this.extractRelationshipsForContainer(el).forEach(r => allRels.add(r));
            else if (isCustomElement(el)) this.extractRelationshipsForCustom(el).forEach(r => allRels.add(r));
            else if (isDeploymentNode(el)) this.extractRelationshipsForDeploymentNode(el).forEach(r => allRels.add(r));
            else if (isInfrastructureNode(el)) this.extractRelationshipsForInfrastructureNode(el).forEach(r => allRels.add(r));
            else if (isSoftwareSystemInstance(el)) this.extractRelationshipsForSoftwareSystemInstance(el).forEach(r => allRels.add(r));
            else if (isContainerInstance(el)) this.extractRelationshipsForContainerInstance(el).forEach(r => allRels.add(r));
        });

        // Collect all elements as pass-through (no scope filtering)
        const allElements = new Set<RelationshipMember>();
        this.elements.forEach(el => {
            if (isRelationshipMember(el)) allElements.add(el);
        });

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
        const allRels = new Set<ImpliedRelationship>();
        const allElements = new Set<RelationshipMember>();

        // Build full relationship and element sets
        this.elements.forEach(el => {
            if (isRelationshipMember(el)) allElements.add(el);
            if (isSoftwareSystem(el)) this.extractRelationshipsForSoftwareSystem(el).forEach(r => allRels.add(r));
            else if (isPerson(el)) this.extractRelationshipsForPerson(el).forEach(r => allRels.add(r));
            else if (isComponent(el)) this.extractRelationshipsForComponent(el).forEach(r => allRels.add(r));
            else if (isContainer(el)) this.extractRelationshipsForContainer(el).forEach(r => allRels.add(r));
            else if (isCustomElement(el)) this.extractRelationshipsForCustom(el).forEach(r => allRels.add(r));
            else if (isDeploymentNode(el)) this.extractRelationshipsForDeploymentNode(el).forEach(r => allRels.add(r));
            else if (isInfrastructureNode(el)) this.extractRelationshipsForInfrastructureNode(el).forEach(r => allRels.add(r));
            else if (isSoftwareSystemInstance(el)) this.extractRelationshipsForSoftwareSystemInstance(el).forEach(r => allRels.add(r));
            else if (isContainerInstance(el)) this.extractRelationshipsForContainerInstance(el).forEach(r => allRels.add(r));
        });

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

            // Apply tags (merge with existing)
            if (extension.tagsProps && extension.tagsProps.length > 0) {
                const newTags: string[] = [];
                for (const tagProp of extension.tagsProps) {
                    const values = (tagProp as any).values || (tagProp as any).value;
                    if (Array.isArray(values)) {
                        for (const v of values) {
                            const stripped = StringUtils.stripQuotes(typeof v === 'string' ? v : v.value);
                            if (stripped) {
                                for (const t of stripped.split(',')) {
                                    const trimmed = t.trim();
                                    if (trimmed) newTags.push(trimmed);
                                }
                            }
                        }
                    } else if (typeof values === 'string') {
                        const stripped = StringUtils.stripQuotes(values);
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
                overlay.url = StringUtils.stripQuotes(urlProp.value) || overlay.url;
            }

            // Apply properties (merge)
            if (extension.properties && extension.properties.length > 0) {
                for (const propBlock of extension.properties) {
                    if (propBlock.items) {
                        for (const item of propBlock.items) {
                            const name = StringUtils.stripQuotes(item.name);
                            const value = StringUtils.stripQuotes(item.value);
                            if (name && value) {
                                if (!overlay.properties) overlay.properties = {};
                                overlay.properties[name] = value;
                            }
                        }
                    }
                }
            }

            // Apply perspectives
            if (extension.perspectivesBlocks && extension.perspectivesBlocks.length > 0) {
                overlay.perspectives = extension.perspectivesBlocks;
            }
        }
    }

    /**
     * Applies tags, url, properties, and perspectives from a !relationships directive
     * to all matched relationships. Uses overlay maps to avoid mutating AST nodes.
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

            // Apply tags (merge)
            if (directive.tagsProps && directive.tagsProps.length > 0) {
                const newTags: string[] = [];
                for (const tagProp of directive.tagsProps) {
                    const values = (tagProp as any).values || (tagProp as any).value;
                    if (Array.isArray(values)) {
                        for (const v of values) {
                            const stripped = StringUtils.stripQuotes(typeof v === 'string' ? v : v.value);
                            if (stripped) {
                                for (const t of stripped.split(',')) {
                                    const trimmed = t.trim();
                                    if (trimmed) newTags.push(trimmed);
                                }
                            }
                        }
                    } else if (typeof values === 'string') {
                        const stripped = StringUtils.stripQuotes(values);
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
            if (directive.urlProps && directive.urlProps.length > 0) {
                const urlProp = directive.urlProps[0];
                overlay.url = StringUtils.stripQuotes(urlProp.value) || overlay.url;
            }

            // Apply properties (merge)
            if (directive.properties && directive.properties.length > 0) {
                for (const propBlock of directive.properties) {
                    if (propBlock.items) {
                        for (const item of propBlock.items) {
                            const name = StringUtils.stripQuotes(item.name);
                            const value = StringUtils.stripQuotes(item.value);
                            if (name && value) {
                                if (!overlay.properties) overlay.properties = {};
                                overlay.properties[name] = value;
                            }
                        }
                    }
                }
            }

            // Apply perspectives
            if (directive.perspectivesBlocks && directive.perspectivesBlocks.length > 0) {
                overlay.perspectives = directive.perspectivesBlocks;
            }
        }
    }

    /**
     * Traverses the workspace AST (including !includes) and processes all
     * !elements directives.
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

        // Handle Workspace — step into model blocks
        if (isWorkspace(node)) {
            if (node.modelBlocks.at(0)) {
                this.processElementsDirectives(node.modelBlocks.at(0), visited);
            }
            return;
        }

        // Note: visited is used ONLY for !include and extends cycle prevention.
        // Structural recursion (into elements, model blocks) does NOT use visited,
        // because elements within the same document must be traversed freely.

        const anyNode = node as any;

        // Process elementsDirectives found on this node (!elements)
        if (Array.isArray(anyNode.elementsDirectives)) {
            for (const ext of anyNode.elementsDirectives) {
                if (isElementsDirective(ext)) {
                    this.applyElementsExtension(ext);
                }
            }
        }

        // Recurse into child elements (no visited check — same document traversal)
        if (Array.isArray(anyNode.elements)) {
            for (const el of anyNode.elements) {
                this.processElementsDirectives(el, visited);
            }
        }

        // Recurse into !include directives (with visited check for cycle prevention)
        if (Array.isArray(anyNode.includes)) {
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

        // Handle extends
        if (isWorkspace(node) && node.extendsUri) {
            const parentWs = this.resolveParentWorkspace(node, node.extendsUri);
            if (parentWs) {
                this.processElementsDirectives(parentWs, visited);
            }
        }
    }

    /**
     * Traverses the workspace AST (including !includes) and processes all
     * !relationships directives.
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

        // Handle Workspace — step into model blocks
        if (isWorkspace(node)) {
            if (node.modelBlocks.at(0)) {
                this.processRelationshipsDirectives(node.modelBlocks.at(0), visited);
            }
            return;
        }

        // Note: visited is used ONLY for !include cycle prevention.

        const anyNode = node as any;

        // Process relationshipsDirectives found on this node
        if (Array.isArray(anyNode.relationshipsDirectives)) {
            for (const dir of anyNode.relationshipsDirectives) {
                if (isRelationshipsDirective(dir)) {
                    this.applyRelationshipsDirective(dir);
                }
            }
        }

        // Recurse into child elements (no visited check — same document traversal)
        if (Array.isArray(anyNode.elements)) {
            for (const el of anyNode.elements) {
                this.processRelationshipsDirectives(el, visited);
            }
        }

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

        // Handle extends
        if (isWorkspace(node) && node.extendsUri) {
            const parentWs = this.resolveParentWorkspace(node, node.extendsUri);
            if (parentWs) {
                this.processRelationshipsDirectives(parentWs, visited);
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
        const relationshipsAllowed = new Set<ImpliedRelationship>();
        this.elements.forEach(el => {
            if(isSoftwareSystem(el)) this.extractRelationshipsForSoftwareSystem(el).forEach(rel => relationshipsAllowed.add(rel));
            else if(isPerson(el)) this.extractRelationshipsForPerson(el).forEach(rel => relationshipsAllowed.add(rel));
            else if(isComponent(el)) this.extractRelationshipsForComponent(el).forEach(rel => relationshipsAllowed.add(rel));
            else if(isContainer(el)) this.extractRelationshipsForContainer(el).forEach(rel => relationshipsAllowed.add(rel));
            else if(isCustomElement(el)) this.extractRelationshipsForCustom(el).forEach(rel => relationshipsAllowed.add(rel));            
        });

        // scope guard: only Components (belonging to scope), Containers (same system), SoftwareSystems, Persons, CustomElements
        const isAllowed = (element: NamedElement | undefined) : element is (SoftwareSystem | Person | Container | CustomElement) => {
            // Component must belong to the scope Container
            if(isComponent(element)) return this.resolveComponentParent(element) === scopeContainer;
            // the scope Container is not a visible element (rendered as a boundary)
            if(element === scopeContainer) return false;
            // Container must belong to the same parent system as the scope Container
            if(isContainer(element)) {
                const scopeContainerParent = this.resolveConatinerParent(scopeContainer);
                const containerParent = this.resolveConatinerParent(element);
                return (scopeContainerParent === containerParent);
            }
            // the parent SoftwareSystem of scope Container is not visible (rendered as a boundary)
            if(isSoftwareSystem(element)) {
                const scopeContainerParent = this.resolveConatinerParent(scopeContainer);
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

            if (isInclude && prop.all === '*') {

                // add all Components belonging to the scope Container
                this.elements.forEach(el => {
                    if(isComponent(el) && this.resolveComponentParent(el) === scopeContainer) {
                        elementsAtView.add(el);
                    }
                });

                // add any external element that has a relationship with an already visible component
                const include = new Set<RelationshipMember>();
                this.elements.filter(isAllowed).forEach(el => {
                    relationshipsAllowed.forEach(r => {
                        if (r.source === el && r.target && elementsAtView.has(r.target)) include.add(el);
                        if (r.target === el && r.source && elementsAtView.has(r.source)) include.add(el);
                    });
                });
                include.forEach(el => elementsAtView.add(el));

                // add relationships between visible elements
                relationshipsAllowed.forEach(r => {
                    if (elementsAtView.has(r.source) && elementsAtView.has(r.target)) relationshipsAtView.add(r.relationship);
                });
            }

            // process explicit expression-based include/exclude directives
            prop.expressions.forEach((expr: { expression: ViewExpression; }) => {
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
                            isInclude ? relationshipsAtView.add(e) : relationshipsAtView.delete(e);
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
        // collect all implied relationships for all elements in the model
        const relationshipsAllowed = new Set<ImpliedRelationship>();
        this.elements.forEach(el => {
            if(isSoftwareSystem(el)) this.extractRelationshipsForSoftwareSystem(el).forEach(rel => relationshipsAllowed.add(rel));
            else if(isPerson(el)) this.extractRelationshipsForPerson(el).forEach(rel => relationshipsAllowed.add(rel));
            else if(isComponent(el)) this.extractRelationshipsForComponent(el).forEach(rel => relationshipsAllowed.add(rel));
            else if(isContainer(el)) this.extractRelationshipsForContainer(el).forEach(rel => relationshipsAllowed.add(rel));
            else if(isCustomElement(el)) this.extractRelationshipsForCustom(el).forEach(rel => relationshipsAllowed.add(rel));
        });

        // scope guard: only Containers (belonging to scope), SoftwareSystems, Persons, and CustomElements
        // the scope SoftwareSystem itself is excluded (it's rendered as a boundary cluster instead)
        const isAllowed = (element: NamedElement | undefined) : element is (SoftwareSystem | Person | Container | CustomElement) => {
            // Container must belong to the scope SoftwareSystem
            if(isContainer(element)) return this.resolveConatinerParent(element) === scopeSoftwareSystem;
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

            if (isInclude && prop.all === '*') {
                // add all Containers belonging to the scope SoftwareSystem
                this.elements.forEach(el => {
                    if(isContainer(el) && this.resolveConatinerParent(el) === scopeSoftwareSystem) {
                        elementsAtView.add(el);
                    }
                });

                // add any external element that has a relationship with an already visible container
                const include = new Set<RelationshipMember>();
                this.elements.filter(isAllowed).forEach(el => {
                    relationshipsAllowed.forEach(r => {
                        if (r.source === el && elementsAtView.has(r.target)) include.add(el);
                        else if (r.target === el && elementsAtView.has(r.source)) include.add(el);
                    });
                });
                include.forEach(el => elementsAtView.add(el));

                // add relationships between visible elements
                relationshipsAllowed.forEach(r => {
                    if (elementsAtView.has(r.source) && elementsAtView.has(r.target)) relationshipsAtView.add(r.relationship);
                });
            }

            // process explicit expression-based include/exclude directives
            prop.expressions.forEach((expr: { expression: ViewExpression; }) => {
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
                            isInclude ? relationshipsAtView.add(e) : relationshipsAtView.delete(e);
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
        // collect all relationships for custom elements
        const relationshipsAllowed = new Set<ImpliedRelationship>();
        this.elements.forEach(el => {
            if(isCustomElement(el)) this.extractRelationshipsForCustom(el).forEach(rel => relationshipsAllowed.add(rel));
        });

        // scope guard: only CustomElements are allowed on Custom diagrams
        const isInScope = (element: NamedElement | undefined) : element is CustomElement => isCustomElement(element);

        // process include/exclude operations in declaration order
        const orderedOps = this.getIncludeExclude(view);        
        for (const op of orderedOps) {
            const prop = op.prop;
            const isInclude = isIncludeProperty(prop);

            if (isInclude && prop.all === '*') {
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
                            isInclude ? relationshipsAtView.add(e) : relationshipsAtView.delete(e);
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

        const rels = new Set<ImpliedRelationship>();
        this.elements.forEach(el => {
            if(isSoftwareSystem(el)) this.extractRelationshipsForSoftwareSystem(el).forEach(rel => rels.add(rel));
            else if(isPerson(el)) this.extractRelationshipsForPerson(el).forEach(rel => rels.add(rel));
            else if(isComponent(el)) this.extractRelationshipsForComponent(el).forEach(rel => rels.add(rel));
            else if(isContainer(el)) this.extractRelationshipsForContainer(el).forEach(rel => rels.add(rel));
            else if(isCustomElement(el)) this.extractRelationshipsForCustom(el).forEach(rel => rels.add(rel));
        });

        // scope guard: only top-level elements (SoftwareSystem, Person, CustomElement) are allowed on System Context
        const isInScope = (element: NamedElement | undefined) : element is (SoftwareSystem | Person | CustomElement) => {
            return (isSoftwareSystem(element) || isPerson(element) || isCustomElement(element));
        };

        // process include/exclude operations in declaration order
        for (const op of orderedOps) {
            const prop = op.prop;
            const isInclude = isIncludeProperty(prop);

            if (isInclude && prop.all === '*') {
                // add the scope SoftwareSystem to the diagram
                elementsAtView.add(scopeSoftwareSystem);

                // add any top-level element that has a direct relationship with the scope system
                this.elements.filter(isInScope).forEach(el => {
                    rels.forEach(r => {
                        if (r.source === el && r.target === scopeSoftwareSystem) {
                            elementsAtView.add(el);
                        } else if (r.target === el && r.source === scopeSoftwareSystem) {
                            elementsAtView.add(el);
                        }
                    });
                });

                // add relationships between visible elements
                rels.forEach(r => {
                    if (elementsAtView.has(r.source) && elementsAtView.has(r.target)) relationshipsAtView.add(r.relationship);
                });
            }

            // process explicit expression-based include/exclude directives
            prop.expressions.forEach((expr: { expression: ViewExpression; }) => {
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
                            isInclude ? elementsAtView.add(e) : elementsAtView.delete(e);
                        } else if (isRelationship(e)) {
                            isInclude ? relationshipsAtView.add(e) : relationshipsAtView.delete(e);
                        }
                    });
                }
            });

        }
        this.filterDuplicateRelationships(relationshipsAtView);
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
        const relationshipsAllowed = new Set<ImpliedRelationship>();
        this.elements.forEach(el => {
            if(isSoftwareSystem(el)) this.extractRelationshipsForSoftwareSystem(el).forEach(rel => relationshipsAllowed.add(rel));
            else if(isPerson(el)) this.extractRelationshipsForPerson(el).forEach(rel => relationshipsAllowed.add(rel));
            else if(isComponent(el)) this.extractRelationshipsForComponent(el).forEach(rel => relationshipsAllowed.add(rel));
            else if(isContainer(el)) this.extractRelationshipsForContainer(el).forEach(rel => relationshipsAllowed.add(rel));
            else if(isCustomElement(el)) this.extractRelationshipsForCustom(el).forEach(rel => relationshipsAllowed.add(rel));
        });

        // scope guard: only top-level elements (SoftwareSystem, Person, CustomElement) are allowed on System Landscape
        const isAllowed = (element: NamedElement | undefined) : element is (SoftwareSystem | Person | CustomElement) => isSoftwareSystem(element) || isPerson(element) || isCustomElement(element);

        // process include/exclude operations in declaration order
        const orderedOps = this.getIncludeExclude(view);
        for (const op of orderedOps) {
            const prop = op.prop;
            const isInclude = isIncludeProperty(prop);

            if (isInclude && prop.all === '*') {
                // add all SoftwareSystem and Person elements (top-level only)
                this.elements.forEach(el => {
                    if(isSoftwareSystem(el) || isPerson(el)) elementsAtView.add(el);
                });
                
                // add any CustomElement that has a relationship with an already visible element
                const include = new Set<RelationshipMember>();
                this.elements.filter(isAllowed).forEach(el => {
                    relationshipsAllowed.forEach(r => {
                        if (r.source === el && elementsAtView.has(r.target)) include.add(el);
                        if (r.target === el && elementsAtView.has(r.source)) include.add(el);
                    });
                });
                include.forEach(el => elementsAtView.add(el));

                // add relationships between visible elements
                relationshipsAllowed.forEach(r => {
                    if (elementsAtView.has(r.source) && elementsAtView.has(r.target)) relationshipsAtView.add(r.relationship);
                });
            }

            // process explicit expression-based include/exclude directives
            prop.expressions.forEach((expr: { expression: ViewExpression; }) => {
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
                            isInclude ? relationshipsAtView.add(e) : relationshipsAtView.delete(e);
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
    private resolveDeployment(
        view: DeploymentView,
        elementsAtView: Set<RelationshipMember>,
        relationshipsAtView: Set<Relationship>,
        environment?: string,
        softwareSystem?: SoftwareSystem
    ) {
        // collect all relationships for deployment elements matching the environment
        const rels = new Set<ImpliedRelationship>();
        this.elements.forEach(el => {
            if (isDeploymentNode(el)) {
                if (!environment || environment === this.getEnvironment(el)) this.extractRelationshipsForDeploymentNode(el).forEach(r => rels.add(r));
            } else if (isInfrastructureNode(el)) {
                if (!environment || environment === this.getEnvironment(el)) this.extractRelationshipsForInfrastructureNode(el).forEach(r => rels.add(r));
            } else if (isSoftwareSystemInstance(el)) {
                if (!environment || environment === this.getEnvironment(el)) this.extractRelationshipsForSoftwareSystemInstance(el).forEach(r => rels.add(r));
            } else if (isContainerInstance(el)) {
                if (!environment || environment === this.getEnvironment(el)) this.extractRelationshipsForContainerInstance(el).forEach(r => rels.add(r));
            } else if(isCustomElement(el)) this.extractRelationshipsForCustom(el).forEach(rel => rels.add(rel));
        });

        // scope guard: only deployment elements matching the environment (and optionally softwareSystem) are allowed
        const isAllowed = (el: NamedElement | undefined) : el is (DeploymentNode | InfrastructureNode | SoftwareSystemInstance | ContainerInstance | CustomElement) => {
            // DeploymentNode and InfrastructureNode must match the environment
            if(isDeploymentNode(el) || isInfrastructureNode(el)) {
                return (!environment || environment === this.getEnvironment(el));
            }
            // SoftwareSystemInstance must match environment and optionally the scope SoftwareSystem
            if(isSoftwareSystemInstance(el)) {
                return ((!environment || environment === this.getEnvironment(el)));
            }
            // ContainerInstance must match environment and optionally belong to the scope SoftwareSystem
            if(isContainerInstance(el)) {
                return ((!environment || environment === this.getEnvironment(el)));
            }
            // CustomElement is always allowed
            return isCustomElement(el);
        };

        // process include/exclude operations in declaration order
        const orderedOps = this.getIncludeExclude(view);

        for (const op of orderedOps) {
            const prop = op.prop;
            const isInclude = isIncludeProperty(prop);

            if (isInclude && prop.all === '*') {
                // add all deployment elements matching the environment
                this.elements.forEach(el => {
                    if(isDeploymentNode(el) || isInfrastructureNode(el)) {
                        if(!environment || environment === this.getEnvironment(el)) elementsAtView.add(el);
                    }
                    if(isSoftwareSystemInstance(el)) {
                        if ((!environment || environment === this.getEnvironment(el)) && (!softwareSystem || softwareSystem === el.softwareSystem.ref)) elementsAtView.add(el);
                    }
                    if(isContainerInstance(el)) {
                        if ((!environment || environment === this.getEnvironment(el)) && (!softwareSystem || (el.container.ref !== undefined && this.resolveConatinerParent(el.container.ref) === softwareSystem))) elementsAtView.add(el);
                    }
                });                

                // add any additional element that has a relationship with an already visible element
                const include = new Set<RelationshipMember>();
                this.elements.filter(isAllowed).forEach(el => {
                    rels.forEach(r => {
                        if (r.source === el && elementsAtView.has(r.target)) include.add(el);
                        if (r.target === el && elementsAtView.has(r.source)) include.add(el);
                    });
                });
                include.forEach(el => elementsAtView.add(el));

                // add relationships between visible elements
                rels.forEach(r => {
                    if (elementsAtView.has(r.source) && elementsAtView.has(r.target)) relationshipsAtView.add(r.relationship);
                });
            }

            // process explicit expression-based include/exclude directives
            prop.expressions.forEach((expr: { expression: ViewExpression; }) => {
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
                            isInclude ? relationshipsAtView.add(e) : relationshipsAtView.delete(e);
                        }
                    });
                }
            });
        }
        
        // After processing all include/exclude directives, add parent DeploymentNode elements
        const currentElements = Array.from(elementsAtView);
        currentElements.forEach(el => this.collectDeploymentParents(el, elementsAtView, environment));

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
            // check for logical C4 elements
            if (isSoftwareSystem(parent) || isContainer(parent) || isComponent(parent)) {
                return parent;
            }
            // check for physical deployment elements
            if (isDeploymentNode(parent) || 
                isInfrastructureNode(parent) || 
                isSoftwareSystemInstance(parent) || 
                isContainerInstance(parent)) {
                return parent;
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
                        if (isSoftwareSystem(parent) || isContainer(parent) || isComponent(parent)) {
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
     * Removes duplicate relationships from a set. For pairs sharing the same source and target,
     * only the relationship with the lowest CST offset (declared earliest in source code) is kept.
     * Uses a map keyed by "sourceId|targetId" to track the best candidate per pair.
     * @param relationshipsSet The set of relationships to filter for duplicates
     */
    private filterDuplicateRelationships(relationshipsSet: Set<Relationship>): void {
        // Map: "sourceId|targetId" -> relationship with the smallest offset
        const bestPerPair = new Map<string, Relationship>();

        for (const rel of relationshipsSet) {
            const source = this.resolveSource(rel);
            const target = this.resolveTarget(rel);
            if (!source || !target) continue;

            const sourceId = this.getId(source);
            const targetId = this.getId(target);
            const key = `${sourceId}|${targetId}`;

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
                return 'LeftRight';
        }
    }

    /**
     * Extracts System Context views from the workspace. Each view is scoped to a SoftwareSystem
     * and includes that system, its direct relationships, and related people/systems.
     */
    private extractSystemContextViews(workspace: Workspace, model: any) {
        const views = workspace.viewsBlocks?.at(0)?.views.filter(isSystemContextView)
        .map(view => {
            const scopeSystem = view.softwareSystem?.ref;
            if(scopeSystem === undefined) return undefined;
            const elements = new Set<RelationshipMember>();
            const relationships = new Set<Relationship>();
            this.resolveSystemContext(view, elements, relationships, scopeSystem);
            return {
                softwareSystemId: this.getId(scopeSystem),
                key: this.substitute(this.services.workspace.ViewKeyProvider.getKey(view)),
                title: this.substitute(view.titleProps?.at(0)?.value),
                elements: Array.from(elements).map(el => this.elementJson(el)),
                relationships: Array.from(relationships).map(el => this.elementJson(el)),
                externalSoftwareSystemBoundariesVisible: true,
                automaticLayout: this.transformAutoLayout(view)
            };
        });
        return views && views?.length > 0 ? views : undefined; 
    }    

    /**
     * Extracts Container views from the workspace for a given SoftwareSystem scope.
     * Resolves all container-level elements and their relationships within the system.
     */
    private extractContainerViews(workspace: Workspace, model: any) {
        const views = workspace.viewsBlocks?.at(0)?.views.filter(isContainerView)
            .map(view => {
                const scopeSystem = view.softwareSystem?.ref;
                if(scopeSystem === undefined) return undefined;
                let elements = new Set<RelationshipMember>();
                let relationships = new Set<Relationship>();
                this.resolveContainer(view, elements, relationships, scopeSystem);
                return {
                    softwareSystemId: this.getId(scopeSystem),
                    key: this.substitute(this.services.workspace.ViewKeyProvider.getKey(view)),
                    title: this.substitute(view.titleProps?.at(0)?.value),
                    description: this.description(view),
                    elements: Array.from(elements).map(el => this.elementJson(el)),// elements,,
                    relationships: Array.from(relationships).map(el => this.elementJson(el)),
                    externalSoftwareSystemBoundariesVisible: true,
                    automaticLayout: this.transformAutoLayout(view)
                }
            });
        return views && views.length > 0 ? views : undefined;
    }

    /**
     * Extracts Component views from the workspace, scoped to a specific Container.
     * Shows the components within a container, their relationships, and related people/systems.
     */
    private extractComponentViews(workspace: Workspace, model: any) {
        const views = workspace.viewsBlocks?.at(0)?.views.filter(isComponentView)
            .map(view => {
                const scopeContainer = view.container?.ref;
                if(scopeContainer === undefined) return undefined;
                const elements = new Set<RelationshipMember>();
                const relationships = new Set<Relationship>();
                this.resolveComponent(view, elements, relationships, scopeContainer);
                return {
                    containerId: this.getId(scopeContainer),
                    key: this.substitute(this.services.workspace.ViewKeyProvider.getKey(view)),
                    title: this.substitute(view.titleProps?.at(0)?.value),
                    description: this.description(view),
                    elements: Array.from(elements).map(el => this.elementJson(el)),// elements,,
                    relationships: Array.from(relationships).map(el => this.elementJson(el)),
                    externalSoftwareSystemBoundariesVisible: true,
                    automaticLayout: this.transformAutoLayout(view)
                };
            });
        return views && views.length > 0 ? views : undefined;
    }

    /**
     * Resolves the deployment environment name for a deployment-related element by climbing
     * the AST $container chain. For !include files, looks up the Include directive context
     * since $container points to the document root rather than the logical parent.
     */
    private getEnvironment(deploymentNode: DeploymentNode | SoftwareSystemInstance | ContainerInstance | InfrastructureNode | Group): string | undefined {
        const parent = deploymentNode.$container;
        if(parent) {
            if(isDeploymentEnvironment(parent)) {
                return StringUtils.stripQuotes(parent.name);
            }
            if(isDeploymentNode(parent) || isSoftwareSystemInstance(parent) || isContainerInstance(parent) || isInfrastructureNode(parent) || isGroup(parent)) {
                return this.getEnvironment(parent);
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
                            return StringUtils.stripQuotes((current as any).name);
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
        const views = workspace.viewsBlocks?.at(0)?.views.filter(isDeploymentView)
            .map(view => {
                const scopeSystem = view.softwareSystem?.ref;
                const environment = (view.all === '*' || !view.environment.ref) ? undefined : StringUtils.stripQuotes(view.environment.ref.name);
                const elements = new Set<RelationshipMember>();
                const relationships = new Set<Relationship>();
                this.resolveDeployment(view, elements, relationships, environment, scopeSystem);
                return {
                    key: this.substitute(this.services.workspace.ViewKeyProvider.getKey(view)),
                    title: this.substitute(view.titleProps?.at(0)?.value),
                    description: this.description(view),
                    softwareSystemId: scopeSystem ? this.getId(scopeSystem) : undefined,
                    environment: environment,
                    elements: Array.from(elements).map(el => this.elementJson(el)),// elements,,
                    relationships: Array.from(relationships).map(el => this.elementJson(el)),
                    automaticLayout: this.transformAutoLayout(view)
                };
            });
        return views && views.length > 0 ? views : undefined;
    }
    
    /**
     * Extracts Dynamic views from the workspace. Processes sequenced interaction steps
     * between elements with ordering and optional parallel block grouping.
     */
    private extractDynamicViews(workspace: Workspace) {
        const viewsList = workspace.viewsBlocks?.[0]?.views;
        if (!Array.isArray(viewsList)) return undefined;
        const views = viewsList
            .filter(isDynamicView)
            .map(view => {
                const scopeElement = view.element?.ref;
                const content = this.resolveDynamic(view);
                return {
                    key: this.substitute(this.services.workspace.ViewKeyProvider.getKey(view)),
                    title: this.substitute(view.titleProps?.[0]?.value) ?? "Dynamic View",
                    description: this.description(view),
                    elementId: scopeElement ? this.getId(scopeElement) : undefined,
                    elements: content.elements,
                    relationships: content.relationships,
                    automaticLayout: this.transformAutoLayout(view)
                };
            });

        return views.length ? views : undefined;
    }

    /**
     * Extracts Filtered views from the workspace. A filtered view references a base view
     * and filters its elements by tags using either Include or Exclude mode.
     */
    private extractFilteredViews(workspace: Workspace) {
        const views = workspace.viewsBlocks?.at(0)?.views.filter(isFilteredView)
            .map(view => {
                return {
                    key: this.substitute(this.services.workspace.ViewKeyProvider.getKey(view)),
                    baseViewKey: this.substitute(view.baseKey),
                    mode: view.mode === 'include' ? 'Include' : 'Exclude',
                    tags: this.parseTags(view.tagsProp),
                    title: this.substitute(view.titleProps?.at(0)?.value),
                    description: this.description(view)
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

        // Global counter for top-level sequential steps
        let globalSequence = 1;

        // Recursive helper for traversing steps (including parallel blocks)
        const traverse = (members: DynamicMember[], currentParallelOrder?: string, isParallelBlock = false) => {
            const blockOrder = currentParallelOrder || globalSequence.toString();

            members.forEach(member => {
                if (isDynamicStep(member)) {
                    const source = member.from?.ref;
                    const target = member.target?.ref;
                    if (!source || !target) return;

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

                    // Find direct relationship in the global model
                    let modelRel = this.relationships.find(rel =>
                        this.resolveSource(rel) === source && this.resolveTarget(rel) === target
                    );

                    let isResponse = false;

                    // If no direct relationship, look for reverse (response) relationship
                    if (!modelRel) {
                        modelRel = this.relationships.find(rel =>
                            this.resolveSource(rel) === target && this.resolveTarget(rel) === source
                        );

                        if (modelRel) {
                            isResponse = true;
                        }
                    }

                    // If relationship found (direct or reverse), emit the step
                    if (modelRel) {
                        const stepDescription = this.description(member) || (isResponse ? undefined : this.description(modelRel));
                        steps.push({
                            id: this.getId(modelRel),
                            order: finalOrder,
                            description: stepDescription,
                            response: isResponse
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
            relationships: steps
        };
    }

    /** Escapes double quotes in a string for safe JSON output. */
    private escapeQuotes(str: string): string {
        return str.replace(/"/g, '\\"');
    }

    /** Parses a comma-separated tag string into a cleaned array of tags. */
    private readonly parseTags = (p: string | undefined): string[] =>
        (this.substitute(p) ?? '').split(',').map(StringUtils.stripQuotes).filter(Boolean);

};

/**
 * Public API for JSON generation. Delegates to the internal JsonGenerator class
 * which handles the full workspace-to-JSON transformation.
 */
export class C4JsonGenerator {

    private readonly services: C4Services;
    constructor(services: C4Services) {
        this.services = services;
    }

    /**
     * Generates a Structurizr-compatible JSON representation of the given workspace.
     * @param workspace The workspace AST node to generate JSON for
     * @returns A JSON object matching the Structurizr output format
     */
    public generate(workspace: Workspace) {
        let jsonGenerator : JsonGenerator = new JsonGenerator(this.services);
        return jsonGenerator.generate(workspace);
    }
}