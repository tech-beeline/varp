# A VS Code extension for C4 DSL Models

## Description

This is a VS Code extension for specifying software architecture models with the [Structurizr DSL](https://github.com/structurizr/dsl).

Structurizr DSL, an example of the [diagram as text](https://structurizr.com/help/text) trend, is the textual representation of the [C4 model](https://c4model.com/).

Technically there is language server built on top of the origin [Structurizr DSL](https://github.com/structurizr/dsl) parser.

In addition to the functionality of the language server, the plugin provides extensive capabilities for automating the creation of architectural descriptions, as well as displaying diagrams and converting DSL into other formats.

## Pre-requisites

A [Java VM](http://java.com/en/download/) is required for running the language server. Java 21 or higher is required.

You must open a workspace that contains your models, which need to have the file extension `.dsl`

Multiple workspaces and !include files are supported.

## Syntax highlight

If there are no errors in the diagram, the values ​​of fields such as **name** or **technology** are highlighted.

## Diagram Preview

If there are no errors in the diagram, then the diagram display is available. To activate it, you need to click on the diagram preview next to the corresponding view.

## Code snippets

To speed up the creation of architectural descriptions, the Explorer provides a menu with frequently used code blocks.

## Features available when integrating with the ArchOps server

### API specification parsing

It is possible to create components that will correspond to the API description. For them, it is possible to import method specifications from Swagger/WSDL/protobuf

### Integration with tech-radar

When filling technologies in containers or interactions, it is possible to load a list of technologies from the company's techn-radar.

### Capability tooltips and completions

It is possible to create components that indicate the capabilities of containers. There is an integration that allows loading descriptions of capabilities from the company's capabilities map.

### Terraform integration

You can automatically create a terraform script for each environment by clicking on the link next to the environment name.

## Configuration Options

| Option | Values | Default | Description |
|--------|--------|---------|-------------|
| c4.diagram.structurizr.autolayout.url | | https://structurizr.com | URL of server for diagram rendering (Cloud Structurizr or OnPremises) |
| c4.editor.autoformat.indent | | 4 | The number of spaces per indentation, when calling format document |
| c4.languageserver.logs.enabled | true\false | false | If enabled language server logs are written to the current workspace folder (c4-language-server.log). |
| c4.decorations.enabled | <ul><li>off</li><li>onChange</li><li>onSave</li></ul> | onChange | Text decorations can take place when editing (onChange) or when file is saved (onSave). It can also be switched off. |
| c4.SSL\TLS.disabled | true\false | false | Disable SSL\\TLS verification (if needed) |
| c4.beeline.api.url | | | URL to ArchOPS server  |
| c4.beeline.api.key | | | Workspace API Key for ArchOPS server Access |
| c4.beeline.api.secret | | | Workspace API Secret for ArchOPS server Access |
| c4.beeline.cloud.token | | | Security token for Beeline Cloud Access |
| c4.beeline.cloud.url | | https://cloud.beeline.ru | Cloud API URL  |
| c4.beeline.glossaries | | Product,Service,Customer | Data dictionaries available for loading into the model. Can be used in model props to create data flow diagrams based on the model. |