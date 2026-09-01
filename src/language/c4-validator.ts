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

import { AstNode, AstUtils, type ValidationAcceptor, type ValidationChecks } from 'langium';
import { ElementStyleDescriptionProperty, InstancesProperty, isArchetypeDefinition, isComponent, isComponentView, isContainer, isContainerInstance, isContainerView, isCustomElement, isCustomView, isDeploymentGroup, isDeploymentNode, isDeploymentView, isDynamicView, isFilteredView, isImageView, isInfrastructureNode, isNamedElement, isPerson, isRelationship, isSoftwareSystem, isGroup, isSoftwareSystemInstance, isSystemContextView, isSystemLandscapeView, NamedElement, RelationshipStyle, ViewsBlock, type C4AstType, type Workspace, PropertyItem, ModelBlock, isDeploymentEnvironment, Include, SoftwareSystem } from '../generated/ast';
import type { C4Services } from './c4-module';
import { getBlockTokens, isTypeAllowedInBlock } from './c4-tokens';
import * as includeResolver from './c4-include-resolver';
import { Utils } from 'vscode-uri';

/** Normalizes lowercase shape names to Structurizr PascalCase format (Box, RoundedBox, Cylinder, etc.) */
export const SHAPE_NORMALIZE: Record<string, string> = {
    'box': 'Box',
    'roundedbox': 'RoundedBox',
    'circle': 'Circle',
    'ellipse': 'Ellipse',
    'hexagon': 'Hexagon',
    'diamond': 'Diamond',
    'cylinder': 'Cylinder',
    'bucket': 'Bucket',
    'pipe': 'Pipe',
    'person': 'Person',
    'robot': 'Robot',
    'folder': 'Folder',
    'webbrowser': 'WebBrowser',
    'window': 'Window',
    'terminal': 'Terminal',
    'shell': 'Shell',
    'mobiledeviceportrait': 'MobileDevicePortrait',
    'mobiledevicelandscape': 'MobileDeviceLandscape',
    'component': 'Component'
};

const VALID_SHAPES = new Set(Object.keys(SHAPE_NORMALIZE));

/** Normalizes lowercase border style names to PascalCase (Solid, Dashed, Dotted) */
export const BORDER_NORMALIZE: Record<string, string> = {
    'solid': 'Solid',
    'dashed': 'Dashed',
    'dotted': 'Dotted'
};

const VALID_BORDER_STYLES = new Set(Object.keys(BORDER_NORMALIZE));

/** Normalizes lowercase routing names to PascalCase (Direct, Orthogonal, Curved) */
export const ROUTING_NORMALIZE: Record<string, string> = {
    'direct': 'Direct',
    'orthogonal': 'Orthogonal',
    'curved': 'Curved'
};

/** Set of valid CSS named colors for validation of color properties */
const CSS_NAMED_COLORS = new Set([
    'aliceblue','antiquewhite','aqua','aquamarine','azure','beige','bisque','black','blanchedalmond','blue',
    'blueviolet','brown','burlywood','cadetblue','chartreuse','chocolate','coral','cornflowerblue','cornsilk',
    'crimson','cyan','darkblue','darkcyan','darkgoldenrod','darkgray','darkgrey','darkgreen','darkkhaki',
    'darkmagenta','darkolivegreen','darkorange','darkorchid','darkred','darksalmon','darkseagreen',
    'darkslateblue','darkslategray','darkslategrey','darkturquoise','darkviolet','deeppink','deepskyblue',
    'dimgray','dimgrey','dodgerblue','firebrick','floralwhite','forestgreen','fuchsia','gainsboro',
    'ghostwhite','gold','goldenrod','gray','grey','green','greenyellow','honeydew','hotpink','indianred',
    'indigo','ivory','khaki','lavender','lavenderblush','lawngreen','lemonchiffon','lightblue','lightcoral',
    'lightcyan','lightgoldenrodyellow','lightgray','lightgrey','lightgreen','lightpink','lightsalmon',
    'lightseagreen','lightskyblue','lightslategray','lightslategrey','lightsteelblue','lightyellow','lime',
    'limegreen','linen','magenta','maroon','mediumaquamarine','mediumblue','mediumorchid','mediumpurple',
    'mediumseagreen','mediumslateblue','mediumspringgreen','mediumturquoise','mediumvioletred','midnightblue',
    'mintcream','mistyrose','moccasin','navajowhite','navy','oldlace','olive','olivedrab','orange','orangered',
    'orchid','palegoldenrod','palegreen','paleturquoise','palevioletred','papayawhip','peachpuff','peru','pink',
    'plum','powderblue','purple','red','rosybrown','royalblue','saddlebrown','salmon','sandybrown','seagreen',
    'seashell','sienna','silver','skyblue','slateblue','slategray','slategrey','snow','springgreen','steelblue',
    'tan','teal','thistle','tomato','transparent','turquoise','violet','wheat','white','whitesmoke','yellow','yellowgreen'
]);

/**
 * Registers all validation checks for the C4 language with the Langium validation registry.
 * Maps each AST node type to its validation function(s).
 */
export function registerValidationChecks(services: C4Services) {
    const registry = services.validation.ValidationRegistry;
    const validator = services.validation.C4Validator;
    validator.sharedServices = services.shared;

    const checks: ValidationChecks<C4AstType> = {
        PropertyItem: (node, accept) => validator.checkPropertyItem(node, accept),

        ModelBlock: [
            (node, accept) => validator.checkUniqueElementsInModel(node, accept),
            (node, accept) => validator.checkIncludeElements(node, accept, 'ModelBlock')
        ],
        SoftwareSystem: [
            (node, accept) => validator.checkUniqueContainersInSystem(node, accept),
            (node, accept) => validator.checkIncludeElements(node, accept, 'SoftwareSystem')
        ],
        Container: [
            (node, accept) => validator.checkUniqueComponentsInContainer(node, accept),
            (node, accept) => validator.checkIncludeElements(node, accept, 'Container')
        ],
        Component: [
            (node, accept) => validator.checkIncludeElements(node, accept, 'Component')
        ],
        DeploymentEnvironment: [
            (node, accept) => validator.checkIncludeElements(node, accept, 'DeploymentEnvironment')
        ],
        DeploymentNode: [
            (node, accept) => validator.checkIncludeElements(node, accept, 'DeploymentNode')
        ],
        InfrastructureNode: [
            (node, accept) => validator.checkIncludeElements(node, accept, 'InfrastructureNode')
        ],
        Person: [
            (node, accept) => validator.checkIncludeElements(node, accept, 'Person')
        ],
        SoftwareSystemInstance: [
            (node, accept) => validator.checkIncludeElements(node, accept, 'SoftwareSystemInstance')
        ],
        ContainerInstance: [
            (node, accept) => validator.checkIncludeElements(node, accept, 'ContainerInstance')
        ],
        ViewsBlock: [
            (node, accept) => validator.checkIncludeElements(node, accept, 'ViewsBlock')
        ],
        GenericInstance: [
            (node, accept) => validator.checkIncludeElements(node, accept, 'GenericInstance'),
            (node, accept) => validator.checkGenericInstanceTarget(node, accept)
        ],
        SystemLandscapeView: [
            (node, accept) => validator.checkIncludeElements(node, accept, 'SystemLandscapeView')
        ],
        SystemContextView: [
            (node, accept) => validator.checkIncludeElements(node, accept, 'SystemContextView')
        ],
        ContainerView: [
            (node, accept) => validator.checkViewOrderAndUniqueness(node, accept),
            (node, accept) => validator.checkIncludeElements(node, accept, 'ContainerView')
        ],
        ComponentView: [
            (node, accept) => validator.checkViewOrderAndUniqueness(node, accept),
            (node, accept) => validator.checkIncludeElements(node, accept, 'ComponentView')
        ],
        DeploymentView: [
            (node, accept) => validator.checkIncludeElements(node, accept, 'DeploymentView')
        ],
        DynamicView: [
            (node, accept) => validator.checkIncludeElements(node, accept, 'DynamicView')
        ],
        FilteredView: [
            (node, accept) => validator.checkIncludeElements(node, accept, 'FilteredView')
        ],
        CustomView: [
            (node, accept) => validator.checkIncludeElements(node, accept, 'CustomView')
        ],
        ImageView: [
            (node, accept) => validator.checkIncludeElements(node, accept, 'ImageView')
        ],
        PropertiesBlock: [
            (node, accept) => validator.checkIncludeElements(node, accept, 'PropertiesBlock')
        ],
        Relationship: [
            (node, accept) => validator.checkRelationshipBlockIncludeElements(node, accept)
        ],
        ImplicitRelationship: [
            (node, accept) => validator.checkRelationshipBlockIncludeElements(node, accept)
        ],
        ArchetypesBlock: [
            (node, accept) => validator.checkIncludeElements(node, accept, 'ArchetypesBlock')
        ],
        ArchetypeDefinition: [
            (node, accept) => validator.checkIncludeElements(node, accept, 'ArchetypeDefinition')
        ],
        ArchetypeInstance: [
            (node, accept) => validator.checkIncludeElements(node, accept, 'ArchetypeInstance')
        ],
        ConfigurationBlock: [
            (node, accept) => validator.checkIncludeElements(node, accept, 'ConfigurationBlock')
        ],
        StylesBlock: [
            (node, accept) => validator.checkIncludeElements(node, accept, 'StylesBlock')
        ],
        LightStyleBlock: [
            (node, accept) => validator.checkIncludeElements(node, accept, 'LightStyleBlock')
        ],
        DarkStyleBlock: [
            (node, accept) => validator.checkIncludeElements(node, accept, 'DarkStyleBlock')
        ],
        ElementStyleDescriptionProperty: [
            (node, accept) => validator.checkElementStyleDescription(node, accept)
        ],
        MetadataProperty: [
            (node, accept) => validator.checkMetadataProperty(node, accept)
        ],
        ColorProperty: [
            (node, accept) => validator.checkColorValue(node, accept)
        ],
        BackgroundProperty: [
            (node, accept) => validator.checkColorValue(node, accept)
        ],
        StrokeProperty: [
            (node, accept) => validator.checkColorValue(node, accept)
        ],
        ShapeProperty: [
            (node, accept) => validator.checkShapeValue(node, accept)
        ],
        LineStyleProperty: [
            (node, accept) => validator.checkBorderStyle(node, accept)
        ],
        JumpProperty: [
            (node, accept) => validator.checkJumpValue(node, accept)
        ],
        RoutingProperty: [
            (node, accept) => validator.checkRoutingValue(node, accept)
        ],
        InstancesProperty: [
            (node, accept) => validator.checkInstancesValue(node, accept)
        ],
        TerminologyBlock: [
            (node, accept) => validator.checkIncludeElements(node, accept, 'TerminologyBlock')
        ],
        RelationshipStyle: [
            (node, accept) => validator.checkIncludeElements(node, accept, 'RelationshipStyle')
        ],
        PerspectivesBlock: [
            (node, accept) => validator.checkIncludeElements(node, accept, 'PerspectivesBlock')
        ],
        Perspective: [
            (node, accept) => validator.checkIncludeElements(node, accept, 'Perspective')
        ],
        ParallelStepBlock: [
            (node, accept) => validator.checkIncludeElements(node, accept, 'ParallelStepBlock')
        ],
        DynamicStep: [
            (node, accept) => validator.checkIncludeElements(node, accept, 'DynamicStep')
        ],
        AnimationProperty: [
            (node, accept) => validator.checkIncludeElements(node, accept, 'AnimationProperty')
        ],
        ElementExtension: [
            (node, accept) => validator.checkIncludeElements(node, accept, 'ElementExtension')
        ],
        ElementsDirective: [
            (node, accept) => validator.checkIncludeElements(node, accept, 'ElementsDirective')
        ],
        RelationshipsDirective: [
            (node, accept) => validator.checkIncludeElements(node, accept, 'RelationshipsDirective')
        ],
        RelationshipExtension: [
            (node, accept) => validator.checkIncludeElements(node, accept, 'RelationshipExtension')
        ],
        Group: [
            (node, accept) => validator.checkGroupIncludeElements(node, accept)
        ],
        Workspace: [
            (node, accept) => validator.checkWorkspaceMetadata(node, accept),
            (node, accept) => validator.checkUniqueViewKeys(node, accept),
            (node, accept) => validator.checkOnlyOneDefaultView(node, accept)
        ]
    };
    registry.register(checks, validator);
}

/**
 * Validates C4 DSL semantics: element uniqueness, include file consistency,
 * property constraints (colors, shapes, borders), view key uniqueness, etc.
 * Registered via registerValidationChecks() for all AST node types.
 */
export class C4Validator {
    public sharedServices: any;

    /** Formats an error message for unexpected tokens or disallowed element types in a block */
    private formatIncludeError(blockType: string, item: any): string {
        const tokens = getBlockTokens(blockType);
        if (tokens && tokens.length > 0) {
            return `Unexpected tokens (expected: ${tokens.join(', ')}).`;
        }
        const itemName = this.getElementName(item);
        return `'${item.$type}' ('${itemName}') is not allowed inside a ${blockType} block.`;
    }

    /**
     * Validates that elements inside !include directives are type-compatible with the parent block.
     * Recursively processes nested includes to check all included content.
     */
    checkIncludeElements(node: any, accept: ValidationAcceptor, blockType: string): void {
        if (!node.includes || node.includes.length === 0) return;
        const visited = new Set<string>();
        this.collectAndCheckIncludes(node.includes, visited, accept, blockType);
    }

    /** Recursively traverses include files and validates their content against the expected block type */
    private collectAndCheckIncludes(
        includes: Include[], visited: Set<string>, accept: ValidationAcceptor,
        blockType: string, depth: number = 0
    ): void {
        for (const inc of includes) {
            const includedRoot = this.resolveIncludedRoot(inc);
            if (!includedRoot) continue;
            const docUri = AstUtils.getDocument(includedRoot)?.uri.toString();
            if (docUri && visited.has(docUri)) continue;
            if (docUri) visited.add(docUri);
            const anyRoot = includedRoot as any;
            for (const key of Object.keys(anyRoot)) {
                if (key.startsWith('$')) continue;
                const val = anyRoot[key];
                if (Array.isArray(val)) {
                    for (const item of val) {
                        if (item && typeof item === 'object' && item.$type) {
                            if (!isTypeAllowedInBlock(item.$type, blockType)) {
                                accept('error', this.formatIncludeError(blockType, item), { node: inc, property: 'file' });
                            }
                        }
                    }
                }
            }
            if (anyRoot.includes && Array.isArray(anyRoot.includes)) {
                this.collectAndCheckIncludes(anyRoot.includes, visited, accept, blockType, depth + 1);
            }
        }
    }

    /** Validates !include directives inside Relationship or ImplicitRelationship blocks */
    checkRelationshipBlockIncludeElements(rel: any, accept: ValidationAcceptor): void {
        const blockType = (rel as any).$type === 'ImplicitRelationship' ? 'ImplicitRelationship' : 'Relationship';
        this.checkIncludeElements(rel, accept, blockType);
    }

    /**
     * Validates !include directives inside Group blocks by resolving the parent block
     * type through the AST container chain and checking included elements against it.
     */
    checkGroupIncludeElements(group: any, accept: ValidationAcceptor): void {
        if (!group.includes || group.includes.length === 0) return;
        const parentBlockType = this.getParentBlockType(group);
        if (!parentBlockType) return;
        const visited = new Set<string>();
        this.collectAndCheckGroupIncludes(group.includes, visited, accept, parentBlockType);
    }

    /** Validates that instanceof only references SoftwareSystem or Container elements */
    checkGenericInstanceTarget(node: any, accept: ValidationAcceptor): void {
        if (node.element && node.element.ref) {
            const ref = node.element.ref;
            if (!isContainer(ref) && !isSoftwareSystem(ref)) {
                accept('error', 'instanceof can only reference a SoftwareSystem or Container element.', { node: node, property: 'element' });
            }
        }
    }

    /**
     * Climbs the AST $container chain from a Group node to determine its enclosing block type.
     * For groups in !include files, follows the Include directive's container chain.
     */
    private getParentBlockType(node: any, visited: Set<string> = new Set()): string | undefined {
        let current: any = node.$container;
        while (current) {
            if (isGroup(current)) {
                current = current.$container;
                continue;
            }
            const $type = (current as any).$type;
            if ($type !== 'C4Document' && $type !== 'Workspace') {
                if (getBlockTokens($type)) return $type;
            }
            if ($type === 'C4Document' || $type === 'Workspace') {
                const docUri = AstUtils.getDocument(current)?.uri.toString();
                if (docUri && !visited.has(docUri)) {
                    visited.add(docUri);
                    const foundInclude = this.findIncludeForDoc(docUri);
                    if (foundInclude) {
                        const result = this.getParentBlockType(foundInclude, visited);
                        if (result) return result;
                    }
                }
                return undefined;
            }
            current = current.$container;
        }
        return undefined;
    }

    /** Recursively validates !include content inside groups against the parent block type */
    private collectAndCheckGroupIncludes(
        includes: Include[], visited: Set<string>, accept: ValidationAcceptor,
        parentBlockType: string, depth: number = 0
    ): void {
        for (const inc of includes) {
            const includedRoot = this.resolveIncludedRoot(inc);
            if (!includedRoot) continue;
            const docUri = AstUtils.getDocument(includedRoot)?.uri.toString();
            if (docUri && visited.has(docUri)) continue;
            if (docUri) visited.add(docUri);
            const anyRoot = includedRoot as any;
            for (const key of Object.keys(anyRoot)) {
                if (key.startsWith('$')) continue;
                const val = anyRoot[key];
                if (Array.isArray(val)) {
                    for (const item of val) {
                        if (item && typeof item === 'object' && item.$type) {
                            if (item.$type === 'Group' || item.$type === 'Relationship' || item.$type === 'ImplicitRelationship') continue;
                            if (!isTypeAllowedInBlock(item.$type, parentBlockType)) {
                                accept('error', this.formatIncludeError(parentBlockType, item), { node: inc, property: 'file' });
                            }
                        }
                    }
                }
            }
            if (anyRoot.includes && Array.isArray(anyRoot.includes)) {
                this.collectAndCheckGroupIncludes(anyRoot.includes, visited, accept, parentBlockType, depth + 1);
            }
        }
    }

    /** Searches all documents in the index for an Include directive referencing the given document URI */
    private findIncludeForDoc(targetDocUri: string): Include | undefined {
        const allDocs = this.sharedServices.workspace.LangiumDocuments.all;
        for (const docWrapper of allDocs) {
            const root = docWrapper.parseResult.value as any;
            if (!root) continue;
            const found = this.findIncludeInTree(root, targetDocUri);
            if (found) return found;
        }
        return undefined;
    }

    /** Recursively searches an AST subtree for an Include directive matching the target document URI */
    private findIncludeInTree(node: any, targetDocUri: string): Include | undefined {
        if (!node || typeof node !== 'object') return undefined;
        if (node.$type === 'Include' && node.file) {
            try {
                const sourceDoc = AstUtils.getDocument(node);
                if (sourceDoc) {
                    const resolvedUri = Utils.resolvePath(Utils.dirname(sourceDoc.uri), node.file);
                    if (resolvedUri.toString() === targetDocUri) return node as Include;
                }
            } catch (e) { /* skip unresolvable */ }
        }
        for (const key of Object.keys(node)) {
            if (key.startsWith('$')) continue;
            const val = node[key];
            if (Array.isArray(val)) {
                for (const item of val) {
                    const result = this.findIncludeInTree(item, targetDocUri);
                    if (result) return result;
                }
            } else if (val && typeof val === 'object') {
                const result = this.findIncludeInTree(val, targetDocUri);
                if (result) return result;
            }
        }
        return undefined;
    }

    /** Resolves the root AST node of an included file; skips documents with parse errors (fragments). */
    private resolveIncludedRoot(inc: Include): AstNode | undefined {
        // Single shared resolution pipeline (quotes, ${CONST}, http(s), relative paths,
        // .dsl fallback) - matches the document builder so remote and ${CONST} includes
        // are validated instead of being silently skipped.
        return includeResolver.resolveIncludedRoot(this.sharedServices, inc.file, inc, {
            withDslFallback: true,
            skipParseErrors: true,
            constants: (path, node) => includeResolver.substituteConstants(this.sharedServices, path, node),
        });
    }

    /** Validates that property items have the correct format: <name> <value> pair */
    checkPropertyItem(item: PropertyItem, accept: ValidationAcceptor): void {
        if (!item.name || !item.value) return;
        if (item.value.startsWith('"') || item.value.startsWith("'")) return;
        const node = item.$cstNode;
        if (node) {
            const fullRawText = node.text;
            const nameIndex = fullRawText.indexOf(item.name);
            if (nameIndex !== -1) {
                const afterName = fullRawText.substring(nameIndex + item.name.length).trim();
                const tokens = afterName.split(/\s+/);
                if (tokens.length > 1) {
                    accept('error', 'Too many tokens, expected: <name> <value>', { node: item, property: 'value' });
                }
            }
        }
    }

    /** Returns a human-readable name for any NamedElement or relationship for error messages */
    private getElementName(element: NamedElement): string {
        if (isArchetypeDefinition(element)) {
            if ((element as any).name) return (element as any).name;
            if (element.baseType) return element.baseType;
            if (element.baseArrow) return element.baseArrow;
            return 'Unnamed Archetype';
        }
        if (isPerson(element) || isSoftwareSystem(element) || isContainer(element) || 
            isComponent(element) || isDeploymentNode(element) || isInfrastructureNode(element) || 
            isCustomElement(element) || isGroup(element) || isDeploymentGroup(element)) {
            return element.name;
        }
        if (isRelationship(element)) {
            let sourceName = 'unknown';
            if (element.sourceThis) {
                const container = AstUtils.getContainerOfType(element, isNamedElement);
                sourceName = container ? this.getElementName(container) : 'this';
            } else if (element.source?.ref) {
                sourceName = this.getElementName(element.source.ref);
            }
            let targetName = 'unknown';
            if (element.targetThis) {
                const container = AstUtils.getContainerOfType(element, isNamedElement);
                targetName = container ? this.getElementName(container) : 'this';
            } else if (element.target?.ref) {
                targetName = this.getElementName(element.target.ref);
            }
            return element.description || `${sourceName} -> ${targetName}`;
        }
        if (isSoftwareSystemInstance(element) || isContainerInstance(element)) {
            const baseName = (element as any).softwareSystem?.ref?.name || (element as any).container?.ref?.name;
            return (element as any).id || (baseName ? `Instance of ${baseName}` : 'Unnamed Instance');
        }
        return (element as any).id || (element as any).name || `Unnamed ${element.$type}`;
    }

    /** Validates relationship style position (0-100) and opacity (0-100) values */
    checkRelationshipStyle(style: RelationshipStyle, accept: ValidationAcceptor): void {
        style.positionProps.forEach(p => {
            const val = Number(p.value);
            if (val < 0 || val > 100) accept('error', "Position must be an integer between 0 and 100.", { node: p, property: 'value' });
        });
        style.opacityProps.forEach(p => {
            const val = Number(p.value);
            if (val < 0 || val > 100) accept('error', "Opacity must be an integer between 0 and 100.", { node: p, property: 'value' });
        });
    }

    /** Validates that views block has no duplicate properties and warns about theme/themes coexistence */
    checkViewsBlock(viewsBlock: ViewsBlock, accept: ValidationAcceptor): void {
        if (viewsBlock.properties.length > 1) {
            viewsBlock.properties.slice(1).forEach(pb => accept('error', "Duplicate 'properties' block in views.", { node: pb }));
        }
        if (viewsBlock.themeProps.length > 0 && viewsBlock.themesProps.length > 0) {
            accept('warning', "It's recommended to use either 'theme' or 'themes', but not both.", { node: viewsBlock, keyword: 'views' });
        }
    }

    /** Validates uniqueness of element names and identifiers at the model level (people, systems, deployment environments) */
    checkUniqueElementsInModel(model: ModelBlock, accept: ValidationAcceptor): void {
        const allElements = [...(model.elements || [])];
        const seenIdentifiers = new Set<string>();
        const personNames = new Set<string>();
        const softwareSystemNames = new Set<string>();
        const deploymentEnvironmentNames = new Set<string>();
        allElements.forEach((element) => {
            if (element.name) {
                if (isPerson(element)) {
                    if (personNames.has(element.name)) accept('error', `A top-level element named '${element.name}' already exists.`, { node: element, property: 'name' });
                    else personNames.add(element.name);
                } else if (isSoftwareSystem(element)) {
                    if (softwareSystemNames.has(element.name)) accept('error', `A top-level element named '${element.name}' already exists.`, { node: element, property: 'name' });
                    else softwareSystemNames.add(element.name);
                } else if (isDeploymentEnvironment(element)) {
                    if (deploymentEnvironmentNames.has(element.name)) accept('error', `A top-level element named '${element.name}' already exists.`, { node: element, property: 'name' });
                    else deploymentEnvironmentNames.add(element.name);
                }
            }
            if (element.id) {
                if (seenIdentifiers.has(element.id)) accept('error', `The identifier '${element.id}' is already in use.`, { node: element, property: 'id' });
                else seenIdentifiers.add(element.id);
            }
        });
    }

    /** Validates uniqueness of container names and identifiers within a SoftwareSystem */
    checkUniqueContainersInSystem(softwareSystem: SoftwareSystem, accept: ValidationAcceptor): void {
        const containerNames = new Set<string>();
        const containerIds = new Set<string>();
        const containers = (softwareSystem as any).elements || [];
        for (const container of containers) {
            if (container.name) {
                if (containerNames.has(container.name)) {
                    accept('error', `A container named '${container.name}' already exists in this software system.`, { node: container, property: 'name' });
                } else {
                    containerNames.add(container.name);
                }
            }
            if (container.id) {
                if (containerIds.has(container.id)) {
                    accept('error', `The identifier '${container.id}' is already in use in this software system.`, { node: container, property: 'id' });
                } else {
                    containerIds.add(container.id);
                }
            }
        }
    }

    /** Validates uniqueness of component names and identifiers within a Container */
    checkUniqueComponentsInContainer(container: any, accept: ValidationAcceptor): void {
        const componentNames = new Set<string>();
        const componentIds = new Set<string>();
        const components = container.elements || [];
        for (const component of components) {
            if (component.name) {
                if (componentNames.has(component.name)) {
                    accept('error', `A component named '${component.name}' already exists in this container.`, { node: component, property: 'name' });
                } else {
                    componentNames.add(component.name);
                }
            }
            if (component.id) {
                if (componentIds.has(component.id)) {
                    accept('error', `The identifier '${component.id}' is already in use in this container.`, { node: component, property: 'id' });
                } else {
                    componentIds.add(component.id);
                }
            }
        }
    }

    /** Validates workspace metadata consistency: name/description cannot be defined both in header and body */
    checkWorkspaceMetadata(workspace: Workspace, accept: ValidationAcceptor): void {
        const hasHeaderName = !!workspace.name;
        const hasBodyName = workspace.nameProp.length > 0;
        if (hasHeaderName && hasBodyName) {
            const errorMsg = "The workspace name must be defined either in the header or as a 'name' property, but not both.";
            accept('error', errorMsg, { node: workspace, property: 'name' });
            accept('error', errorMsg, { node: workspace.nameProp[0], property: 'value' });
        }
        const hasHeaderDesc = !!workspace.description;
        const hasBodyDesc = workspace.descriptionProp.length > 0;
        if (hasHeaderDesc && hasBodyDesc) {
            const errorMsg = "The workspace description must be defined either in the header or as a 'description' property, but not both.";
            accept('error', errorMsg, { node: workspace, property: 'description' });
            accept('error', errorMsg, { node: workspace.descriptionProp[0], property: 'value' });
        }
        if (workspace.nameProp.length > 1) workspace.nameProp.slice(1).forEach(prop => accept('error', "Duplicate 'name' property inside block.", { node: prop, property: 'value' }));
        if (workspace.descriptionProp.length > 1) workspace.descriptionProp.slice(1).forEach(prop => accept('error', "Duplicate 'description' property inside block.", { node: prop, property: 'value' }));
        if (workspace.modelBlocks.length > 1) {
            for (let index = 1; index < workspace.modelBlocks.length; index++) {
                accept('error', "Multiple models are not permitted in a DSL definition.", { node: workspace, property: 'modelBlocks', index });
            }
        }
        if (workspace.viewsBlocks.length > 1) {
            for (let index = 1; index < workspace.viewsBlocks.length; index++) {
                accept('error', "Multiple view sets are not permitted in a DSL definition.", { node: workspace, property: 'viewsBlocks', index });
            }
        }
    }

    /** Validates that view properties (autoLayout, title, default, etc.) appear only once */
    checkViewOrderAndUniqueness(view: any, accept: ValidationAcceptor): void {
        const checkSingle = (props: any[], name: string) => {
            if (props && props.length > 1) props.slice(1).forEach(p => accept('error', `Duplicate '${name}' property. Only one is allowed.`, { node: p }));
        };
        checkSingle(view.autoLayoutProps, 'autoLayout');
        checkSingle(view.titleProps, 'title');
        checkSingle(view.defaultViews, 'default');
        checkSingle(view.descriptionProps, 'description');
        checkSingle(view.propertiesBlocks, 'properties');
    }

    /** Validates that all view keys within a workspace are unique */
    checkUniqueViewKeys(workspace: Workspace, accept: ValidationAcceptor): void {
        const viewsBlock = workspace.viewsBlocks?.[0];
        if (!viewsBlock?.views) return;
        const seenKeys = new Map<string, any>();
        for (const view of viewsBlock.views) {
            const key = this.safeGetKey(view);
            if (key) {
                if (seenKeys.has(key)) {
                    const previousView = seenKeys.get(key);
                    const errorMessage = `Duplicate view key: "${key}"`;
                    accept('error', errorMessage, { node: view, property: 'key' as any });
                    accept('error', errorMessage, { node: previousView, property: 'key' as any });
                } else {
                    seenKeys.set(key, view);
                }
            }
        }
    }

    /** Safely extracts the key from a view, returning undefined for view types without keys */
    private safeGetKey(view: any): string | undefined {
        if (isSystemContextView(view) || isContainerView(view) || isComponentView(view) ||
            isSystemLandscapeView(view) || isDeploymentView(view) || isDynamicView(view) ||
            isFilteredView(view) || isCustomView(view) || isImageView(view)) {
            return (view).key;
        }
        return undefined;
    }

    /** Placeholder for workspace-level validation (currently unused) */
    checkWorkspace(workspace: Workspace, accept: ValidationAcceptor): void {}

    /** Validates that ElementStyle description property is true or false */
    checkElementStyleDescription(prop: ElementStyleDescriptionProperty, accept: ValidationAcceptor): void {
        const val = prop.value;
        if (!val) return;
        const trimmed = val.replace(/^["']|["']$/g, '').toLowerCase();
        if (trimmed !== 'true' && trimmed !== 'false') {
            accept('error', 'Description must be true or false.', { node: prop, property: 'value' });
        }
    }

    /** Validates that element has no duplicate property definitions (description, technology, url, instances, properties) */
    checkElementUniqueness(node: any, accept: ValidationAcceptor): void {
        const singleProps = ['descriptionProps', 'techProps', 'urlProps', 'instancesProps', 'propertiesBlocks'];
        singleProps.forEach(propName => {
            const arr = node[propName];
            if (arr && arr.length > 1) {
                arr.slice(1).forEach((item: any) => accept('error', `Duplicate property definition.`, { node: item }));
            }
        });
    }

    /** Validates that border style is one of: solid, dashed, dotted */
    checkBorderStyle(prop: any, accept: ValidationAcceptor): void {
        const val = prop.value;
        if (val && !VALID_BORDER_STYLES.has(val.toLowerCase())) {
            accept('error', `The border "${val}" is not valid. Expected: solid, dashed, dotted.`, { node: prop, property: 'value' });
        }
    }

    /** Validates that routing value is one of: direct, orthogonal, curved */
    checkRoutingValue(prop: any, accept: ValidationAcceptor): void {
        const val = prop.value;
        if (val && val.toLowerCase() !== 'direct' && val.toLowerCase() !== 'orthogonal' && val.toLowerCase() !== 'curved') {
            accept('error', `The routing "${val}" is not valid. Expected: direct, orthogonal, curved.`, { node: prop, property: 'value' });
        }
    }

    /** Validates that jump value is true or false */
    checkJumpValue(prop: any, accept: ValidationAcceptor): void {
        const val = prop.value;
        if (val && val.toLowerCase() !== 'true' && val.toLowerCase() !== 'false') {
            accept('error', 'Jump must be true or false.', { node: prop, property: 'value' });
        }
    }

    /** Validates that shape value is one of the known shapes (Box, Cylinder, Person, etc.) */
    checkShapeValue(prop: any, accept: ValidationAcceptor): void {
        const val = prop.value;
        if (!val) return;
        const trimmed = val.replace(/^["']|["']$/g, '').toLowerCase();
        const display = val.replace(/^["']|["']$/g, '');
        if (trimmed && !VALID_SHAPES.has(trimmed)) {
            accept('error', `The shape "${display}" is not valid.`, { node: prop, property: 'value' });
        }
    }

    /** Validates that metadata property is true or false */
    checkMetadataProperty(prop: any, accept: ValidationAcceptor): void {
        const val = prop.value;
        if (!val) return;
        const trimmed = val.replace(/^["']|["']$/g, '').toLowerCase();
        if (trimmed !== 'true' && trimmed !== 'false') {
            accept('error', 'Metadata must be true or false.', { node: prop, property: 'value' });
        }
    }

    /** Validates that color value is a valid hex code (#fff, #ffffff) or CSS named color */
    checkColorValue(prop: any, accept: ValidationAcceptor): void {
        const val = prop.value;
        if (!val) return;
        const trimmed = val.replace(/^["']|["']$/g, '');
        if (!trimmed) return;
        if (/^#[a-fA-F0-9]{3}([a-fA-F0-9]{3})?$/.test(trimmed)) return;
        if (CSS_NAMED_COLORS.has(trimmed.toLowerCase())) return;
        accept('error', `Invalid color '${trimmed}'. Expected a hex code (e.g. #ffff00) or a CSS named color (e.g. yellow).`, { node: prop, property: 'value' });
    }

    /** Validates that instances value is a positive integer or a range (e.g. 1..5, 1..*) */
    checkInstancesValue(prop: InstancesProperty, accept: ValidationAcceptor): void {
        const val = prop.value;
        if (!val) return;
        const trimmed = val.replace(/^["']|["']$/g, '');
        if (/^\d+$/.test(trimmed)) return;
        if (/^\d+\.\.(\d+|\*)?$/.test(trimmed)) return;
        accept('error', 'Number of instances must be a positive integer or a range.', { node: prop, property: 'value' });
    }

    /** Validates that only one view across the entire workspace is marked as 'default' */
    checkOnlyOneDefaultView(workspace: Workspace, accept: ValidationAcceptor): void {
        const viewsBlock = workspace.viewsBlocks?.[0];
        if (!viewsBlock?.views) return;
        const detectedDefaultMarkers: Array<{ view: any, marker: any }> = [];
        for (const view of viewsBlock.views) {
            const v = view as any;
            if (v.defaultViews && v.defaultViews.length > 0) {
                for (const marker of v.defaultViews) {
                    detectedDefaultMarkers.push({ view: v, marker: marker });
                }
            }
        }
        if (detectedDefaultMarkers.length > 1) {
            detectedDefaultMarkers.forEach(item => {
                accept('error', "Only one view can be marked as 'default' across the entire workspace.", { node: item.marker, property: 'value' });
            });
        }
    }
}
