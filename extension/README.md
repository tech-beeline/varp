# C4 DSL Model Extension for Visual Studio Code

## Overview

This Visual Studio Code extension enables software architecture modeling using the [Structurizr DSL](https://github.com/structurizr/dsl). The Structurizr DSL implements the "diagram as text" approach ([learn more](https://structurizr.com/help/text)) and provides a textual representation of the [C4 model](https://c4model.com/).

The extension includes:
- A language server built on the official Structurizr DSL parser
- Advanced capabilities for architectural description automation
- Diagram visualization
- DSL conversion to other formats

## Prerequisites

- **Java 17+** ([download](https://java.com/en/download/)) - required for the language server
- Workspace containing model files with `.dsl` extension
- Support for multiple workspaces and `!include` files

## Features

### Syntax Highlighting

Field values like `name` and `technology` are highlighted when the diagram contains no errors.

### Diagram Preview

Error-free diagrams can be previewed by clicking the diagram icon next to the corresponding view.

![Diagram Preview](images/preview.png)

### Code Snippets

The Explorer provides quick access to frequently used code blocks for faster architecture modeling.

![Architecture as Code](images/plugin_aac.gif)

## ArchOps Server Integration Features

### API Specification Parsing

Create components matching API descriptions with method specification imports from:
- Swagger
- WSDL
- Protocol Buffers

![SLA Integration](images/plugin_sla.gif)

### Tech Radar Integration

Load technology lists from your company's tech radar when specifying container or interaction technologies.

![Technology Integration](images/plugin_tech.gif)

### Capability Tooltips and Completions

Create capability-aware components with descriptions loaded from your company's capabilities map.

![Capability Integration](images/plugin_capability.gif)

### Terraform Integration

Generate Terraform scripts for environments with a single click.

![Terraform Integration](images/terraform.gif)

## Configuration

| Option | Values | Default | Description |
|--------|--------|---------|-------------|
| `c4.diagram.structurizr.autolayout.url` | URL | `https://structurizr.com` | Diagram rendering server (Cloud or On-Premises) |
| `c4.editor.autoformat.indent` | Number | `4` | Spaces per indentation level |
| `c4.languageserver.logs.enabled` | `true`/`false` | `false` | Enable language server logging to `c4-language-server.log` |
| `c4.decorations.enabled` | `off`, `onChange`, `onSave` | `onChange` | Text decoration timing |
| `c4.SSL\TLS.disabled` | `true`/`false` | `false` | Disable SSL/TLS verification |
| `c4.beeline.api.url` | URL | | ArchOPS server URL |
| `c4.beeline.api.key` | String | | ArchOPS API key |
| `c4.beeline.api.secret` | String | | ArchOPS API secret |
| `c4.beeline.cloud.token` | String | | Beeline Cloud security token |
| `c4.beeline.cloud.url` | URL | `https://cloud.beeline.ru` | Beeline Cloud API URL |
| `c4.beeline.glossaries` | Comma-separated list | `Product,Service,Customer` | Data dictionaries for model integration |