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
 * Mapping of block $type names to arrays of expected tokens (lowercase, user-facing).
 * Single source of truth for error messages in both the parser and validator.
 * Keys correspond to $type values of AST blocks or ruleName from the grammar.
 * Includes `!include` for all blocks that have `includes+=Include` in the grammar.
 */

/** Tokens shared by all static/diagram view types (system landscape, context, container, component, deployment, etc.) */
const VIEW_TOKENS = [
    'include', 'exclude', 'autoLayout', 'default', 'animation', 'title', 'description', 'properties', '!include'
];

/**
 * Returns the expected tokens array for a given block $type.
 * Used by both parser error handler and validator to produce consistent error messages.
 */
export function getBlockTokens(blockType: string): string[] | undefined {
    return allowedTokensByBlock[blockType];
}

/**
 * Maps AST node $type to the corresponding keyword/token in the grammar.
 * Used by isTypeAllowedInBlock to check element validity within blocks.
 */
export const typeToToken: Record<string, string> = {
    'Person': 'person',
    'SoftwareSystem': 'softwaresystem',
    'Container': 'container',
    'Component': 'component',
    'CustomElement': 'element',
    'Group': 'group',
    'DeploymentNode': 'deploymentNode',
    'InfrastructureNode': 'infrastructureNode',
    'DeploymentEnvironment': 'deploymentEnvironment',
    'DeploymentGroup': 'deploymentGroup',
    'SoftwareSystemInstance': 'softwareSystemInstance',
    'ContainerInstance': 'containerInstance',
    'GenericInstance': 'instanceof',
    'Relationship': '->',
    'RelationshipArrow': '->',
    'ImplicitRelationship': '->',
    'NoRelationship': '-/>',
    'NameProperty': 'name',
    'DescriptionProperty': 'description',
    'TechnologyProperty': 'technology',
    'TagsProperty': 'tags',
    'TagProperty': 'tag',
    'UrlProperty': 'url',
    'PropertiesBlock': 'properties',
    'PropertyItem': 'property items',
    'PerspectivesBlock': 'perspectives',
    'Perspective': 'perspective',
    'PerspectiveValueProperty': 'value',
    'Include': '!include',
    'DocsDirective': '!docs',
    'AdrsDirective': '!decisions',
    'ScriptDirective': '!script',
    'PluginDirective': '!plugin',
    'IdentifiersProperty': '!identifiers',
    'ImpliedRelationshipsProperty': '!impliedRelationships',
    'Constant': '!constant',
    'SystemLandscapeView': 'systemLandscape',
    'SystemContextView': 'systemContext',
    'ContainerView': 'container',
    'ComponentView': 'component',
    'DeploymentView': 'deployment',
    'DynamicView': 'dynamic',
    'FilteredView': 'filtered',
    'CustomView': 'custom',
    'ImageView': 'image',
    'IncludeProperty': 'include',
    'ExcludeProperty': 'exclude',
    'AutoLayoutProperty': 'autoLayout',
    'AnimationProperty': 'animation',
    'TitleProperty': 'title',
    'DefaultViewProperty': 'default',
    'StylesBlock': 'styles',
    'ElementStyle': 'element',
    'RelationshipStyle': 'relationship',
    'LightStyleBlock': 'light',
    'DarkStyleBlock': 'dark',
    'ShapeProperty': 'shape',
    'BackgroundProperty': 'background',
    'ColorProperty': 'color',
    'StrokeProperty': 'stroke',
    'StrokeWidthProperty': 'strokeWidth',
    'FontSizeProperty': 'fontSize',
    'LineStyleProperty': 'border',
    'WidthProperty': 'width',
    'HeightProperty': 'height',
    'IconProperty': 'icon',
    'OpacityProperty': 'opacity',
    'MetadataProperty': 'metadata',
    'DashedProperty': 'dashed',
    'ElementStyleDescriptionProperty': 'description',
    'ThicknessProperty': 'thickness',
    'RoutingProperty': 'routing',
    'JumpProperty': 'jump',
    'PositionProperty': 'position',
    'Workspace': 'workspace',
    'ModelBlock': 'model',
    'ViewsBlock': 'views',
    'ConfigurationBlock': 'configuration',
    'TerminologyBlock': 'terminology',
    'ArchetypesBlock': 'archetypes',
    'ArchetypeDefinition': 'archetype',
    'ArchetypeInstance': 'archetype instance',
    'UsersBlock': 'users',
    'VisibilityProperty': 'visibility',
    'ScopeProperty': 'scope',
    'ElementsDirective': '!elements',
    'ElementExtension': '!element',
    'RelationshipExtension': '!relationship',
    'RelationshipsDirective': '!relationships',
    'ComponentsDirective': '!components',
    'DynamicStep': 'dynamic step',
    'ParallelStepBlock': 'parallel step',
    'AnimationStep': 'animation step',
    'InstancesProperty': 'instances',
    'DeploymentGroupProp': 'deploymentGroup',
    'HealthCheck': 'healthCheck',
    'ThemeProperty': 'theme',
    'ThemesProperty': 'themes',
    'CustomMetadataProperty': 'metadata',
    'ArchetypeBaseKeywords': 'archetype base',
    'ArchetypeNamed': 'archetype named',
    'GroupProperty': 'group',
    'PlantUMLSource': 'plantuml',
    'MermaidSource': 'mermaid',
    'KrokiSource': 'kroki',
    'ImageSource': 'image',
    'AdrsFilter': 'include/exclude',
    'IgnoredScriptBody': 'script body'
};

/**
 * Checks whether an AST node with the given $type is allowed inside a block of the specified blockType.
 * Uses typeToToken to map the $type to a grammar keyword, then checks against allowedTokensByBlock.
 */
export function isTypeAllowedInBlock($type: string, blockType: string): boolean {
    const blockTokens = allowedTokensByBlock[blockType];
    if (!blockTokens) return false;
    const token = typeToToken[$type];
    if (!token) return false;
    return blockTokens.includes(token);
}

/**
 * Complete mapping of every block $type to its allowed tokens (lowercase keywords).
 * Used by C4ParserErrorMessageProvider to generate descriptive "Unexpected tokens" messages
 * and by C4Validator.checkIncludeElements to validate included file contents.
 *
 * Each entry lists all keywords/tokens that are syntactically valid within that block.
 * Entries should be kept in sync with the grammar rules in c4.langium.
 */
export const allowedTokensByBlock: Record<string, string[]> = {
    Workspace: [
        'name', 'description', 'properties', '!docs', '!decisions',
        '!identifiers', '!impliedRelationships', 'model', 'views', 'configuration',
        '!script', '!plugin', '!constant', '!include'
    ],
    ModelBlock: [
        'person', 'softwaresystem', 'deploymentEnvironment', 'group', 'custom',
        '->', 'archetypes', 'identifiers', 'element', '!docs', '!decisions', 'properties',
        '!impliedRelationships', '!constant', '!include', '!elements', '!element', '!relationships',
        '!script', '!plugin'
    ],
    SoftwareSystem: [
        'group', 'container', 'description', 'tags', 'url', 'properties',
        'perspectives', '->', '!docs', '!decisions', '!impliedRelationships',
        'archetype instance', '!elements', '!element', '!relationship',
        '!relationships', '!script', '!plugin', '!constant', '!include'
    ],
    Container: [
        'group', 'component', 'description', 'technology', 'tags', 'url',
        'properties', 'perspectives', '->', '!docs', '!decisions', '!impliedRelationships',
        'archetype instance', '!elements', '!element', '!components',
        '!relationships', '!script', '!plugin', '!constant', '!include'
    ],
    Component: [
        'description', 'technology', 'tags', 'url', 'properties',
        'perspectives', 'group', '->', '!docs', '!decisions', '!impliedRelationships',
        '!elements', '!relationships', '!script', '!plugin', '!constant', '!include'
    ],
    Person: [
        'description', 'tags', 'url', 'properties', 'perspectives',
        '->', '!impliedRelationships',
        '!elements', '!relationships', '!docs', '!decisions',
        '!script', '!plugin', '!constant', '!include'
    ],
    DeploymentEnvironment: [
        'group', 'deploymentGroup', 'deploymentNode', '->', '!impliedRelationships',
        '!elements', '!relationships', '!docs', '!decisions',
        '!script', '!plugin', '!constant', '!include'
    ],
    DeploymentNode: [
        'group', 'deploymentNode', 'infrastructureNode', 'containerInstance',
        'softwareSystemInstance', '->', 'description', 'technology', 'instances',
        'tags', 'url', 'properties', 'perspectives', 'deploymentGroup',
        '!docs', '!decisions',
        '!elements', '!relationships', '!script', '!plugin', '!constant', '!include'
    ],
    InfrastructureNode: [
        '->', 'description', 'technology', 'tags', 'url', 'properties', 'perspectives',
        '!docs', '!decisions',
        '!elements', '!relationships', '!script', '!plugin', '!constant', '!include'
    ],
    CustomElement: [
        'description', 'tags', 'url', 'properties', 'perspectives', '->',
        '!elements', '!relationships', '!docs', '!decisions',
        '!script', '!plugin', '!constant', '!include'
    ],
    ContainerInstance: [
        '->', 'description', 'tags', 'url', 'properties', 'perspectives',
        'healthCheck', '!docs', '!decisions',
        '!elements', '!relationships', '!script', '!plugin', '!constant', '!include'
    ],
    SoftwareSystemInstance: [
        '->', 'description', 'tags', 'url', 'properties', 'perspectives',
        'healthCheck', '!docs', '!decisions',
        '!elements', '!relationships', '!script', '!plugin', '!constant', '!include'
    ],
    GenericInstance: [
        '->', 'description', 'tags', 'url', 'properties', 'perspectives',
        'healthCheck', '!docs', '!decisions',
        '!elements', '!relationships', '!script', '!plugin', '!constant', '!include'
    ],
    Relationship: [
        'tags', 'url', 'properties', 'perspectives', '!script', '!plugin', '!constant', '!include'
    ],
    ImplicitRelationship: [
        'tags', 'url', 'properties', 'perspectives', '!script', '!plugin', '!constant', '!include'
    ],
    ViewsBlock: [
        'systemLandscape', 'systemContext', 'container', 'component', 'filtered',
        'dynamic', 'deployment', 'custom', 'image', 'styles', 'theme', 'themes', 'terminology',
        'properties', '!script', '!plugin', '!constant', '!include'
    ],
    SystemLandscapeView: [...VIEW_TOKENS, '!script', '!plugin', '!constant'],
    SystemContextView: [...VIEW_TOKENS, '!script', '!plugin', '!constant'],
    ContainerView: [...VIEW_TOKENS, '!script', '!plugin', '!constant'],
    ComponentView: [...VIEW_TOKENS, '!script', '!plugin', '!constant'],
    DeploymentView: [...VIEW_TOKENS, '!script', '!plugin', '!constant'],
    DynamicView: [
        'autoLayout', 'default', 'title', 'description', 'properties', '->',
        '!script', '!plugin', '!constant', '!include'
    ],
    FilteredView: [
        'default', 'title', 'description', 'properties',
        '!script', '!plugin', '!constant', '!include'
    ],
    CustomView: [
        'include', 'exclude', 'autoLayout', 'default', 'animation', 'title', 'description',
        'properties', '!script', '!plugin', '!constant', '!include'
    ],
    ImageView: [
        'title', 'description', 'plantuml', 'mermaid', 'kroki', 'image',
        '!script', '!plugin', '!constant', '!include'
    ],
    ConfigurationBlock: [
        'scope', 'visibility', 'users', 'properties', '!script', '!plugin', '!constant', '!include'
    ],
    PropertiesBlock: [
        'property items', '!script', '!plugin', '!constant', '!include'
    ],
    StylesBlock: [
        'element', 'relationship', 'light', 'dark',
        '!script', '!plugin', '!constant', '!include'
    ],
    LightStyleBlock: [
        'element', 'relationship',
        '!script', '!plugin', '!constant', '!include'
    ],
    DarkStyleBlock: [
        'element', 'relationship',
        '!script', '!plugin', '!constant', '!include'
    ],
    RelationshipStyle: [
        'thickness', 'color', 'colour', 'style', 'routing', 'fontSize',
        'width', 'height', 'position', 'opacity', 'properties', 'dashed',
        '!script', '!plugin', '!constant', '!include'
    ],
    ElementStyle: [
        'shape', 'icon', 'iconPosition', 'width', 'height', 'background',
        'color', 'colour', 'stroke', 'strokeWidth', 'fontSize', 'border',
        'opacity', 'metadata', 'description', 'properties',
        '!script', '!plugin', '!constant', '!include'
    ],
    TerminologyBlock: [
        'person', 'softwaresystem', 'container', 'component',
        'deploymentNode', 'infrastructureNode', 'relationship', 'metadata',
        '!script', '!plugin', '!constant', '!include'
    ],
    ArchetypesBlock: [
        'softwaresystem', 'person', 'container', 'component',
        'deploymentNode', 'infrastructureNode', 'element', 'group', '->',
        '!script', '!plugin', '!constant', '!include'
    ],
    ArchetypeDefinition: [
        'description', 'technology', 'tags', 'metadata', 'properties', 'perspectives',
        '!script', '!plugin', '!constant', '!include'
    ],
    ArchetypeInstance: [
        'description', 'technology', 'tags', 'url', 'properties', 'perspectives',
        '->', 'component', 'container', 'group', '!docs',
        '!script', '!plugin', '!constant', '!include'
    ],
    ElementsDirective: [
        'tags', 'url', 'properties', 'perspectives', '->',
        'technology',
        '!script', '!plugin', '!constant', '!include'
    ],
    ElementExtension: [
        'description', 'technology', 'tags', 'url', 'properties', '->',
        'deploymentNode', 'infrastructureNode', 'containerInstance',
        'softwareSystemInstance', 'group', 'container', 'component',
        '!docs', '!decisions',
        '!script', '!plugin', '!constant', '!include'
    ],
    RelationshipExtension: [
        'tags', 'url', 'properties', 'perspectives', 'description', 'technology',
        '!script', '!plugin', '!constant', '!include'
    ],
    AnimationProperty: [
        'animation steps', '!script', '!plugin', '!constant', '!include'
    ],
    ParallelStepBlock: [
        'dynamic step', 'parallel step', '!script', '!plugin', '!constant', '!include'
    ],
    DynamicStep: [
        'description', 'technology', 'tags', 'url', 'properties',
        '!script', '!plugin', '!constant', '!include'
    ],
    PerspectivesBlock: [
        'perspective', '!script', '!plugin', '!constant', '!include'
    ],
    Perspective: [
        'description', 'value', 'url',
        '!script', '!plugin', '!constant', '!include'
    ],
    Group: [
        'person', 'softwaresystem', 'container', 'component',
        'deploymentNode', 'containerInstance', 'softwareSystemInstance', 'group', '->',
        '!elements', '!relationships', '!docs', '!decisions',
        '!script', '!plugin', '!constant', '!include'
    ],
    RelationshipsDirective: [
        'tags', 'url', 'properties', 'perspectives',
        'technology',
        '!script', '!plugin', '!constant', '!include'
    ]
};