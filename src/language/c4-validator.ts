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
import { StyleDescriptionProperty, InstancesProperty, isArchetypeDefinition, isComponent, isComponentView, isContainer, isContainerInstance, isContainerView, isCustomElement, isCustomView, isDeploymentGroup, isDeploymentNode, isDeploymentView, isDynamicView, isFilteredView, isImageView, isInfrastructureNode, isNamedElement, isPerson, isRelationship, isSoftwareSystem, isGroup, isSoftwareSystemInstance, isSystemContextView, isSystemLandscapeView, NamedElement, ViewsBlock, type C4AstType, type C4Document, type Workspace, PropertyItem, isDeploymentEnvironment, Include, SoftwareSystem, IconProperty, ThemeProperty, DocsDirective, AdrsDirective, PositionProperty, OpacityProperty, ThicknessProperty, FontSizeProperty, WidthProperty, HeightProperty, StrokeWidthProperty, AutoLayoutProperty, HealthCheck, DeploymentNode, Group, isPropertiesBlock, isModelBlock, IconPositionProperty, isImplicitRelationship, isImpliedRelationshipsProperty } from '../generated/ast';
import type { C4Services } from './c4-module';
import { getBlockTokens, isTypeAllowedInBlock } from './c4-tokens';
import * as includeResolver from './c4-include-resolver';
import { C4Utils } from './c4-utils';
import { canonicalElementName, findDuplicateRelationships, type DeclaredRelationship } from './c4-implied-relationships';

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

/** Root-level document properties that stay valid next to a workspace. */
const ROOT_ALLOWED_KEYS = new Set([
    'workspaces', 'includes', 'constants', 'scripts', 'plugins', 'impliedRelationships'
]);

/** AST types a relationship can be declared against; groups and documents are containers only. */
const RELATIONSHIP_MEMBER_TYPES = new Set<string>([
    'Person', 'SoftwareSystem', 'Container', 'Component', 'DeploymentNode', 'InfrastructureNode',
    'SoftwareSystemInstance', 'ContainerInstance', 'CustomElement', 'ArchetypeInstance', 'GenericInstance'
]);

/** Normalizes lowercase border style names to PascalCase (Solid, Dashed, Dotted) */
export const BORDER_NORMALIZE: Record<string, string> = {
    'solid': 'Solid',
    'dashed': 'Dashed',
    'dotted': 'Dotted'
};

const VALID_BORDER_STYLES = new Set(Object.keys(BORDER_NORMALIZE));

/** Icon position values, normalized to the PascalCase the model serializes them as. */
export const ICON_POSITION_NORMALIZE: Record<string, string> = {
    top: 'Top',
    bottom: 'Bottom',
    left: 'Left'
};

// Positions an element style icon can be placed at, as the model supports them
const VALID_ICON_POSITIONS = new Set(Object.keys(ICON_POSITION_NORMALIZE));

/**
 * Whether implied relationships are enabled at the given offset. The directives apply from
 * their position onwards, and are enabled unless a directive turns them off.
 */
function impliedRelationshipsEnabledAt(flags: Array<{ offset: number, enabled: boolean }>, offset: number): boolean {
    let enabled = true;
    for (const flag of flags) {
        if (flag.offset > offset) break;
        enabled = flag.enabled;
    }
    return enabled;
}

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
        IconPositionProperty: [
            (node, accept) => validator.checkIconPosition(node, accept)
        ],
        PropertyItem: [
            (node, accept) => validator.checkPropertyItem(node, accept),
            (node, accept) => validator.checkGroupSeparatorProperty(node, accept)
        ],

        C4Document: [
            (node, accept) => validator.checkUniqueElementsInDocument(node, accept),
            (node, accept) => validator.checkUniqueViewKeys(node, accept),
            (node, accept) => validator.checkOnlyOneDefaultView(node, accept),
            (node, accept) => validator.checkSingleWorkspace(node, accept),
            (node, accept) => validator.checkRootContentOutsideWorkspace(node, accept),
            (node, accept) => validator.checkDuplicateRelationships(node, accept)
        ],
        ModelBlock: [
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
            (node, accept) => validator.checkIncludeElements(node, accept, 'DeploymentNode'),
            (node, accept) => validator.checkDeploymentInstances(node, accept)
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
            (node, accept) => validator.checkIncludeElements(node, accept, 'ViewsBlock'),
            (node, accept) => validator.checkViewsBlock(node, accept)
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
            (node, accept) => validator.checkIncludeElements(node, accept, 'ContainerView')
        ],
        ComponentView: [
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
        StyleDescriptionProperty: [
            (node, accept) => validator.checkStyleDescription(node, accept)
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
        DashedProperty: [
            (node, accept) => validator.checkDashedValue(node, accept)
        ],
        RoutingProperty: [
            (node, accept) => validator.checkRoutingValue(node, accept)
        ],
        InstancesProperty: [
            (node, accept) => validator.checkInstancesValue(node, accept)
        ],
        PositionProperty: [
            (node, accept) => validator.checkPositionProperty(node, accept)
        ],
        OpacityProperty: [
            (node, accept) => validator.checkOpacityProperty(node, accept)
        ],
        ThicknessProperty: [
            (node, accept) => validator.checkThicknessProperty(node, accept)
        ],
        FontSizeProperty: [
            (node, accept) => validator.checkFontSizeProperty(node, accept)
        ],
        WidthProperty: [
            (node, accept) => validator.checkWidthProperty(node, accept)
        ],
        HeightProperty: [
            (node, accept) => validator.checkHeightProperty(node, accept)
        ],
        StrokeWidthProperty: [
            (node, accept) => validator.checkStrokeWidthProperty(node, accept)
        ],
        AutoLayoutProperty: [
            (node, accept) => validator.checkAutoLayout(node, accept)
        ],
        HealthCheck: [
            (node, accept) => validator.checkHealthCheck(node, accept)
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
            (node, accept) => validator.checkGroupIncludeElements(node, accept),
            (node, accept) => validator.checkNestedGroup(node, accept)
        ],
        Include: [
            (node, accept) => validator.checkPathCharacters(node, accept, 'file')
        ],
        DocsDirective: [
            (node, accept) => validator.checkPathCharacters(node, accept, 'path')
        ],
        AdrsDirective: [
            (node, accept) => validator.checkPathCharacters(node, accept, 'path')
        ],
        ThemeProperty: [
            (node, accept) => validator.checkPathCharacters(node, accept, 'value')
        ],
        IconProperty: [
            (node, accept) => validator.checkPathCharacters(node, accept, 'value')
        ],
        Workspace: [
            (node, accept) => validator.checkWorkspaceMetadata(node, accept),
            (node, accept) => validator.checkPathCharacters(node, accept, 'extendsUri')
        ]
    };
    registry.register(checks, validator);
}

/** A recorded name or identifier occurrence: its declaring document and the node to anchor a diagnostic to. */
interface DuplicateOccurrence {
    docUri?: string;
    anchor: any;
}

/** A top-level element collected for uniqueness checks, together with its occurrence. */
interface CollectedTopLevelElement extends DuplicateOccurrence {
    element: any;
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

    /**
     * Returns the `!include` directive that pulls the given document into the
     * workspace, or undefined when no loaded document includes it.
     *
     * Served by the shared reverse reference index (one AST pass per build).
     * Path resolution goes through the shared pipeline as well, so quoted paths,
     * ${CONST} placeholders, http(s) targets and the ".dsl" fallback resolve
     * exactly as they do in the document builder.
     */
    private findIncludeForDoc(targetDocUri: string): Include | undefined {
        return includeResolver.findIncludeDirective(this.sharedServices, targetDocUri);
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

    /** Warns when a views block declares both theme and themes */
    checkViewsBlock(viewsBlock: ViewsBlock, accept: ValidationAcceptor): void {
        if (viewsBlock.themeProps.length > 0 && viewsBlock.themesProps.length > 0) {
            accept('warning', "It's recommended to use either 'theme' or 'themes', but not both.", { node: viewsBlock, keyword: 'views' });
        }
    }

    /**
     * Validates name and identifier uniqueness of top-level elements across the whole
     * document, covering root-level elements, elements nested in groups, every
     * workspace's model block and !include fragments.
     *
     * Mirrors the model rules: people and software systems share one name namespace,
     * custom elements and deployment environments have their own, and identifiers are
     * unique across the model.
     */
    checkUniqueElementsInDocument(doc: C4Document, accept: ValidationAcceptor): void {
        const rootUri = AstUtils.getDocument(doc)?.uri.toString();
        const visitedDocuments = new Set<string>();
        if (rootUri) visitedDocuments.add(rootUri);

        const collected: CollectedTopLevelElement[] = [];
        this.collectTopLevelElements(doc as any, collected, visitedDocuments, undefined);

        const personOrSystemNames = new Map<string, DuplicateOccurrence>();
        const customElementNames = new Map<string, DuplicateOccurrence>();
        const deploymentEnvironmentNames = new Map<string, DuplicateOccurrence>();
        const identifiers = new Map<string, DuplicateOccurrence>();

        for (const { element, docUri, anchor } of collected) {
            const current: DuplicateOccurrence = { docUri, anchor };
            const name = C4Utils.stripQuotes(element.name);
            if (name) {
                if (isCustomElement(element)) {
                    this.reportDuplicate(customElementNames, name, current, rootUri, accept, `A top-level element named '${name}' already exists.`, 'name');
                } else if (isDeploymentEnvironment(element)) {
                    this.reportDuplicate(deploymentEnvironmentNames, name, current, rootUri, accept, `A deployment environment named '${name}' already exists.`, 'name');
                } else if (isPerson(element) || isSoftwareSystem(element)) {
                    this.reportDuplicate(personOrSystemNames, name, current, rootUri, accept, `A person or software system named '${name}' already exists.`, 'name');
                }
            }
            if (element.id) {
                this.reportDuplicate(identifiers, element.id, current, rootUri, accept, `The identifier '${element.id}' is already in use.`, 'id');
            }
        }
    }

    /**
     * Records a name or identifier occurrence and reports a duplicate once. The diagnostic is
     * anchored to a node of the validated document, so collisions inside a single included
     * fragment are left to that fragment's own validation, while collisions between two
     * different included documents are reported by the document that pulls both in.
     */
    private reportDuplicate(
        seen: Map<string, DuplicateOccurrence>, value: string, current: DuplicateOccurrence,
        rootUri: string | undefined, accept: ValidationAcceptor, message: string, property: string
    ): void {
        const previous = seen.get(value);
        if (!previous) {
            seen.set(value, current);
            return;
        }
        const involvesRoot = current.docUri === rootUri || previous.docUri === rootUri;
        if (!involvesRoot && previous.docUri === current.docUri) return;
        accept('error', message, { node: current.anchor, property });
    }

    /**
     * Collects top-level elements reachable from a document, a model block, a group or an
     * included fragment: direct elements, elements nested in groups, elements inside model
     * blocks and workspaces, and content pulled in through !include directives. Containers
     * and components are collected as well so their identifiers are checked, but they are
     * skipped by the name checks because they are scoped to their software system or
     * container. `anchor` is the node inside the validated document that a diagnostic for
     * included content is attached to.
     */
    private collectTopLevelElements(
        node: any, collected: CollectedTopLevelElement[], visitedDocuments: Set<string>, anchor: any
    ): void {
        if (!node || typeof node !== 'object') return;
        for (const element of node.elements ?? []) {
            if (isGroup(element)) this.collectTopLevelElements(element, collected, visitedDocuments, anchor);
            else collected.push({ element, docUri: AstUtils.getDocument(element)?.uri.toString(), anchor: anchor ?? element });
        }
        for (const group of node.groups ?? []) {
            this.collectTopLevelElements(group, collected, visitedDocuments, anchor);
        }
        for (const modelBlock of node.modelBlocks ?? []) {
            this.collectTopLevelElements(modelBlock, collected, visitedDocuments, anchor);
        }
        for (const workspace of node.workspaces ?? []) {
            this.collectTopLevelElements(workspace, collected, visitedDocuments, anchor);
        }
        for (const inc of node.includes ?? []) {
            const includedRoot = this.resolveIncludedRoot(inc);
            if (!includedRoot) continue;
            const docUri = AstUtils.getDocument(includedRoot)?.uri.toString();
            if (docUri) {
                if (visitedDocuments.has(docUri)) continue;
                visitedDocuments.add(docUri);
            }
            this.collectTopLevelElements(includedRoot as any, collected, visitedDocuments, anchor ?? inc);
        }
    }

    /**
     * Validates the icon position of an element style against the positions the model
     * supports.
     */
    checkIconPosition(node: IconPositionProperty, accept: ValidationAcceptor): void {
        const value = C4Utils.stripQuotes(node.value);
        if (!VALID_ICON_POSITIONS.has(value.toLowerCase())) {
            accept('error', `The icon position "${value}" is not valid`, { node, property: 'value' });
        }
    }

    /**
     * Validates the model's 'structurizr.groupSeparator' property: the separator is a
     * single character, and the property only carries that meaning on the model.
     */
    checkGroupSeparatorProperty(item: PropertyItem, accept: ValidationAcceptor): void {
        const properties = item.$container as any;
        if (!isPropertiesBlock(properties) || !isModelBlock(properties.$container)) return;
        if (C4Utils.stripQuotes(item.name).toLowerCase() !== 'structurizr.groupseparator') return;
        if (C4Utils.stripQuotes(item.value).length !== 1) {
            accept('error', 'Group separator must be a single character', { node: item, property: 'value' });
        }
    }

    /**
     * Validates that a group nested inside another group can be composed into a path,
     * which the enclosing model provides through a 'structurizr.groupSeparator' property.
     */
    checkNestedGroup(node: Group, accept: ValidationAcceptor): void {
        // A group only nests when declared directly inside another group: an element body
        // (softwareSystem, container, deploymentNode, ...) starts a group-less context, so
        // groups inside it are independent of the group the element itself belongs to.
        if (!isGroup(node.$container)) return;
        if (this.hasGroupSeparator(node)) return;
        accept('error', "To use nested groups, please define a model property named 'structurizr.groupSeparator'.", { node, property: 'name' });
    }

    /** Returns true when a model block of the document declares a 'structurizr.groupSeparator' property. */
    private hasGroupSeparator(node: AstNode): boolean {
        const root = AstUtils.getDocument(node)?.parseResult.value as any;
        if (!root) return false;
        const modelBlocks = [
            ...(root.modelBlocks ?? []),
            ...(root.workspaces ?? []).flatMap((workspace: any) => workspace.modelBlocks ?? [])
        ];
        for (const modelBlock of modelBlocks) {
            for (const properties of modelBlock.properties ?? []) {
                for (const item of properties.items ?? []) {
                    if (C4Utils.stripQuotes(item.name) === 'structurizr.groupSeparator') return true;
                }
            }
        }
        return false;
    }

    /** Validates uniqueness of container names and identifiers within a SoftwareSystem */
    checkUniqueContainersInSystem(softwareSystem: SoftwareSystem, accept: ValidationAcceptor): void {
        const containerNames = new Set<string>();
        const containerIds = new Set<string>();
        const containers = (softwareSystem as any).elements || [];
        for (const container of containers) {
            const name = C4Utils.stripQuotes(container.name);
            if (name) {
                if (containerNames.has(name)) {
                    accept('error', `A container named '${name}' already exists in this software system.`, { node: container, property: 'name' });
                } else {
                    containerNames.add(name);
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
            const name = C4Utils.stripQuotes(component.name);
            if (name) {
                if (componentNames.has(name)) {
                    accept('error', `A component named '${name}' already exists in this container.`, { node: component, property: 'name' });
                } else {
                    componentNames.add(name);
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

    /**
     * Validates workspace metadata: a repeated name/description - whether from the header or
     * from a body property - overwrites the previous value, so only the counts that break the
     * document structure are rejected.
     */
    checkWorkspaceMetadata(workspace: Workspace, accept: ValidationAcceptor): void {
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

    /**
     * Validates path-bearing values ('file' for !include, 'extendsUri' on
     * Workspace, 'path' for !docs/!adrs, 'value' for theme/icon). The grammar
     * accepts a broad set of path characters, so the character policy lives
     * here: reject control characters, NUL and stray quote characters in the
     * unquoted portion of the path. Quoted paths (STRING) and the marker
     * characters used for file paths/URLs (& + % ~ # ? = etc.) are allowed.
     */
    checkPathCharacters(node: any, accept: ValidationAcceptor, property: string): void {
        const raw = node?.[property];
        if (typeof raw !== 'string' || raw.length === 0) return;
        // Quoted paths are legal — skip validation when the value starts with a quote.
        if (raw.startsWith('"') || raw.startsWith("'")) return;

        const invalid = /[\x00-\x1F\x7F"']/;
        if (invalid.test(raw)) {
            const bad = raw.match(invalid)?.[0];
            accept('error',
                `Invalid character '${bad}' in ${property === 'file' ? 'include path' : property === 'extendsUri' ? 'extends path' : 'path'}. Only legal filesystem/URL characters are allowed.`,
                { node, property });
        }
    }

    /**
     * Validates that a relationship does not repeat one that already exists between the same
     * elements with the same description, counting the implied relationships the model creates
     * between enclosing elements.
     */
    checkDuplicateRelationships(doc: C4Document, accept: ValidationAcceptor): void {
        const flags = AstUtils.streamAllContents(doc)
            .filter(isImpliedRelationshipsProperty)
            .map(property => ({
                offset: property.$cstNode?.offset ?? 0,
                enabled: C4Utils.stripQuotes((property as any).value ?? '').toLowerCase() === 'true'
            }))
            .toArray()
            .sort((a, b) => a.offset - b.offset);

        const declared: DeclaredRelationship[] = [];
        for (const node of AstUtils.streamAllContents(doc)) {
            if (!isRelationship(node) && !isImplicitRelationship(node)) continue;
            const source = this.relationshipEndpoint(node, 'source');
            const destination = this.relationshipEndpoint(node, 'target');
            if (!source || !destination) continue;
            declared.push({
                node,
                source,
                destination,
                impliedEnabled: impliedRelationshipsEnabledAt(flags, node.$cstNode?.offset ?? 0)
            });
        }

        for (const duplicate of findDuplicateRelationships(declared)) {
            const message = `A relationship between "${canonicalElementName(duplicate.source)}" and "${canonicalElementName(duplicate.destination)}" already exists`;
            accept('error', message, { node: duplicate.node, property: 'target' });
        }
    }

    /** Resolves one end of a relationship declaration, resolving 'this' to the enclosing element. */
    private relationshipEndpoint(node: any, end: 'source' | 'target'): NamedElement | undefined {
        if (end === 'source' && isImplicitRelationship(node)) {
            return this.enclosingRelationshipMember(node);
        }
        const refersToThis = end === 'source' ? node.sourceThis === true : node.targetThis === true;
        if (refersToThis) {
            return this.enclosingRelationshipMember(node);
        }
        return node[end]?.ref as NamedElement | undefined;
    }

    /** Nearest enclosing element that a relationship can be declared against, skipping groups and documents. */
    private enclosingRelationshipMember(node: any): NamedElement | undefined {
        let current: any = node.$container;
        while (current) {
            if (RELATIONSHIP_MEMBER_TYPES.has(current.$type)) return current as NamedElement;
            current = current.$container;
        }
        return undefined;
    }

    /**
     * Rejects model content declared at the document root next to a workspace. The root
     * accepts loose content so that !include targets parse on their own, but a document that
     * declares a workspace keeps its model content inside it.
     */
    checkRootContentOutsideWorkspace(doc: C4Document, accept: ValidationAcceptor): void {
        if (((doc as any).workspaces ?? []).length === 0) return;
        for (const key of Object.keys(doc as any)) {
            if (ROOT_ALLOWED_KEYS.has(key) || key.startsWith('$')) continue;
            const value = (doc as any)[key];
            if (!Array.isArray(value)) continue;
            for (const node of value) {
                if (!node || typeof node !== 'object' || !node.$type) continue;
                accept('error', 'Unexpected tokens outside the workspace block.', { node });
            }
        }
    }

    /**
     * Validates that a document declares at most one workspace. Multiple models and view
     * sets are rejected per workspace by checkWorkspaceMetadata.
     */
    checkSingleWorkspace(doc: C4Document, accept: ValidationAcceptor): void {
        const workspaces: any[] = (doc as any).workspaces ?? [];
        for (let index = 1; index < workspaces.length; index++) {
            accept('error', 'Multiple workspaces are not permitted in a DSL definition.', { node: doc, property: 'workspaces', index });
        }
    }

    /**
     * Collects every view declared by a document: views blocks that sit at the document
     * root and views blocks nested inside workspaces.
     */
    private collectDocumentViews(doc: C4Document): any[] {
        const views: any[] = [];
        const collect = (node: any) => {
            for (const viewsBlock of node?.viewsBlocks ?? []) {
                views.push(...(viewsBlock.views ?? []));
            }
        };
        collect(doc);
        for (const workspace of (doc as any).workspaces ?? []) {
            collect(workspace);
        }
        return views;
    }

    /** Validates that all view keys within a document are unique; a repeated key is reported on the later view. */
    checkUniqueViewKeys(doc: C4Document, accept: ValidationAcceptor): void {
        const seenKeys = new Set<string>();
        for (const view of this.collectDocumentViews(doc)) {
            const key = this.safeGetKey(view);
            if (!key) continue;
            if (seenKeys.has(key)) {
                accept('error', `A view with the key '${key}' already exists.`, { node: view, property: 'key' as any });
            } else {
                seenKeys.add(key);
            }
        }
    }

    /** Safely extracts the key from a view, returning undefined for view types without keys */
    private safeGetKey(view: any): string | undefined {
        if (isSystemContextView(view) || isContainerView(view) || isComponentView(view) ||
            isSystemLandscapeView(view) || isDeploymentView(view) || isDynamicView(view) ||
            isFilteredView(view) || isCustomView(view) || isImageView(view)) {
            // Keys are compared without their surrounding quotes.
            return C4Utils.stripQuotes((view).key) || undefined;
        }
        return undefined;
    }

    /** Placeholder for workspace-level validation (currently unused) */
    checkWorkspace(workspace: Workspace, accept: ValidationAcceptor): void {}

    /** Validates that a style description property is true or false */
    checkStyleDescription(prop: StyleDescriptionProperty, accept: ValidationAcceptor): void {
        const val = prop.value;
        if (!val) return;
        const trimmed = val.replace(/^["']|["']$/g, '').toLowerCase();
        if (trimmed !== 'true' && trimmed !== 'false') {
            accept('error', 'Description must be true or false.', { node: prop, property: 'value' });
        }
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

    /** Validates that dashed value is true or false */
    checkDashedValue(prop: any, accept: ValidationAcceptor): void {
        const val = prop.value;
        if (!val) return;
        const trimmed = val.replace(/^["']|["']$/g, '').toLowerCase();
        if (trimmed !== 'true' && trimmed !== 'false') {
            accept('error', 'Dashed must be true or false.', { node: prop, property: 'value' });
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

    /** Strips surrounding quotes from a raw token value. */
    private unquote(value: string | undefined): string {
        return (value ?? '').replace(/^["']|["']$/g, '');
    }

    /**
     * Validates that a token value is an integer, mirroring the Integer.parseInt
     * checks of the Structurizr DSL parsers. Quoted values are skipped when the
     * grammar allows STRING at that position.
     */
    private checkIntegerToken(
        node: AstNode,
        raw: string | undefined,
        accept: ValidationAcceptor,
        property: string,
        message: string,
        options: { min?: number; max?: number; allowQuoted?: boolean } = {}
    ): void {
        const trimmed = (raw ?? '').trim();
        if (!trimmed) return;
        if (/^["']/.test(trimmed) && /["']$/.test(trimmed)) {
            if (options.allowQuoted) return;
            accept('error', message, { node, property });
            return;
        }
        const value = this.unquote(trimmed);
        if (!/^[+-]?\d+$/.test(value)) {
            accept('error', message, { node, property });
            return;
        }
        const numeric = Number(value);
        if ((options.min !== undefined && numeric < options.min) ||
            (options.max !== undefined && numeric > options.max)) {
            accept('error', message, { node, property });
        }
    }

    /** Validates relationship position (0-100). */
    checkPositionProperty(prop: PositionProperty, accept: ValidationAcceptor): void {
        this.checkIntegerToken(prop, prop.value, accept, 'value', 'Position must be an integer between 0 and 100.');
    }

    /** Validates opacity (0-100). */
    checkOpacityProperty(prop: OpacityProperty, accept: ValidationAcceptor): void {
        this.checkIntegerToken(prop, prop.value, accept, 'value', 'Opacity must be an integer between 0 and 100.');
    }

    /** Validates relationship line thickness. */
    checkThicknessProperty(prop: ThicknessProperty, accept: ValidationAcceptor): void {
        this.checkIntegerToken(prop, prop.value, accept, 'value', 'Thickness must be a positive integer.');
    }

    /** Validates font size (integer, or a quoted value where the grammar allows one). */
    checkFontSizeProperty(prop: FontSizeProperty, accept: ValidationAcceptor): void {
        this.checkIntegerToken(prop, prop.value, accept, 'value', 'Font size must be a positive integer.', { allowQuoted: true });
    }

    /** Validates element/relationship width (integer, or a quoted value where the grammar allows one). */
    checkWidthProperty(prop: WidthProperty, accept: ValidationAcceptor): void {
        this.checkIntegerToken(prop, prop.value, accept, 'value', 'Width must be a positive integer.', { allowQuoted: true });
    }

    /** Validates element height (integer, or a quoted value where the grammar allows one). */
    checkHeightProperty(prop: HeightProperty, accept: ValidationAcceptor): void {
        this.checkIntegerToken(prop, prop.value, accept, 'value', 'Height must be a positive integer.', { allowQuoted: true });
    }

    /** Validates element stroke width (integer, or a quoted value where the grammar allows one). */
    checkStrokeWidthProperty(prop: StrokeWidthProperty, accept: ValidationAcceptor): void {
        this.checkIntegerToken(prop, prop.value, accept, 'value', 'Stroke width must be an integer between 1 and 10.', { allowQuoted: true });
    }

    /** Validates autolayout separations (positive integers in pixels). */
    checkAutoLayout(node: AutoLayoutProperty, accept: ValidationAcceptor): void {
        this.checkIntegerToken(node, node.rankSeparation, accept, 'rankSeparation', 'Rank separation must be a positive integer in pixels.');
        this.checkIntegerToken(node, node.nodeSeparation, accept, 'nodeSeparation', 'Node separation must be a positive integer in pixels.');
    }

    /** Validates health check interval (positive) and timeout (zero or positive). */
    checkHealthCheck(node: HealthCheck, accept: ValidationAcceptor): void {
        this.checkIntegerToken(node, node.interval, accept, 'interval', 'The interval must be a positive integer (number of seconds).', { min: 1 });
        this.checkIntegerToken(node, node.timeout, accept, 'timeout', 'The timeout must be zero or a positive integer (number of milliseconds).', { min: 0 });
    }

    /** Validates that instances value is a positive integer or a range (e.g. 1..5, 1..N, 1..*) */
    checkInstancesValue(prop: InstancesProperty, accept: ValidationAcceptor): void {
        const error = this.instancesValueError(prop.value);
        if (error) {
            accept('error', error, { node: prop, property: 'value' });
        }
    }

    /** Validates the positional instances token of a deployment node. */
    checkDeploymentInstances(node: DeploymentNode, accept: ValidationAcceptor): void {
        const error = this.instancesValueError(node.instances);
        if (error) {
            accept('error', error, { node, property: 'instances' });
        }
    }

    /**
     * Mirrors DeploymentNode.setInstances: a positive integer, or a range with an
     * upper bound that is not below the lower bound.
     */
    private instancesValueError(raw: string | undefined): string | undefined {
        const value = this.unquote((raw ?? '').trim());
        if (!value) return undefined;
        if (/^\d+$/.test(value)) {
            return Number(value) >= 1 ? undefined : 'Number of instances must be a positive integer or a range.';
        }
        const range = /^(\d*)\.\.(\d*|N|\*)$/.exec(value);
        if (!range) {
            return 'Number of instances must be a positive integer or a range.';
        }
        const [, lower, upper] = range;
        if (lower && upper && /^\d+$/.test(upper) && Number(lower) > Number(upper)) {
            return 'Range upper bound must be greater than the lower bound.';
        }
        return undefined;
    }

    /** Validates that only one view across the entire document is marked as 'default' */
    checkOnlyOneDefaultView(doc: C4Document, accept: ValidationAcceptor): void {
        const detectedDefaultMarkers: any[] = [];
        for (const view of this.collectDocumentViews(doc)) {
            // Filtered views carry the marker as `defaultView`, every other view type as `defaultViews`.
            for (const marker of [...((view as any).defaultViews ?? []), ...((view as any).defaultView ?? [])]) {
                detectedDefaultMarkers.push(marker);
            }
        }
        if (detectedDefaultMarkers.length > 1) {
            // The last marker wins; the earlier ones are the ones that never take effect.
            detectedDefaultMarkers.slice(0, -1).forEach(marker => {
                accept('warning', "Only one view can be marked as 'default' across the entire workspace.", { node: marker, property: 'value' });
            });
        }
    }
}
