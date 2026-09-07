// ─────────────────────────────────────────────────────────────────────────────
// C4 DSL Grammar — Structurizr-compatible architecture description language
// ─────────────────────────────────────────────────────────────────────────────
// 
// This grammar defines the complete syntax for C4 model DSL files, including:
//   - Workspace, model elements (Person, SoftwareSystem, Container, Component)
//   - Deployment elements (DeploymentNode, InfrastructureNode, instances)
//   - Relationships (explicit and implicit)
//   - Views (System Landscape, System Context, Container, Component, Dynamic, Deployment, Filtered, Custom)
//   - Styles (element and relationship styles, themes)
//   - Include directives (!include, extendsUri)
//   - View expression filtering (include/exclude with element.tag, element.type, etc.)
//
// The grammar uses Chevrotain (LL(k)) parser via Langium and is designed to
// be compatible with Structurizr DSL while extending it with our own features.
// ─────────────────────────────────────────────────────────────────────────────

grammar C4

// ═════════════════════════════════════════════════════════════════════════════
// VIEW EXPRESSION INTERFACES
// ═════════════════════════════════════════════════════════════════════════════
//
// These interfaces define the AST node types for view filtering expressions.
// They are used in include/exclude properties within views to select which
// elements and relationships should appear in a diagram.
//
// Examples:  include element.tag==Person  exclude *->MySystem
//            include MySystem.Container.Component

// element.type==<type> — filter by element type (Person, SoftwareSystem, etc.)
interface ElementTypeExpression extends ViewExpression {
    type: string
}

// element.parent==<identifier> — filter by parent element
interface ElementParentExpression extends ViewExpression {
    element: @NamedElement
}

// element.tag==<tag> or element.tag!=<tag> — filter by tag (supports comma-separated list)
interface ElementTagExpression extends ViewExpression {
    operator: '==' | '!='
    values: string[]
}

// element.technology==<value> or element.technology!=<value> — filter by technology
interface ElementTechnologyExpression extends ViewExpression {
    operator: '==' | '!='
    value: string
}

// element.properties[name]==value — filter by custom property value
interface ElementPropertiesExpression extends ViewExpression {
    name: string
    value: string
}

// element.group==<name> — filter by group name
interface ElementGroupExpression extends ViewExpression {
    value: string
}

// relationship.tag==<tag> or relationship.tag!=<tag> — filter relationships by tag
interface RelationshipTagExpression extends ViewExpression {
    operator: '==' | '!='
    values: string[]
}

// relationship.source==<identifier> — filter by relationship source element
interface RelationshipSourceExpression extends ViewExpression {
    element: @RelationshipMember
}

// relationship.destination==<identifier> — filter by relationship destination element
interface RelationshipDestinationExpression extends ViewExpression {
    element: @RelationshipMember
}

// relationship.properties[name]==value — filter relationships by property
interface RelationshipPropertiesExpression extends ViewExpression {
    name: string
    value: string
}

// relationship==<expression> — filter by relationship source/target pattern
// Supports: relationship==*, relationship==*->*, relationship==id1->id2, etc.
interface RelationshipEqExpression extends ViewExpression {
    source?: @RelationshipMember
    target?: @RelationshipMember
    starSource?: string
    starTarget?: string
    all?: string
}

// ─── Arrow expression interfaces and base interface ────────────────────────

// Simple element identifier reference: include MySystem / exclude this
interface SingleElementExpression extends ViewExpression {
    element: @NamedElement
}

// Tag string literal: include "TagName"
interface StringLiteralExpression extends ViewExpression {
    value: string
}

// -><expression>: all elements with afferent (incoming) relationships to the expression
interface AfferentCouplingExpression extends ViewExpression {
    expr: ViewExpression
}

// <expression>->: all elements with efferent (outgoing) relationships from the expression
interface EfferentCouplingExpression extends ViewExpression {
    expr: ViewExpression
}

// -><expression>->: all elements with both afferent and efferent couplings
interface AfferentEfferentExpression extends ViewExpression {
    expr: ViewExpression
}

// *-><expression>: all sources targeting the specified expression
interface StarToElementExpression extends ViewExpression {
    starSource: string
    expr: ViewExpression
}

// <expression>->*: all targets originating from the specified expression
interface StarFromElementExpression extends ViewExpression {
    expr: ViewExpression
    starTarget: string
}

// *->*: all relationships (any source to any target) — used for "show all relationships"
interface StarStarExpression extends ViewExpression {
    starSource: string
    starTarget: string
}

// <expression>-><expression>: direct relationship between two expression sets
interface DirectCouplingExpression extends ViewExpression {
    sourceExpr: ViewExpression
    targetExpr: ViewExpression
}

// element==-><expression>: element== with afferent couplings
// e.g., element==->MyComponent (shows MyComponent and all incoming relationships)
interface ElementEqAfferentExpression extends ViewExpression {
    isElementEq: string
    expr: ViewExpression
}

// element==<expression>->: element== with efferent couplings
// e.g., element==MyComponent-> (shows MyComponent and all outgoing relationships)
interface ElementEqEfferentExpression extends ViewExpression {
    isElementEq: string
    expr: ViewExpression
}

// element==-><expression>->: element== with both afferent and efferent couplings
interface ElementEqAfferentEfferentExpression extends ViewExpression {
    isElementEq: string
    expr: ViewExpression
}

// ─── Legacy interfaces (kept for backward compatibility) ────────────────────
interface ViewExpression {
}

// BinaryExpression: combines two expressions with && (intersection) or || (union)
interface BinaryExpression extends ViewExpression {
    left: ViewExpression
    operator: '&&' | '||'
    right: ViewExpression
}

// ═════════════════════════════════════════════════════════════════════════════
// TYPE RULES
// ═════════════════════════════════════════════════════════════════════════════

// Element type value — used in element.type==<type> expressions
ElementTypeValue returns string:
    PERSON_KW | SOFTWARE_SYSTEM_KW | CONTAINER_KW | COMPONENT_KW |
    DEPLOYMENT_NODE_KW | INFRASTRUCTURE_NODE_KW | SOFTWARE_SYSTEM_INSTANCE_KW |
    CONTAINER_INSTANCE_KW | CUSTOM_KW;

// ═════════════════════════════════════════════════════════════════════════════
// GRAMMAR FRAGMENTS — reusable blocks shared across multiple grammar rules
// ═════════════════════════════════════════════════════════════════════════════

// Common element properties (description, tags, url, properties, perspectives)
// Used by Person, SoftwareSystem, Container, Component, CustomElement, etc.
fragment ElementPropertyFeatures:
    descriptionProps+=DescriptionProperty
    | tagsProps+=TagProperty
    | urlProps+=UrlProperty
    | properties+=PropertiesBlock
    | perspectivesBlocks+=PerspectivesBlock
;

// Directives available in all model-level elements (ElementDslContext in Structurizr)
// Provides !elements, !relationships, !docs, !decisions directives
fragment ModelElementFeatures:
    elementsDirectives+=ElementsDirective
    | relationshipsDirectives+=RelationshipsDirective
    | docs+=DocsDirective
    | adrs+=AdrsDirective
;

// Directives for workspace/model level (WorkspaceDslContext / ModelDslContext in Structurizr)
// Provides !identifiers, !docs, !decisions directives
fragment WorkspaceFeatures:
    identifiers+=IdentifiersProperty
    | docs+=DocsDirective
    | adrs+=AdrsDirective
;

// Context-free directives — valid in virtually any context
// !include, !script, !plugin, !impliedRelationships, !constant, !const, !var
fragment EverywhereFeatures:
    includes+=Include
    | scripts+=ScriptDirective
    | plugins+=PluginDirective
    | impliedRelationships+=ImpliedRelationshipsProperty
    | constants+=Constant
;

// ═════════════════════════════════════════════════════════════════════════════
// ENTRY POINT — top-level document structure
// ═════════════════════════════════════════════════════════════════════════════

entry C4Document:
    NL* (EntryFragment (NL* EntryFragment)*)? NL*;

// Top-level fragment — anything that can appear at the root of a .dsl file
fragment EntryFragment:
    (
        workspaces+=Workspace
        | modelBlocks+=ModelBlock
        | includes+=Include
        | identifiers+=IdentifiersProperty
        | impliedRelationships+=ImpliedRelationshipsProperty
        | viewsBlocks+=ViewsBlock
        | elements+=(Person | SoftwareSystem | DeploymentEnvironment | CustomElement | Container | Component | ArchetypeInstance)
        | relationships+=Relationship
        | configurationBlocks+=ConfigurationBlock
        | constants+=Constant
        | elementStyles+=ElementStyle
        | relationshipStyles+=RelationshipStyle
        | lightBlocks+=LightStyleBlock
        | darkBlocks+=DarkStyleBlock
        | configurationBlocks+=ConfigurationBlock
        | stylesProps+=StylesBlock
        | docs+=DocsDirective
        | adrs+=AdrsDirective
        | elementsDirectives+=ElementsDirective
        | relationshipsDirectives+=RelationshipsDirective
        | properties+=PropertiesBlock
        | scripts+=ScriptDirective
        | plugins+=PluginDirective
        | themeProps+=ThemeProperty
        | themesProps+=ThemesProperty
        | terminology+=TerminologyBlock
        | techProps+=TechnologyProperty
        | tagsProps+=TagProperty
        | descriptionProps+=DescriptionProperty
        | groups+=Group
        | archetypes+=ArchetypesBlock
        | nodes+=DeploymentNode
        | urlProps+=UrlProperty
        | includeProps+=IncludeProperty
        | excludeProps+=ExcludeProperty
    );

// ═════════════════════════════════════════════════════════════════════════════
// WORKSPACE — top-level container for the entire model
// ═════════════════════════════════════════════════════════════════════════════

// workspace <name> { ... } or workspace extends <uri> { ... }
// A workspace contains the model, views, and configuration for a C4 architecture
Workspace:
    WORKSPACE_KW ((EXTENDS_KW extendsUri=Path) | (name=STRING (description=STRING)?))?
    '{'
        (
            NL+ WorkspaceFeatures
            | NL+ EverywhereFeatures
            | NL+ configurationBlocks+=ConfigurationBlock
            | NL+ descriptionProp+=DescriptionProperty
            | NL+ modelBlocks+=ModelBlock
            | NL+ nameProp+=NameProperty
            | NL+ properties+=PropertiesBlock
            | NL+ viewsBlocks+=ViewsBlock
        )*
    NL+ '}';

// !identifiers hierarchical|flat — controls identifier scope style
IdentifiersProperty:
    _IDENTIFIERS_KW style=(HIERARCHICAL_KW | FLAT_KW);

// !impliedRelationships true|false — controls implied relationship generation
ImpliedRelationshipsProperty:
    _IMPLIED_RELATIONSHIP_KW value=(TRUE_KW | FALSE_KW | STRING);

// ═════════════════════════════════════════════════════════════════════════════
// CONFIGURATION BLOCK
// ═════════════════════════════════════════════════════════════════════════════

// configuration { users, properties, visibility, scope }
ConfigurationBlock:
    CONFIGURATION_KW '{'
        (
            NL+ usersBlocks+=UsersBlock
            | NL+ properties+=PropertiesBlock
            | NL+ visibilityProps+=VisibilityProperty
            | NL+ scopeProps+=ScopeProperty
            | NL+ includes+=Include
        )*
    NL+ '}';

UsersBlock:
    USERS_KW '{'
        (users+=UserConfig)*
    NL+ '}';

// user=username role=read|write
UserConfig:
    username=STRING role=RoleValue;

RoleValue returns string:
    READ_KW | WRITE_KW;

// visibility private|public
VisibilityProperty:
    VISIBILITY_KW value=(PRIVATE_KW | PUBLIC_KW);

// scope softwaresystem|landscape|none
ScopeProperty:
    SCOPE_KW value=(SOFTWARE_SYSTEM_KW | LANDSCAPE_KW | NONE_KW);

// ═════════════════════════════════════════════════════════════════════════════
// MODEL BLOCK — contains all architecture elements
// ═════════════════════════════════════════════════════════════════════════════

// model { person ..., softwareSystem ..., deploymentEnvironment ..., etc. }
ModelBlock:
    MODEL_KW '{'
        (
            NL+ WorkspaceFeatures
            | NL+ EverywhereFeatures
            | NL+ archetypesBlocks+=ArchetypesBlock
            | NL+ elementExtensions+=ElementExtension
            | NL+ elements+=(Person | SoftwareSystem | DeploymentEnvironment | Group | CustomElement | ArchetypeInstance)
            | NL+ elementsDirectives+=ElementsDirective
            | NL+ properties+=PropertiesBlock
            | NL+ relationships+=Relationship
            | NL+ relationshipsDirectives+=RelationshipsDirective
        )*
    NL+ '}';

// ═════════════════════════════════════════════════════════════════════════════
// VIEWS BLOCK — all diagram views
// ═════════════════════════════════════════════════════════════════════════════

// views { systemLandscape ..., systemContext ..., container ..., etc. }
ViewsBlock:
    VIEWS_KW '{'
        (
            NL+ views+=View
            | NL+ properties+=PropertiesBlock
            | NL+ includes+=Include
            | NL+ themeProps+=ThemeProperty
            | NL+ themesProps+=ThemesProperty
            | NL+ stylesProps+=StylesBlock
            | NL+ terminology+=TerminologyBlock
            | NL+ constants+=Constant
        )*
    NL+ '}';

// ═════════════════════════════════════════════════════════════════════════════
// STYLES — element and relationship styling
// ═════════════════════════════════════════════════════════════════════════════

// styles { element "tag" { shape Box, ... }, relationship "tag" { ... } }
StylesBlock:
    STYLES_KW '{'
        (
            NL+ elementStyles+=ElementStyle 
            | NL+ relationshipStyles+=RelationshipStyle 
            | NL+ lightBlocks+=LightStyleBlock
            | NL+ darkBlocks+=DarkStyleBlock
            | NL+ includes+=Include
        )*
    NL+ '}';

// light { element ..., relationship ... } — light theme overrides
LightStyleBlock:
    LIGHT_KW '{'
        (
            NL+ elementStyles+=ElementStyle
            | NL+ relationshipStyles+=RelationshipStyle
            | NL+ includes+=Include
        )*
    NL+ '}';

// dark { element ..., relationship ... } — dark theme overrides
DarkStyleBlock:
    DARK_KW '{'
        (
            NL+ elementStyles+=ElementStyle
            | NL+ relationshipStyles+=RelationshipStyle
            | NL+ includes+=Include
        )*
    NL+ '}';

// element "tag" { shape Box, background #ff0000, ... }
// Defines visual properties for elements with a specific tag
ElementStyle:
    ELEMENT_KW tag=STRING '{'
        (
            NL+ shapeProps+=ShapeProperty
            | NL+ backgroundProps+=BackgroundProperty
            | NL+ colorProps+=ColorProperty
            | NL+ strokeProps+=StrokeProperty
            | NL+ strokeWidthProps+=StrokeWidthProperty
            | NL+ fontSizeProps+=FontSizeProperty
            | NL+ borderProps+=LineStyleProperty 
            | NL+ widthProps+=WidthProperty 
            | NL+ heightProps+=HeightProperty 
            | NL+ iconProps+=IconProperty 
            | NL+ opacityProps+=OpacityProperty 
            | NL+ metadataProps+=MetadataProperty 
            | NL+ descriptionProp+=ElementStyleDescriptionProperty
        )*
    NL+ '}';

// description true|false — enables/disables description display for element style
ElementStyleDescriptionProperty:
    DESCRIPTION_KW value=(STRING | UNQUOTED_STRING | AnyKeyword);

// ═════════════════════════════════════════════════════════════════════════════
// TERMINOLOGY — custom display names for element types
// ═════════════════════════════════════════════════════════════════════════════

// terminology { person "User", softwareSystem "Service", metadata square }
// Overrides how element types are labeled in rendered diagrams
TerminologyBlock:
    TERMINOLOGY_KW '{'
        (
            NL+ PERSON_KW person+=(UNQUOTED_STRING | STRING)
            | NL+ SOFTWARE_SYSTEM_KW softwareSystem+=UNQUOTED_STRING
            | NL+ CONTAINER_KW container+=UNQUOTED_STRING
            | NL+ COMPONENT_KW component+=UNQUOTED_STRING
            | NL+ DEPLOYMENT_NODE_KW deploymentNode+=UNQUOTED_STRING
            | NL+ INFRASTRUCTURE_NODE_KW infrastructureNode+=UNQUOTED_STRING
            | NL+ RELATIONSHIP_KW relationship+=UNQUOTED_STRING
            | NL+ METADATA_KW metadata+=('square' | 'round' | 'curly' | 'angle' | 'double-angle' | NONE_KW)
            | NL+ includes+=Include
        )*
    NL+ '}';

// ═════════════════════════════════════════════════════════════════════════════
// ARCHETYPES — reusable element templates
// ═════════════════════════════════════════════════════════════════════════════

// archetypes { person { ... }, softwaresystem { ... }, ... }
ArchetypesBlock:
    ARCHETYPES_KW '{'
        (definitions+=ArchetypeDefinition
         | NL+ includes+=Include)*
    NL+ '}';

// archetype definition with base type or arrow, optional body with properties
ArchetypeDefinition:
    (NL+
    (baseType=ArchetypeBaseKeywords | baseArrow=ARROW)
    (
        '{'
            (
                NL+ descriptionProps+=DescriptionProperty
                | NL+ techProps+=TechnologyProperty
                | NL+ tagsProps+=TagProperty
                | NL+ metadataProps+=CustomMetadataProperty
                | NL+ properties+=PropertiesBlock
                | NL+ perspectivesBlocks+=PerspectivesBlock
                | NL+ includes+=Include
            )*
        NL+ '}'
    )?
    |
    NL+
    ArchetypeNamed)
;

ArchetypeRefIdentifier returns string:
    UNQUOTED_STRING | RELATIONSHIP_SOURCE;

// Named archetype: id = baseType { ... }
ArchetypeNamed:
    name=ASSIGNMENT
    (
        baseType=ArchetypeBaseKeywords | 
        baseArrow=ARROW | 
        ('--' baseArchetype=[ArchetypeDefinition:ArchetypeRefIdentifier] ('>' | ARROW)) |
        baseArchetype=[ArchetypeDefinition:ArchetypeRefIdentifier]
    )
    (
        '{'
            (
                NL+ descriptionProps+=DescriptionProperty
                | NL+ techProps+=TechnologyProperty
                | NL+ tagsProps+=TagProperty
                | NL+ metadataProps+=CustomMetadataProperty
                | NL+ properties+=PropertiesBlock
                | NL+ perspectivesBlocks+=PerspectivesBlock
                | NL+ includes+=Include
            )*
        NL+ '}'
    )?
;

CustomMetadataProperty:
    METADATA_KW value=STRING;

// Base keywords for archetypes: person, softwaresystem, container, component, etc.
ArchetypeBaseKeywords returns string:
    PERSON_KW | SOFTWARE_SYSTEM_KW | CONTAINER_KW | COMPONENT_KW | 
    DEPLOYMENT_NODE_KW | INFRASTRUCTURE_NODE_KW | SOFTWARE_SYSTEM_INSTANCE_KW | 
    CONTAINER_INSTANCE_KW | CUSTOM_KW | ELEMENT_KW | GROUP_KW;

ArchetypeIdentifier returns string:
    UNQUOTED_STRING | STRING | CUSTOM_KW;

// Instance of an archetype — creates an element based on the archetype template
ArchetypeInstance:
    Id?
    archetype=[ArchetypeDefinition:ArchetypeIdentifier]
    (name=STRING Meta?)?
    (
        '{'
            (
                NL+ descriptionProps+=DescriptionProperty
                | NL+ techProps+=TechnologyProperty
                | NL+ tagsProps+=TagProperty
                | NL+ urlProps+=UrlProperty
                | NL+ properties+=PropertiesBlock
                | NL+ perspectivesBlocks+=PerspectivesBlock
                | NL+ archetypeInstances+=ArchetypeInstance
                | NL+ relationships+=(Relationship | ImplicitRelationship)
                | NL+ components+=Component
                | NL+ containers+=Container
                | NL+ groups+=Group
                | NL+ docs+=DocsDirective
                | NL+ includes+=Include
            )*
        NL+ '}'
    )?;

// ═════════════════════════════════════════════════════════════════════════════
// RELATIONSHIP STYLE
// ═════════════════════════════════════════════════════════════════════════════

// relationship "tag" { thickness 2, color #ff0000, ... }
RelationshipStyle:
    RELATIONSHIP_KW tag=(STRING) '{'
        (
            NL+ thicknessProps+=ThicknessProperty
            | NL+ colorProps+=ColorProperty 
            | NL+ styleProps+=LineStyleProperty
            | NL+ routingProps+=RoutingProperty 
            | NL+ jumpProps+=JumpProperty 
            | NL+ fontSizeProps+=FontSizeProperty 
            | NL+ widthProps+=WidthProperty 
            | NL+ positionProps+=PositionProperty 
            | NL+ opacityProps+=OpacityProperty 
            | NL+ properties+=PropertiesBlock 
            | NL+ dashedProp+=DashedProperty  
            | NL+ includes+=Include          
        )*
    NL+ '}';

// ═════════════════════════════════════════════════════════════════════════════
// PROPERTY RULES — individual style and metadata properties
// ═════════════════════════════════════════════════════════════════════════════

ColorProperty:
    (COLOR_KW | COLOUR_KW) value=(COLOR_HEX | STRING | UNQUOTED_STRING | AnyKeyword);

LineStyleProperty:
    STYLE_KW value=(UNQUOTED_STRING | AnyKeyword);

RoutingProperty:
    ROUTING_KW value=(UNQUOTED_STRING | AnyKeyword);

JumpProperty:
    JUMP_KW value=(UNQUOTED_STRING | AnyKeyword);

PositionProperty:
    POSITION_KW value=INT;

ThicknessProperty:
    THICKNESS_KW value=INT;

FontSizeProperty:
    FONTSIZE_KW value=(INT | STRING);

WidthProperty:
    WIDTH_KW value=(INT | STRING);

HeightProperty:
    HEIGHT_KW value=(INT | STRING);

OpacityProperty:
    OPACITY_KW value=INT;

ShapeProperty:
    SHAPE_KW value=(UNQUOTED_STRING | STRING | AnyKeyword);

BackgroundProperty:
    BACKGROUND_KW value=(COLOR_HEX | STRING | UNQUOTED_STRING | AnyKeyword);

StrokeWidthProperty:
    STROKE_WIDTH_KW value=(INT | STRING);

StrokeProperty:
    STROKE_KW value=(COLOR_HEX | STRING | UNQUOTED_STRING | AnyKeyword);

MetadataProperty:
    METADATA_KW value=(STRING | UNQUOTED_STRING | AnyKeyword);

IconProperty:
    ICON_KW value=Path;

DashedProperty:
    DASHED_KW value=(TRUE_KW | FALSE_KW | STRING);

ThemeProperty:
    THEME_KW value=Path;

ThemesProperty:
    THEMES_KW values+=Path (','? values+=Path)*;

// ═════════════════════════════════════════════════════════════════════════════
// PERSPECTIVES
// ═════════════════════════════════════════════════════════════════════════════

PerspectivesBlock:
    PERSPECTIVES_KW '{'
        (items+=Perspective
         | NL+ includes+=Include)*
    NL+ '}';

Perspective:
    (NL+ PERSPECTIVE_KW name=PerspectiveValue '{'
        (
            NL+ descriptionProps+=DescriptionProperty
            | NL+ valueProps+=PerspectiveValueProperty
            | NL+ urlProps+=UrlProperty
            | NL+ includes+=Include
        )*
    NL+ '}' 
    | 
    NL+ PerspectiveInline);

PerspectiveInline:
    name=PerspectiveValue 
    description=PerspectiveValue 
    (value=PerspectiveValue)?;

PerspectiveValue returns string:
    STRING | UNQUOTED_STRING;

PerspectiveValueProperty:
    VALUE_KW value=PerspectiveValue;

// ═════════════════════════════════════════════════════════════════════════════
// VIEWS — all diagram view types
// ═════════════════════════════════════════════════════════════════════════════

// Union of all renderable view types (excludes ImageView)
RenderedView:
    SystemLandscapeView | SystemContextView | ContainerView | ComponentView | DeploymentView | DynamicView | FilteredView | CustomView;

// All view types including ImageView
View:
    RenderedView | ImageView;

// View key fragment — used for explicit view keys
fragment Key:
    key=(STRING | UNQUOTED_STRING | INT);

// Base key fragment — used for FilteredView to reference a parent view
fragment BaseKey:
    baseKey=(STRING | UNQUOTED_STRING | INT);

// Custom view — user-defined view with include/exclude expressions
CustomView:
    CUSTOM_KW (Key (title=STRING (description=STRING)?)?)?
    '{'
        (
            NL+ includeProps+=IncludeProperty
            | NL+ excludeProps+=ExcludeProperty
            | NL+ autoLayoutProps+=AutoLayoutProperty
            | NL+ defaultViews+=DefaultViewProperty
            | NL+ animationProps+=AnimationProperty
            | NL+ titleProps+=TitleProperty
            | NL+ descriptionProps+=DescriptionProperty
            | NL+ properties+=PropertiesBlock
            | NL+ scripts+=ScriptDirective
            | NL+ includes+=Include
        )*
    NL+ '}';

// Filtered view — filters a base view by tag (include/exclude mode)
FilteredView:
    FILTERED_KW
    BaseKey
    mode=(INCLUDE_KW | EXCLUDE_KW)
    tagsProp=(STRING | UNQUOTED_STRING)
    (Key (description=STRING)?)? 
    (
        '{'
            (
                NL+ defaultView+=DefaultViewProperty
                | NL+ titleProps+=TitleProperty
                | NL+ descriptionProps+=DescriptionProperty
                | NL+ properties+=PropertiesBlock
                | NL+ scripts+=ScriptDirective
                | NL+ includes+=Include
            )*
        NL+ '}'
    )?;

// Image view — embeds external diagram sources (PlantUML, Mermaid, Kroki, image)
ImageView:
    IMAGE_KW (element=[NamedElement:Identifier] | all='*') Key? '{'
        (
            NL+ defaultViews+=DefaultViewProperty
            | NL+ titleProps+=TitleProperty
            | NL+ descriptionProps+=DescriptionProperty
            | NL+ properties+=PropertiesBlock
            | NL+ sources+=PlantUMLSource
            | NL+ sources+=MermaidSource
            | NL+ sources+=KrokiSource
            | NL+ sources+=ImageSource
            | NL+ scripts+=ScriptDirective
            | NL+ includes+=Include
            )*
    NL+ '}';

PlantUMLSource:
    PLANTUML_KW value=(Path | TEXT_BLOCK);

MermaidSource:
    MERMAID_KW value=(Path | TEXT_BLOCK);

KrokiSource:
    KROKI_KW format=(UNQUOTED_STRING | STRING) value=(Path | TEXT_BLOCK);

ImageSource:
    IMAGE_KW value=(Path | TEXT_BLOCK);

// ─── View definitions ──────────────────────────────────────────────────────

// System Landscape view — shows all elements in the model (no scope)
SystemLandscapeView:
    SYSTEM_LANDSCAPE_KW (Key (description=STRING)?)? '{'
        (
            NL+ includeProps+=IncludeProperty
            | NL+ excludeProps+=ExcludeProperty
            | NL+ autoLayoutProps+=AutoLayoutProperty
            | NL+ animationProps+=AnimationProperty
            | NL+ titleProps+=TitleProperty
            | NL+ defaultViews+=DefaultViewProperty
            | NL+ descriptionProps+=DescriptionProperty
            | NL+ properties+=PropertiesBlock
            | NL+ scripts+=ScriptDirective
            | NL+ includes+=Include
        )*
    NL+ '}';

// Deployment view — shows deployment nodes for a system in a specific environment
DeploymentView:
    DEPLOYMENT_KW
    (softwareSystem=[SoftwareSystem:Identifier] | all='*')
    (
        environment=[DeploymentEnvironment:Identifier]
    )
    (Key (description=STRING)?)? '{'
        (
            NL+ includeProps+=IncludeProperty
            | NL+ excludeProps+=ExcludeProperty
            | NL+ autoLayoutProps+=AutoLayoutProperty
            | NL+ animationProps+=AnimationProperty
            | NL+ titleProps+=TitleProperty
            | NL+ defaultViews+=DefaultViewProperty
            | NL+ descriptionProps+=DescriptionProperty
            | NL+ properties+=PropertiesBlock
            | NL+ scripts+=ScriptDirective
            | NL+ includes+=Include
        )*
    NL+ '}';

// Dynamic view — sequenced interaction steps between elements
DynamicView:
    DYNAMIC_KW (element=[NamedElement:QualifiedName] | all='*') (Key (description=STRING)?)? '{'
        (
            NL+ members+=DynamicMember
            | NL+ autoLayoutProps+=AutoLayoutProperty
            | NL+ titleProps+=TitleProperty
            | NL+ defaultViews+=DefaultViewProperty
            | NL+ descriptionProps+=DescriptionProperty
            | NL+ properties+=PropertiesBlock
            | NL+ scripts+=ScriptDirective
            | NL+ includes+=Include
        )*
    NL+ '}';

// A dynamic member is either a single step or a parallel block
DynamicMember:
    DynamicStep | ParallelStepBlock;

// Parallel step block — a group of steps that execute in parallel
ParallelStepBlock:
    '{' 
        (NL+ members+=DynamicMember
         | NL+ includes+=Include)* 
    NL+ '}';

// Single dynamic step: <order>: <source> -> <target> "description"
DynamicStep:
    (order=INT ':')? 
    from=[NamedElement:QualifiedName]
    (
        ARROW target=[NamedElement:QualifiedName] (description=STRING (technology=STRING)?)?
        |
        (description=STRING)?
    )
    (
        '{'
            (
                NL+ descriptionProp+=DescriptionProperty
                | NL+ techProp+=TechnologyProperty
                | NL+ tagsProps+=TagProperty
                | NL+ urlProp+=UrlProperty
                | NL+ properties+=PropertiesBlock
                | NL+ includes+=Include
            )*
        NL+ '}'
    )?;

// System Context view — shows a specific software system with its environment
SystemContextView:
    SYSTEM_CONTEXT_KW
    softwareSystem=[SoftwareSystem:Identifier] (Key (description=STRING)?)? '{'
        (
            NL+ includeProps+=IncludeProperty
            | NL+ excludeProps+=ExcludeProperty
            | NL+ autoLayoutProps+=AutoLayoutProperty
            | NL+ animationProps+=AnimationProperty
            | NL+ titleProps+=TitleProperty
            | NL+ defaultViews+=DefaultViewProperty
            | NL+ descriptionProps+=DescriptionProperty
            | NL+ properties+=PropertiesBlock
            | NL+ scripts+=ScriptDirective
            | NL+ includes+=Include
        )*
    NL+ '}';

// Container view — shows containers within a software system
ContainerView:
    CONTAINER_KW softwareSystem=[SoftwareSystem:Identifier] (Key (description=STRING)?)? '{'
        (
            NL+ includeProps+=IncludeProperty
            | NL+ excludeProps+=ExcludeProperty
            | NL+ autoLayoutProps+=AutoLayoutProperty
            | NL+ animationProps+=AnimationProperty
            | NL+ titleProps+=TitleProperty
            | NL+ defaultViews+=DefaultViewProperty
            | NL+ descriptionProps+=DescriptionProperty
            | NL+ properties+=PropertiesBlock
            | NL+ scripts+=ScriptDirective
            | NL+ includes+=Include
        )*
    NL+ '}';

// Component view — shows components within a container
ComponentView:
    COMPONENT_KW container=[Container:Identifier] (Key (description=STRING)?)? '{'
        (
            NL+ includeProps+=IncludeProperty
            | NL+ excludeProps+=ExcludeProperty
            | NL+ autoLayoutProps+=AutoLayoutProperty
            | NL+ animationProps+=AnimationProperty
            | NL+ titleProps+=TitleProperty
            | NL+ defaultViews+=DefaultViewProperty
            | NL+ descriptionProps+=DescriptionProperty
            | NL+ properties+=PropertiesBlock
            | NL+ scripts+=ScriptDirective
            | NL+ includes+=Include
        )*
    NL+ '}';

// ─── View property rules ───────────────────────────────────────────────────

DefaultViewProperty:
    value=DEFAULT_KW;

// autolayout <direction> <rankSeparation> <nodeSeparation>
AutoLayoutProperty:
    AUTOLAYOUT_KW (direction=('lr'|'rl'|'tb'|'bt'))? (rankSeparation=INT)? (nodeSeparation=INT)?;

// include <expression> — includes elements matching the expression
IncludeProperty:
    INCLUDE_KW (all='*' | expressions+=ExpressionElement (','? expressions+=ExpressionElement)*);

// exclude <expression> — excludes elements matching the expression
ExcludeProperty:
    EXCLUDE_KW (expressions+=ExpressionElement (','? expressions+=ExpressionElement)*);

ExpressionElement:
    expression=ViewExpression;

// ═════════════════════════════════════════════════════════════════════════════
// VIEW EXPRESSION PARSING (include/exclude filtering)
// ═════════════════════════════════════════════════════════════════════════════
//
// Expression precedence (highest to lowest):
//   1. Primary expressions (element.tag==, element.type==, relationship==, etc.)
//   2. && (logical AND / intersection)
//   3. || (logical OR / union)
//
// Arrow expressions (->, afferent/efferent) are parsed at the primary level
// through NonArrowExpression to prevent left recursion.

ViewExpression returns ViewExpression:
    LogicalOrExpression;

LogicalOrExpression returns ViewExpression:
    LogicalAndExpression ({BinaryExpression.left=current} operator='||' right=LogicalAndExpression)*;

LogicalAndExpression returns ViewExpression:
    PrimaryViewExpression ({BinaryExpression.left=current} operator='&&' right=PrimaryViewExpression)*;

// StringExpressionLiteral: allows quoted expressions like "* -> element.tag==Software System"
StringExpressionLiteral returns ViewExpression:
    {StringLiteralExpression} value=STRING;

// Primary expressions — all expression types that can appear in include/exclude
PrimaryViewExpression returns ViewExpression:
    '(' ViewExpression ')' 
    | StringExpressionLiteral
    | ElementTagExpression
    | ElementTypeExpression
    | ElementParentExpression
    | ElementTechnologyExpression
    | ElementPropertiesExpression
    | ElementGroupExpression
    | RelationshipTagExpression
    | RelationshipSourceExpression
    | RelationshipDestinationExpression
    | RelationshipPropertiesExpression
    | RelationshipEqExpression
    | AfferentCouplingExpression
    | EfferentCouplingExpression
    | AfferentEfferentExpression
    | StarToElementExpression
    | StarFromElementExpression
    | StarStarExpression
    | DirectCouplingExpression
    | ElementEqAfferentExpression
    | ElementEqEfferentExpression
    | ElementEqAfferentEfferentExpression
    | SingleElementExpression;

// ─── Explicit expression rules (Structurizr DSL) ───────────────────────────

// element.type==<type> — matches elements with the specified type
ElementTypeExpression returns ViewExpression:
    {ElementTypeExpression} ELEMENT_TYPE_KW '==' type=ElementTypeValue;

// element.parent==<identifier> — matches elements with the specified parent
ElementParentExpression returns ViewExpression:
    {ElementParentExpression} ELEMENT_PARENT_KW '==' element=[NamedElement:Identifier];

// element.tag==<tag>[,tag] or element.tag!=<tag>[,tag] — matches by tag
ElementTagExpression returns ViewExpression:
    {ElementTagExpression} ELEMENT_TAG_KW operator=('==' | '!=') values+=ExpressionValue (',' values+=ExpressionValue)*;

// element.technology==<value> or element.technology!=<value> — matches by technology
ElementTechnologyExpression returns ViewExpression:
    {ElementTechnologyExpression} ELEMENT_TECHNOLOGY_KW operator=('==' | '!=') value=ExpressionValue;

// element.properties[name]==value — matches by custom property
ElementPropertiesExpression returns ViewExpression:
    {ElementPropertiesExpression} ELEMENT_PROPERTIES_KW '[' name=STRING ']' '==' value=ExpressionValue;

// element.group==name — matches elements in the specified group
ElementGroupExpression returns ViewExpression:
    {ElementGroupExpression} ELEMENT_GROUP_KW '==' value=ExpressionValue;

// relationship.tag==<tag>[,tag] or relationship.tag!=<tag>[,tag] — matches relationships by tag
RelationshipTagExpression returns ViewExpression:
    {RelationshipTagExpression} RELATIONSHIP_TAG_KW operator=('==' | '!=') values+=ExpressionValue (',' values+=ExpressionValue)*;

// relationship.source==<identifier> — matches relationships by source element
RelationshipSourceExpression returns ViewExpression:
    {RelationshipSourceExpression} RELATIONSHIP_SOURCE_KW '==' element=[RelationshipMember:Identifier];

// relationship.destination==<identifier> — matches relationships by destination element
RelationshipDestinationExpression returns ViewExpression:
    {RelationshipDestinationExpression} RELATIONSHIP_DESTINATION_KW '==' element=[RelationshipMember:Identifier];

// relationship.properties[name]==value — matches relationships by property
RelationshipPropertiesExpression returns ViewExpression:
    {RelationshipPropertiesExpression} RELATIONSHIP_PROPERTIES_KW '[' name=STRING ']' '==' value=ExpressionValue;

// relationship==<pattern> — matches relationships by source/target pattern
// Supports: relationship==* (all), relationship==*->* (all with arrows),
// relationship==id->*, relationship==*->id, relationship==id1->id2
RelationshipEqExpression returns ViewExpression:
    {RelationshipEqExpression} RELATIONSHIP_KW '=='
    (
        starSource='*' ARROW (starTarget='*' | target=[RelationshipMember:Identifier])
        |
        source=[RelationshipMember:Identifier] ARROW (starTarget='*' | target=[RelationshipMember:Identifier])
        |
        all='*'
    );

// ─── Arrow expression rules ────────────────────────────────────────────────

// NonArrowExpression: subset of ViewExpression that does NOT contain arrow forms.
// This prevents left recursion when arrow expressions embed expressions.
NonArrowExpression returns ViewExpression:
    '(' ViewExpression ')' 
    | StringExpressionLiteral
    | ElementTagExpression
    | ElementTypeExpression
    | ElementParentExpression
    | ElementTechnologyExpression
    | ElementPropertiesExpression
    | ElementGroupExpression
    | RelationshipTagExpression
    | RelationshipSourceExpression
    | RelationshipDestinationExpression
    | RelationshipPropertiesExpression
    | RelationshipEqExpression
    | SingleElementExpression;

// Simple element reference: include MySystem / exclude this
SingleElementExpression returns ViewExpression:
    {SingleElementExpression} (element=[NamedElement:Identifier]);

// -><expression>: afferent (incoming) relationships to the expression
AfferentCouplingExpression returns ViewExpression:
    {AfferentCouplingExpression} ARROW expr=NonArrowExpression;

// <expression>->: efferent (outgoing) relationships from the expression
EfferentCouplingExpression returns ViewExpression:
    {EfferentCouplingExpression} expr=NonArrowExpression ARROW;

// -><expression>->: both afferent and efferent couplings
AfferentEfferentExpression returns ViewExpression:
    {AfferentEfferentExpression} ARROW expr=NonArrowExpression ARROW;

// *-><expression>: all sources targeting the specified expression
StarToElementExpression returns ViewExpression:
    {StarToElementExpression} starSource='*' ARROW expr=NonArrowExpression;

// <expression>->*: all targets originating from the specified source
StarFromElementExpression returns ViewExpression:
    {StarFromElementExpression} expr=NonArrowExpression ARROW starTarget='*';

// *->*: all relationships (any source to any target)
StarStarExpression returns ViewExpression:
    {StarStarExpression} starSource='*' ARROW starTarget='*';

// <expression>-><expression>: direct relationship between two expressions
DirectCouplingExpression returns ViewExpression:
    {DirectCouplingExpression} sourceExpr=NonArrowExpression ARROW targetExpr=NonArrowExpression;

// element==-><expression>: element== with afferent couplings
ElementEqAfferentExpression returns ViewExpression:
    {ElementEqAfferentExpression} isElementEq='element==' ARROW expr=NonArrowExpression;

// element==<expression>->: element== with efferent couplings
ElementEqEfferentExpression returns ViewExpression:
    {ElementEqEfferentExpression} isElementEq='element==' expr=NonArrowExpression ARROW;

// element==-><expression>->: element== with both afferent and efferent couplings
ElementEqAfferentEfferentExpression returns ViewExpression:
    {ElementEqAfferentEfferentExpression} isElementEq='element==' ARROW expr=NonArrowExpression ARROW;

// Expression value — used in element.tag==<value>, element.technology==<value>, etc.
ExpressionValue returns string:
    UNQUOTED_STRING | INT | AnyKeyword;

// ═════════════════════════════════════════════════════════════════════════════
// ANIMATION
// ═════════════════════════════════════════════════════════════════════════════

AnimationProperty:
    ANIMATION_KW (
        '{'
            (steps+=AnimationStep
             | NL+ includes+=Include)*
        NL+ '}'
        |
        steps+=AnimationStep
    );

// Animation step: a set of elements that appear together in an animation frame
AnimationStep:
    elements+=NL+ ExpressionElement (','? elements+=ExpressionElement)*;

TitleProperty:
    TITLE_KW value=STRING;

// ═════════════════════════════════════════════════════════════════════════════
// ELEMENT EXTENSION — adds new elements or extends existing ones
// ═════════════════════════════════════════════════════════════════════════════

// !element <id> { ... } or <id> = !element <target> { ... }
// Extends an existing element with additional children (containers, components, etc.)
ElementExtension:
    ((id=ElementAssignment) _ELEMENT_KW target=[NamedElement:QualifiedName]
    '{'
        (
            ElementExtensionBody
        )*
    NL+ '}'
    )
    |
    (_ELEMENT_KW id=Identifier
    '{'
        (
            ElementExtensionBody
        )*
    NL+ '}');

// !elements <expression> { tags, url, properties, perspectives, technology, relationships }
// Applies overlay modifications to all elements matching the expression
ElementsDirective:
    _ELEMENTS_KW expression=ViewExpression '{'
        (
            NL+ tagsProps+=TagProperty
            | NL+ urlProps+=UrlProperty
            | NL+ properties+=PropertiesBlock
            | NL+ perspectivesBlocks+=PerspectivesBlock
            | NL+ techProps+=TechnologyProperty
            | NL+ relationships+=(Relationship | ImplicitRelationship)
            | NL+ includes+=Include
        )*
    NL+ '}';

// Body of an element extension — defines what to add to the extended element
fragment ElementExtensionBody:
    NL+ descriptionProps+=DescriptionProperty
        | NL+ techProps+=TechnologyProperty
        | NL+ tagsProps+=TagProperty
        | NL+ urlProps+=UrlProperty
        | NL+ properties+=PropertiesBlock
        | NL+ nodes+=DeploymentNode
        | NL+ infrastructureNodes+=InfrastructureNode
        | NL+ softwareSystemInstances+=SoftwareSystemInstance
        | NL+ containerInstances+=ContainerInstance
        | NL+ genericInstances+=GenericInstance
        | NL+ containers+=Container
        | NL+ components+=Component
        | NL+ groups+=Group
        | NL+ relationships+=ImplicitRelationship
        | NL+ docs+=DocsDirective
        | NL+ adrs+=AdrsDirective
        | NL+ includes+=Include;

// !relationship <target> { tags, url, properties, ... }
// Applies overlay modifications to a specific relationship
RelationshipExtension:
    _RELATIONSHIP_KW target=[Relationship:QualifiedName] '{'
        (
            NL+ tagsProps+=TagProperty
            | NL+ urlProps+=UrlProperty
            | NL+ properties+=PropertiesBlock
            | NL+ perspectivesBlocks+=PerspectivesBlock
            | NL+ descriptionProps+=DescriptionProperty
            | NL+ techProps+=TechnologyProperty
            | NL+ includes+=Include
        )*
    NL+ '}';

// ═════════════════════════════════════════════════════════════════════════════
// PROPERTIES BLOCK — key-value property store
// ═════════════════════════════════════════════════════════════════════════════

PropertiesBlock:
    PROPERTIES_KW '{'
        (
            NL+ items+=PropertyItem
            | NL+ includes+=Include
         )*
    NL '}';

PropertyItem:
    name=PropertyKey value=PropertyValue;

PropertyKey returns string:
    UNQUOTED_STRING | ASSIGNMENT | DOT_SUFFIX | STRING | AnyKeyword;

PropertyValue returns string:
    (UNQUOTED_STRING | PATH_TOKEN | ASSIGNMENT | DOT_SUFFIX | INT | STRING | AnyKeyword | '=' | ';' | '.' | '/' | '-' )+;

NameProperty:
    NAME_KW value=STRING;

DescriptionProperty:
    DESCRIPTION_KW value=STRING;

TechnologyProperty:
    TECHNOLOGY_KW value=STRING;

UrlProperty:
    URL_KW value=(PATH_TOKEN | STRING | UNQUOTED_STRING);

// ═════════════════════════════════════════════════════════════════════════════
// TYPE ALIASES
// ═════════════════════════════════════════════════════════════════════════════

// All element types that can be referenced by name/ID
type NamedElement = Person | SoftwareSystem | Container | Component | DeploymentNode | InfrastructureNode | SoftwareSystemInstance | ContainerInstance | GenericInstance | Relationship | ElementExtension | ArchetypeInstance | ArchetypeDefinition | CustomElement | Group | DeploymentGroup | DeploymentEnvironment;

// Element types that can be a source or target of a relationship
type RelationshipMember = Person | SoftwareSystem | Container | Component | DeploymentNode | InfrastructureNode | SoftwareSystemInstance| ContainerInstance | CustomElement;

// ═════════════════════════════════════════════════════════════════════════════
// TAG PROPERTY
// ═════════════════════════════════════════════════════════════════════════════

TagProperty:
    (TAG_KW | TAGS_KW) values+=(STRING | UNQUOTED_STRING | INT) (','? values+=(STRING | UNQUOTED_STRING | INT))*;

// ═════════════════════════════════════════════════════════════════════════════
// DIRECTIVES — !include, !docs, !adrs, !script, !plugin, !identifiers, etc.
// ═════════════════════════════════════════════════════════════════════════════

// !include <path> — includes content from another DSL file
Include:
    _INCLUDE_KW file=Path;

// !docs <path> [<importer>] { include/exclude <patterns> }
DocsDirective:
    _DOCS_KW path=Path (importer=(STRING | UNQUOTED_STRING))?
    (
        '{'
            (NL+ filters+=AdrsFilter)*
        NL+ '}'
    )?;

// !adrs <path> [<importer>] — or !decisions <path>
AdrsDirective:
    (_ADRS_KW | _DECISIONS_KW) path=Path (importer=(STRING | UNQUOTED_STRING))?
    (
        '{'
            (NL+ filters+=AdrsFilter)*
        NL+ '}'
    )?;

// ADRS filter: include/exclude with pattern matching
AdrsFilter:
    mode=(INCLUDE_KW | EXCLUDE_KW) patterns+=(STRING | UNQUOTED_STRING) (','? patterns+=(STRING | UNQUOTED_STRING))*;

// !script <path> or !script <language> { ... } — inline or external script
ScriptDirective:
    _SCRIPT_KW
    (Path (
        '{'
            IgnoredScriptBody*
        NL '}'
    )?
    |
    (script=( 'groovy' | 'kotlin' | 'ruby' | 'javascript' ) '{' 
        IgnoredScriptBody*
    NL '}'
    ));

// Script body content — captures all tokens as-is (preserved for script execution)
IgnoredScriptBody returns string:
    (
        '(' | ')' | '=' | '[' | ']' | ';' | '.' | ':' | '/' | '-' | ',' | '$' | ARROW | NO_ARROW | '>' | '*' | '@' | '!' | '+'
        | STRING
        | UNQUOTED_STRING
        | PATH_TOKEN
        | RELATIONSHIP_SOURCE
        | INT 
        | NL 
        | ASSIGNMENT 
        | DOT_SUFFIX 
        | SLASH_SUFFIX
        | HYPHEN_SUFFIX
        | AnyKeyword
        | '{' (IgnoredScriptBody)* '}'
    )
;

// !plugin <name> { ... } — external plugin declaration
PluginDirective returns string:
    _PLUGIN_KW (STRING | UNQUOTED_STRING)
    (
        '{' 
            IgnoredScriptBody*
        NL '}'
    )?;

// !relationships <expression> { tags, url, properties, ... }
// Applies overlay modifications to all relationships matching the expression
RelationshipsDirective:
    _RELATIONSHIPS_KW expression=ViewExpression
    '{'
        (
            NL+ includes+=Include
            | NL+ perspectivesBlocks+=PerspectivesBlock
            | NL+ properties+=PropertiesBlock
            | NL+ tagsProps+=TagProperty
            | NL+ techProps+=TechnologyProperty
            | NL+ urlProps+=UrlProperty
        )*
    NL+ '}';

// !components <id> { ... } — legacy component directive
ComponentsDirective returns string:
    COMPONENTS_KW '{' 
        (IgnoredScriptBody)* 
    NL '}';

// ═════════════════════════════════════════════════════════════════════════════
// GROUP
// ═════════════════════════════════════════════════════════════════════════════

GroupProperty:
    GROUP_KW value=STRING;

// group <name> { person ..., softwareSystem ..., relationship ..., etc. }
Group:
    Id? GROUP_KW Name
    '{'
        (
            NL+ ModelElementFeatures
            | NL+ EverywhereFeatures
            | NL+ elements+=(Person | SoftwareSystem | Container | Component | DeploymentNode | ContainerInstance | SoftwareSystemInstance | GenericInstance | Group)
            | NL+ relationships+=(Relationship | ImplicitRelationship)
        )*
    NL+ '}';

// ═════════════════════════════════════════════════════════════════════════════
// RELATIONSHIPS
// ═════════════════════════════════════════════════════════════════════════════

// Relationship arrow: -> or --<archetype>->
RelationshipArrow:
    (arrow=ARROW | ('--' archetype=[ArchetypeDefinition:Identifier] ARROW));

// NoRelationship: -/> — explicitly marks no relationship between two elements
NoRelationship:
    (source=[NamedElement:QualifiedName] | sourceThis?=THIS_KW)
    NO_ARROW
    (target=[NamedElement:QualifiedName] | targetThis?=THIS_KW)
    (description=STRING)?
    (
        '{'
            (NL+ relationships+=(Relationship | ImplicitRelationship))*
        NL+ '}'
    )?;

// Explicit relationship: source -> target "description" { tags, url, ... }
Relationship:
    Id?
    (
        (source=[RelationshipMember:QualifiedName] | sourceThis?=THIS_KW) RelationshipArrow (target=[RelationshipMember:QualifiedName] | targetThis?=THIS_KW)
    )
    Meta?
    (
        '{'
            (
                NL+ tagsProps+=TagProperty
                | NL+ urlProps+=UrlProperty
                | NL+ properties+=PropertiesBlock
                | NL+ perspectivesBlocks+=PerspectivesBlock
                | NL+ scripts+=ScriptDirective
                | NL+ includes+=Include
            )*
        NL+ '}'
    )?;

// Implicit relationship: -> target "description" — source is inferred from context
ImplicitRelationship:
    (
        ARROW |
        ('--' archetype=[ArchetypeDefinition:Identifier] ARROW)
    )
    (target=[RelationshipMember:QualifiedName] | targetThis?=THIS_KW)
    Meta?
    (
        '{'
            (
                NL+ tagsProps+=TagProperty
                | NL+ urlProps+=UrlProperty
                | NL+ properties+=PropertiesBlock
                | NL+ perspectivesBlocks+=PerspectivesBlock
                | NL+ scripts+=ScriptDirective
                | NL+ includes+=Include
            )*
        NL+ '}'
    )?;

// ═════════════════════════════════════════════════════════════════════════════
// MODEL ELEMENTS
// ═════════════════════════════════════════════════════════════════════════════

// ─── PersonMeta fragment ───────────────────────────────────────────────────
// Parses description, optional tags (quoted or unquoted) for Person elements
fragment PersonMeta:
    (description=STRING QuotedTag)
    |
    (description=STRING UnquotedTag)
    |    
    (description=STRING);

// Person: person <name> [description] [tags] { ... }
Person:
    Id? PERSON_KW Name PersonMeta?
    (
        '{'
            (
                NL+ ModelElementFeatures
                | NL+ EverywhereFeatures
                | NL+ ElementPropertyFeatures
                | NL+ relationships+=(Relationship | ImplicitRelationship)
            )*
        NL+ '}'
    )?;

// SoftwareSystem: softwaresystem <name> [description] [technology] [tags] { ... }
SoftwareSystem:
    Id? SOFTWARE_SYSTEM_KW Name Meta?
    (
        '{'
            (
                NL+ ModelElementFeatures
                | NL+ EverywhereFeatures
                | NL+ ElementPropertyFeatures
                | NL+ archetypeInstances+=ArchetypeInstance
                | NL+ elementExtensions+=ElementExtension
                | NL+ elements+=Container
                | NL+ groups+=Group
                | NL+ relationshipExtensions+=RelationshipExtension
                | NL+ relationships+=(Relationship | ImplicitRelationship)
            )*
        NL+ '}'
    )?;

// Container: container <name> [description] [technology] [tags] { ... }
Container:
    Id? CONTAINER_KW Name Meta?
    (
        '{'
            (
                NL+ ModelElementFeatures
                | NL+ EverywhereFeatures
                | NL+ ElementPropertyFeatures
                | NL+ archetypeInstances+=ArchetypeInstance
                | NL+ components+=ComponentsDirective
                | NL+ elementExtensions+=ElementExtension
                | NL+ elements+=Component
                | NL+ groups+=Group
                | NL+ relationships+=(Relationship | ImplicitRelationship)
                | NL+ techProps+=TechnologyProperty
            )*
        NL+ '}'
    )?;

// Component: component <name> [description] [technology] [tags] { ... }
Component:
    Id? COMPONENT_KW Name Meta?
    (
        '{'
            (
                NL+ ModelElementFeatures
                | NL+ EverywhereFeatures
                | NL+ ElementPropertyFeatures
                | NL+ groupProps+=GroupProperty
                | NL+ relationships+=(Relationship | ImplicitRelationship)
                | NL+ techProps+=TechnologyProperty
            )*
        NL+ '}'
    )?;

// CustomElement: element <name> [description] [technology] [tags] { ... }
CustomElement:
    Id? ELEMENT_KW Name Meta?
    (
        '{'
            (
                NL+ ModelElementFeatures
                | NL+ EverywhereFeatures
                | NL+ ElementPropertyFeatures
                | NL+ relationships+=ImplicitRelationship
            )*
        NL+ '}'
    )?;

// ═════════════════════════════════════════════════════════════════════════════
// DEPLOYMENT ELEMENTS
// ═════════════════════════════════════════════════════════════════════════════

// DeploymentEnvironment: deploymentEnvironment <name> { deploymentNode ..., group ..., etc. }
DeploymentEnvironment:
    Id? DEPLOYMENT_ENV_KW Name
    (
        '{'
            (
                NL+ ModelElementFeatures
                | NL+ EverywhereFeatures
                | NL+ deploymentGroups+=DeploymentGroup
                | NL+ groups+=Group
                | NL+ nodes+=DeploymentNode
                | NL+ noRelationships+=NoRelationship
                | NL+ relationships+=(Relationship | ImplicitRelationship)
            )*
        NL+ '}'
    )?;

InstancesProperty:
    INSTANCES_KW value=(INSTANCE_RANGE | INT);

// DeploymentGroup: deploymentGroup <name>
DeploymentGroup:
    Id? DEPLOYMENT_GROUP_KW Name;

// ─── DeploymentNodeMeta fragment ───────────────────────────────────────────
// Parses description, technology, tags (quoted/unquoted), and instances count
fragment DeploymentNodeMeta:
    (
        (description=STRING technology=STRING QuotedTag instances=INT)
        |
        (description=STRING technology=STRING UnquotedTag instances=INT)
        |
        (description=STRING technology=STRING QuotedTag)
        |
        (description=STRING technology=STRING UnquotedTag)
        |
        (description=STRING technology=STRING)
        |
        (description=STRING UnquotedTag instances=INT)
        |
        (description=STRING UnquotedTag)
        |
        (description=STRING)
        |
        (instances=INT)
    )?;

// DeploymentNode: deploymentNode <name> [description] [technology] [tags] [instances] { ... }
DeploymentNode:
    Id? DEPLOYMENT_NODE_KW Name DeploymentNodeMeta
    (
        '{'
            (
                NL+ ModelElementFeatures
                | NL+ EverywhereFeatures
                | NL+ ElementPropertyFeatures
                | NL+ children+=DeploymentNode
                | NL+ containerInstances+=ContainerInstance
                | NL+ deploymentGroupProps+=DeploymentGroupProp
                | NL+ genericInstances+=GenericInstance
                | NL+ groups+=Group
                | NL+ infrastructureNodes+=InfrastructureNode
                | NL+ instancesProps+=InstancesProperty
                | NL+ noRelationships+=NoRelationship
                | NL+ relationships+=(Relationship | ImplicitRelationship)
                | NL+ softwareSystemInstances+=SoftwareSystemInstance
                | NL+ techProps+=TechnologyProperty
            )*
        NL+ '}'
    )?;

// deploymentGroup <name> — reference to a deployment group on a deployment node
DeploymentGroupProp:
    DEPLOYMENT_GROUP_KW (deploymentGroups+=[DeploymentGroup:Identifier])+;

// ─── ID, Tag, Name fragments ───────────────────────────────────────────────

fragment Id:
    id=ElementAssignment;

// Quoted tag: "tag1" "tag2" (quoted strings)
fragment QuotedTag:
    tags+=STRING;

// Unquoted tag: tag1 tag2 (unquoted strings or integers)
fragment UnquotedTag:
    tags+=(UNQUOTED_STRING | INT);

// Element name: quoted or unquoted string, or integer
fragment Name:
    name=(STRING | UNQUOTED_STRING | INT);

// Meta fragment: description [technology] [quoted|unquoted tags]
// Shared by SoftwareSystem, Container, Component, CustomElement, InfrastructureNode
fragment Meta:
    (description=STRING technology=STRING QuotedTag)
    | (description=STRING technology=STRING UnquotedTag)
    | (description=STRING technology=STRING)
    | (description=STRING UnquotedTag)
    | (description=STRING);

// InfrastructureNode: infrastructureNode <name> [description] [technology] [tags] { ... }
InfrastructureNode:
    Id? INFRASTRUCTURE_NODE_KW Name Meta?
    (
        '{'
            (
                NL+ ModelElementFeatures
                | NL+ EverywhereFeatures
                | NL+ ElementPropertyFeatures
                | NL+ relationships+=(Relationship | ImplicitRelationship)
                | NL+ techProps+=TechnologyProperty
            )*
        NL+ '}'
    )?;

// ─── DeploymentGroups fragment ─────────────────────────────────────────────
// Reference to one or more DeploymentGroup instances by identifier
fragment DeploymentGroups:
    deploymentGroups+=[DeploymentGroup:Identifier];

// Single ambiguous value after instance reference — resolved post-parse
fragment DeploymentGroupOrTag:
    value=(STRING | UNQUOTED_STRING | INT);

// SoftwareSystemInstance: softwareSystemInstance <softwareSystem> [groups/tag] { ... }
SoftwareSystemInstance:
    Id?
    (SOFTWARE_SYSTEM_INSTANCE_KW)
    softwareSystem=[SoftwareSystem:QualifiedName]
    (
        // 2+ comma-separated deployment groups (requires at least one comma)
        (DeploymentGroups (',' DeploymentGroups)+ (tags+=STRING | tags+=UNQUOTED_STRING | tags+=INT)?)
        |
        // Single deployment group followed by one or more space-separated tags
        (DeploymentGroups (tags+=STRING | tags+=UNQUOTED_STRING | tags+=INT)+)
        |
        // Single ambiguous value: resolved post-parse (deployment group or tag)
        DeploymentGroupOrTag
    )?
    (
        '{'
            (
                NL+ ModelElementFeatures
                | NL+ EverywhereFeatures
                | NL+ ElementPropertyFeatures
                | NL+ healthChecks+=HealthCheck
                | NL+ relationships+=(Relationship | ImplicitRelationship)
            )*
        NL+ '}'
    )?;

// ContainerInstance: containerInstance <container> [groups/tag] { ... }
ContainerInstance:
    Id?
    (CONTAINER_INSTANCE_KW)
    container=[Container:Identifier]
    (
        // 2+ comma-separated deployment groups (requires at least one comma)
        (DeploymentGroups (',' DeploymentGroups)+ (tags+=STRING | tags+=UNQUOTED_STRING | tags+=INT)?)
        |
        // Single deployment group followed by one or more space-separated tags
        (DeploymentGroups (tags+=STRING | tags+=UNQUOTED_STRING | tags+=INT)+)
        |
        // Single ambiguous value: resolved post-parse (deployment group or tag)
        DeploymentGroupOrTag
    )?
    (
        '{'
            (
                NL+ ModelElementFeatures
                | NL+ EverywhereFeatures
                | NL+ ElementPropertyFeatures
                | NL+ healthChecks+=HealthCheck
                | NL+ relationships+=(Relationship | ImplicitRelationship)
            )*
        NL+ '}'
    )?;

// GenericInstance: instanceof <element> [groups/tag] { ... }
GenericInstance:
    Id?
    INSTANCEOF_KW
    element=[NamedElement:Identifier]
    (
        // 2+ comma-separated deployment groups (requires at least one comma)
        (DeploymentGroups (',' DeploymentGroups)+ (tags+=STRING | tags+=UNQUOTED_STRING | tags+=INT)?)
        |
        // Single deployment group followed by one or more space-separated tags
        (DeploymentGroups (tags+=STRING | tags+=UNQUOTED_STRING | tags+=INT)+)
        |
        // Single ambiguous value: resolved post-parse (deployment group or tag)
        DeploymentGroupOrTag
    )?
    (
        '{'
            (
                NL+ ModelElementFeatures
                | NL+ EverywhereFeatures
                | NL+ ElementPropertyFeatures
                | NL+ healthChecks+=HealthCheck
                | NL+ relationships+=(Relationship | ImplicitRelationship)
            )*
        NL+ '}'
    )?;

// ═════════════════════════════════════════════════════════════════════════════
// HEALTH CHECK
// ═════════════════════════════════════════════════════════════════════════════

// healthCheck <name> <url> [interval] [timeout]
HealthCheck:
    HEALTHCHECK_KW Name url=STRING (interval=INT)? (timeout=INT)?;

// ═════════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═════════════════════════════════════════════════════════════════════════════

// !constant name = value, !const name = value, !var name = value
Constant:
    (_CONSTANT_KW | _CONST_KW | _VAR_KW) name=(STRING | ComplexIdentifier) value=ConstantValue;

ConstantValue returns string:
    STRING | ComplexIdentifier | INT | TEXT_BLOCK;

// ═════════════════════════════════════════════════════════════════════════════
// LEXER RULES (tokenizers)
// ═════════════════════════════════════════════════════════════════════════════

// ─── Assignment and special tokens ─────────────────────────────────────────

ElementAssignment returns string:
    ASSIGNMENT;

terminal THIS_KW: /this\b/i;

// Assignment token: alphanumeric identifier followed by =
terminal ASSIGNMENT: /[a-zA-Z0-9_\u00A0-\uFFFF]([a-zA-Z0-9_\u00A0-\uFFFF\/:]|-(?![>\/]))*\s*=(?!=)/;

terminal INCLUDE_KW: /include\b/i;
terminal EXCLUDE_KW: /exclude\b/i;

// Relationship source identifier (lookahead for ->, -/>, or --...-> patterns)
terminal RELATIONSHIP_SOURCE: /[a-zA-Z0-9_\u00A0-\uFFFF]([\w\u00A0-\uFFFF.\/:]|-(?![>\/]))*(?=\s*(->|-\/>|--[a-zA-Z0-9_\u00A0-\uFFFF.]+(->|-\/>)))/;

// ─── Suffix tokens ─────────────────────────────────────────────────────────

terminal SLASH_SUFFIX: /\/(?!\/)[\w\u00A0-\uFFFF.\/\\:\-()]*/;
terminal DOT_SUFFIX: /\.[\w\u00A0-\uFFFF.\/:]*(?!\s*=(?!=))/;

// ─── Arrow tokens ──────────────────────────────────────────────────────────

terminal ARROW: '->';
terminal NO_ARROW: '-/>';

// Hyphen suffix: -<text> (but not ->, -/>, or --)
terminal HYPHEN_SUFFIX: /-(?![->\/])([\w\u00A0-\uFFFF.\/\\:()]|-(?![>\/]))*/;

// Path token: a single unquoted file path or URL that contains at least one
// of the path-only characters (& + % ~ # ?). Requiring one of these makes the
// token lexically DISJOINT from every keyword/identifier/expression token
// (none of which contain & + % ~ # ?), so it can never shadow `workspace`,
// `person`, `element.tag==`, etc. on a lexer length tie-break. Paths without
// any such character still parse via ComplexIdentifier/STRING. Character
// validity beyond these separators is enforced in the TypeScript validator.
terminal PATH_TOKEN: /[a-zA-Z0-9_\u00A0-\uFFFF][\w\u00A0-\uFFFF.\/\\:@%&+~$?=()\[\]#-]*[&+%~#?][\w\u00A0-\uFFFF.\/\\:@%&+~$?=()\[\]#-]*/;

// ─── Identifier rules ──────────────────────────────────────────────────────

// Identifier: quoted or unquoted reference
Identifier returns string:
    UNQUOTED_STRING | STRING | 
    RELATIONSHIP_SOURCE |
    ASSIGNMENT |          
    (SOFTWARE_SYSTEM_KW DOT_SUFFIX?) |
    (CONTAINER_KW DOT_SUFFIX?) |
    (COMPONENT_KW) |
    (PERSON_KW) | 
    (DEPLOYMENT_NODE_KW DOT_SUFFIX?) |
    (INFRASTRUCTURE_NODE_KW DOT_SUFFIX?) |
    (DEPLOYMENT_ENV_KW DOT_SUFFIX?) |
    (ELEMENT_KW) |
    (GROUP_KW) |
    (NAME_KW) |
    (CUSTOM_KW) |
    (IMAGE_KW) |
    (KROKI_KW) |
    (DEPLOYMENT_GROUP_KW DOT_SUFFIX?) |
    INCLUDE_KW |
    EXCLUDE_KW;

// ComplexIdentifier: supports dot, slash, and hyphen suffixes for hierarchical paths
ComplexIdentifier returns string:
    ( (IdentifierStart | INT) (DOT_SUFFIX | SLASH_SUFFIX | HYPHEN_SUFFIX)* ) 
    | (DOT_SUFFIX | SLASH_SUFFIX | HYPHEN_SUFFIX)+;

IdentifierStart returns string:
    UNQUOTED_STRING | IdentifierKeyword;

// Keywords that can start an identifier (reserved words that double as valid names)
IdentifierKeyword returns string:
    DEPLOYMENT_ENV_KW
    | SOFTWARE_SYSTEM_KW
    | CONTAINER_KW
    | PERSON_KW
    | AUTOLAYOUT_KW
    | INFRASTRUCTURE_NODE_KW
    | DEPLOYMENT_NODE_KW
    | SYSTEM_LANDSCAPE_KW
    | CUSTOM_KW
    | SYSTEM_CONTEXT_KW
    | COMPONENTS_KW
    | COMPONENT_KW
    | GROUP_KW
    | THIS_KW
    | DEPLOYMENT_GROUP_KW
    | ANIMATION_KW
    | STYLES_KW
    | ELEMENT_KW
    | RELATIONSHIP_KW
    | SHAPE_KW
    | BACKGROUND_KW
    | THEME_KW
    | THEMES_KW
    | DESCRIPTION_KW
    | NAME_KW
    | SOFTWARE_SYSTEM_INSTANCE_KW
    | CONTAINER_INSTANCE_KW
    | INSTANCEOF_KW
    | PLANTUML_KW
    | MERMAID_KW
    | KROKI_KW
    | IMAGE_KW
    | INCLUDE_KW
    | EXCLUDE_KW
    | TECHNOLOGY_KW
    | URL_KW
    | TAG_KW
    | TAGS_KW
    | STROKE_KW
    | METADATA_KW
    | STROKE_WIDTH_KW
    | FONTSIZE_KW
    | FILTERED_KW
    | ICON_KW
    | DASHED_KW
    | COLOR_KW
    | COLOUR_KW
    | JUMP_KW
    | STYLE_KW
    | LIGHT_KW
    | DARK_KW
    | POSITION_KW
    | ROUTING_KW
    | WIDTH_KW
    | HEIGHT_KW
    | INSTANCES_KW
    | PROPERTIES_KW
    | DYNAMIC_KW
    | DEPLOYMENT_KW
    | MODEL_KW
    | VIEWS_KW
    | TERMINOLOGY_KW
    | SCOPE_KW
    | VISIBILITY_KW
    | USERS_KW
    | CONFIGURATION_KW
    | PERSPECTIVE_KW
    | PERSPECTIVES_KW
    | TRUE_KW
    | FALSE_KW
    | LANDSCAPE_KW
    | NONE_KW
    | DEFAULT_KW
    | THICKNESS_KW
    | HIERARCHICAL_KW
    | FLAT_KW
    | READ_KW
    | WRITE_KW
    | SOLID_KW
    | DOTTED_KW
    | DIRECT_KW
    | ORTHOGONAL_KW
    | CURVED_KW
    | PRIVATE_KW
    | PUBLIC_KW
    | VALUE_KW
    | TITLE_KW
    | WORKSPACE_KW
    | EXTENDS_KW
    | ARCHETYPES_KW
    | HEALTHCHECK_KW;

// AnyKeyword: matches any keyword token — used to accept reserved words as values
AnyKeyword returns string:
    IdentifierKeyword 
    | _CONSTANT_KW
    | _CONST_KW
    | _VAR_KW
    | _ELEMENTS_KW
    | _ELEMENT_KW
    | _INCLUDE_KW
    | _ADRS_KW
    | _DECISIONS_KW
    | _RELATIONSHIP_KW
    | _SCRIPT_KW
    | _DOCS_KW
    | _IDENTIFIERS_KW
    | _IMPLIED_RELATIONSHIP_KW
    | _PLUGIN_KW;

// Path: a complex identifier or quoted string (used for file paths, URLs, etc.)
Path returns string:
    PATH_TOKEN | ComplexIdentifier | STRING;

// QualifiedName: an identifier optionally with dot-separated hierarchy
QualifiedName returns string:
    Identifier;

// ─── Directive keywords (start with !) ─────────────────────────────────────

terminal _CONSTANT_KW: /!constant\b/;
terminal _CONST_KW: /!const\b/;
terminal _VAR_KW: /!var\b/;
terminal _ELEMENTS_KW: /!elements\b/i;
terminal _ELEMENT_KW: /!element\b/i;
terminal _INCLUDE_KW: /!include\b/i;
terminal _ADRS_KW: /!adrs\b/i;
terminal _DECISIONS_KW: /!decisions\b/i;
terminal _RELATIONSHIPS_KW: /!relationships\b/i;
terminal _RELATIONSHIP_KW: /!relationship\b/i;
terminal _SCRIPT_KW: /!script\b/i;
terminal _DOCS_KW: /!docs\b/i;
terminal _IDENTIFIERS_KW: /!identifiers\b/i;
terminal _IMPLIED_RELATIONSHIP_KW: /!impliedrelationships\b/i;
terminal _PLUGIN_KW: /!plugin\b/i;

// ─── Primary keywords ──────────────────────────────────────────────────────

terminal DEPLOYMENT_ENV_KW: /deploymentenvironment\b/i;
terminal SOFTWARE_SYSTEM_KW: /softwaresystem\b/i;
terminal CONTAINER_KW: /container\b/i;
terminal PERSON_KW: /person\b/i;
terminal AUTOLAYOUT_KW: /autolayout\b/i;
terminal INFRASTRUCTURE_NODE_KW: /infrastructureNode\b/i;
terminal DEPLOYMENT_NODE_KW: /deploymentNode\b/i;
terminal SYSTEM_LANDSCAPE_KW: /systemlandscape\b/i;
terminal CUSTOM_KW: /custom\b/i;
terminal SYSTEM_CONTEXT_KW: /systemcontext\b/i;
terminal COMPONENTS_KW: /!components\b/i;
terminal COMPONENT_KW: /component\b/i;
terminal GROUP_KW: /group\b/i;
terminal DEPLOYMENT_GROUP_KW: /deploymentgroup\b/i;
terminal ANIMATION_KW: /animation\b/i;
terminal STYLES_KW: /styles\b/i;

// ─── Expression keywords ───────────────────────────────────────────────────

terminal ELEMENT_TAG_KW: /element.tag\b/i;
terminal ELEMENT_TYPE_KW: /element.type\b/i;
terminal ELEMENT_PARENT_KW: /element.parent\b/i;
terminal ELEMENT_TECHNOLOGY_KW: /element.technology\b/i;
terminal ELEMENT_PROPERTIES_KW: /element.properties\b/i;
terminal ELEMENT_GROUP_KW: /element.group\b/i;
terminal ELEMENT_KW: /element\b/i;

terminal RELATIONSHIP_SOURCE_KW: /relationship.source\b/i;
terminal RELATIONSHIP_DESTINATION_KW: /relationship.destination\b/i;
terminal RELATIONSHIP_PROPERTIES_KW: /relationship.properties\b/i;
terminal RELATIONSHIP_TAG_KW: /relationship.tag\b/i;
terminal RELATIONSHIP_KW: /relationship\b/i;

// ─── Property keywords ─────────────────────────────────────────────────────

terminal SHAPE_KW: /shape\b/i;
terminal BACKGROUND_KW: /background\b/i;
terminal THEME_KW: /theme\b/i;
terminal THEMES_KW: /themes\b/i;
terminal DESCRIPTION_KW: /description\b/i;
terminal NAME_KW: /name\b/i;
terminal SOFTWARE_SYSTEM_INSTANCE_KW: /softwaresysteminstance\b/i;
terminal CONTAINER_INSTANCE_KW: /containerInstance\b/i;
terminal INSTANCEOF_KW: /instanceof\b/i;
terminal PLANTUML_KW: /plantuml\b/i;
terminal MERMAID_KW: /mermaid\b/i;
terminal KROKI_KW: /kroki\b/i;
terminal IMAGE_KW: /image\b/i;
terminal TECHNOLOGY_KW: /technology\b/i;
terminal URL_KW: /url\b/i;
terminal TAG_KW: /tag\b/i;
terminal TAGS_KW: /tags\b/i;
terminal STROKE_KW: /stroke\b/i;
terminal STROKE_WIDTH_KW: /strokewidth\b/i;
terminal METADATA_KW: /metadata\b/i;
terminal FONTSIZE_KW: /fontsize\b/i;
terminal FILTERED_KW: /filtered\b/i;
terminal ICON_KW: /icon\b/i;
terminal DASHED_KW: /dashed\b/i;
terminal COLOR_KW: /color\b/i;
terminal COLOUR_KW: /colour\b/i;
terminal JUMP_KW: /jump\b/i;
terminal STYLE_KW: /style\b/i;
terminal LIGHT_KW: /light\b/i;
terminal DARK_KW: /dark\b/i;
terminal POSITION_KW: /position\b/i;
terminal ROUTING_KW: /routing\b/i;
terminal WIDTH_KW: /width\b/i;
terminal HEIGHT_KW: /height\b/i;
terminal OPACITY_KW: /opacity\b/i;
terminal INSTANCES_KW: /instances\b/i;
terminal PROPERTIES_KW: /properties\b/i;
terminal DYNAMIC_KW: /dynamic\b/i;
terminal DEPLOYMENT_KW: /deployment\b/i;
terminal MODEL_KW: /model\b/i;
terminal VIEWS_KW: /views\b/i;
terminal TERMINOLOGY_KW: /terminology\b/i;
terminal SCOPE_KW: /scope\b/i;
terminal VISIBILITY_KW: /visibility\b/i;
terminal USERS_KW: /users\b/i;
terminal CONFIGURATION_KW: /configuration\b/i;
terminal PERSPECTIVE_KW: /perspective\b/i;
terminal PERSPECTIVES_KW: /perspectives\b/i;
terminal TRUE_KW: /true\b/i;
terminal FALSE_KW: /false\b/i;
terminal LANDSCAPE_KW: /landscape\b/i;
terminal NONE_KW: /none\b/i;
terminal DEFAULT_KW: /default\b/i;
terminal THICKNESS_KW: /thickness\b/i;
terminal HIERARCHICAL_KW: /hierarchical\b/i;
terminal FLAT_KW: /flat\b/i;
terminal READ_KW: /read\b/i;
terminal WRITE_KW: /write\b/i;
terminal SOLID_KW: /solid\b/i;
terminal DOTTED_KW: /dotted\b/i;
terminal DIRECT_KW: /direct\b/i;
terminal ORTHOGONAL_KW: /orthogonal\b/i;
terminal CURVED_KW: /curved\b/i;
terminal PRIVATE_KW: /private\b/i;
terminal PUBLIC_KW: /public\b/i;
terminal VALUE_KW: /value\b/i;
terminal TITLE_KW: /title\b/i;
terminal WORKSPACE_KW: /workspace\b/i;
terminal EXTENDS_KW: /extends\b/i;
terminal ARCHETYPES_KW: /archetypes\b/i;
terminal HEALTHCHECK_KW: /healthcheck\b/i;

// ─── Range token for instances ─────────────────────────────────────────────

terminal INSTANCE_RANGE: /[0-9]+\.\.([0-9]+|N|\*)?/;

// ─── Base tokens ───────────────────────────────────────────────────────────

terminal INT returns string: /[0-9]+/;

terminal UNQUOTED_STRING: /[a-zA-Z0-9_\u00A0-\uFFFF]([\w\u00A0-\uFFFF.\/:]|-(?![>\/]))*/;

hidden terminal WS: /[ \t]+/;

hidden terminal LINE_CONTINUATION: /\\[ \t]*[\r\n][\s\t\r\n]*/;

terminal TEXT_BLOCK: /"""[\s\S]*?"""/;

terminal STRING: /"(\\([\r\n]|\r\n|.)|[^"\\])*"|'(\\([\r\n]|\r\n|.)|[^'\\])*'/;

terminal NL: /[\r\n]+[\s\t\r\n]*/;

hidden terminal ML_COMMENT: /\/\*[\s\S]*?\*\//;
hidden terminal SL_COMMENT: /\/\/[^\n\r]*/;

terminal COLOR_HEX: /#[a-fA-F0-9]{3}([a-fA-F0-9]{3})?/;

hidden terminal HASH_COMMENT: /#[^\n\r]*/;
