<div align="center">

# C4 Architecture As A Code

**VS Code extension for C4/Structurizr architecture modeling** — write, validate, and render
architecture diagrams directly from code. Powered by [Langium](https://langium.org/).

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![VS Code Marketplace](https://img.shields.io/badge/VS%20Code%20Marketplace-2.0.6-0078D4.svg)](https://marketplace.visualstudio.com/items?itemName=vimpelcom.c4-varp)
[![Open VSX](https://img.shields.io/open-vsx/v/vimpelcom/c4-varp.svg?label=Open%20VSX)](https://open-vsx.org/extension/vimpelcom/c4-varp)
[![Node.js 24.18.0](https://img.shields.io/badge/Node.js-24.18.0-339933.svg)](package.json)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.5-3178C6.svg)](package.json)
[![Langium 4.4.0](https://img.shields.io/badge/Langium-4.4.0-26888C.svg)](package.json)

</div>

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Model Context Protocol](#model-context-protocol)
- [Development](#development)
- [Contributing](#contributing)
- [License](#license)

---

## Overview

C4 Architecture As A Code brings the [C4 model](https://c4model.com/) and the
[Structurizr DSL](https://docs.structurizr.com/dsl/cookbook/) into your VS Code
workflow. Describe your software architecture as text, get instant validation,
intellisense-style hints, and a **live diagram preview** — no separate tooling required.

It is a port of the reference Structurizr DSL to the **Langium**/**TypeScript**
stack, and runs on the **desktop** (VS Code) and in the **browser** (`vscode.dev`).

## Features

### 📐 Structurizr DSL support

The language server is a port of the reference Structurizr DSL to the
**Langium**/**TypeScript** stack. It implements the same DSL surface — the C4 and
deployment models, view definitions, and the directives that shape them — and emits
Structurizr-compatible workspace JSON. The intent is behavioural parity: a workspace
written for Structurizr parses, validates and renders here the same way, unchanged.

### 🔍 Intelligent Language Server (Langium-based)

- **Syntax highlighting** with a generated TextMate grammar
- **Semantic tokens** (macros, classes, properties)
- **Inlay hints** — inline `name:`, `description:`, `technology:` labels
- **Document links** — `Ctrl+Click` on `!include` paths and `extendsUri` to navigate
- **Scope provider** — hierarchical identifiers and cross-file references
- **CodeLens** — actions above each view and above the workspace

### 🤖 MCP server

- Optional built-in **Model Context Protocol** server (`varp.mcp.autoStart`) that
  exposes the resolved model to AI assistants over streamable HTTP on `127.0.0.1`
  (see [Model Context Protocol](#model-context-protocol))

### 🖼️ Diagram Preview

- Render any view as an interactive Structurizr diagram
- **Auto-refresh** on every change or on save (`varp.diagram.autoRefresh`)
- Remote Structurizr **themes**, with a webview fallback when the server cannot
  fetch them
- Export the current diagram to **SVG** or **DrawIO** (`.drawio`)
- Import a layout from a `.drawio` file back into the view
- Export the full **Structurizr workspace JSON** (`.json`)
- One-click preview via CodeLens: *"Show As Structurizr Diagram"*

### 🧩 Views & Filtering

- All view types: System Landscape, System Context, Container, Component, Deployment, Dynamic, Filtered, Custom
- Rich include/exclude expressions (`element.tag==`, `element.type==`, `relationship==`, afferent/efferent coupling, star expressions)
- `!elements` and `!relationships` directives for per-view element injection
- Automatic layouts, theming, terminology

### 🌐 Desktop and web

- Runs on desktop VS Code and in the browser (`vscode.dev`)

## Installation

### From VS Code Marketplace (recommended)

1. Open VS Code
2. Go to the **Extensions** view (`Ctrl+Shift+X`)
3. Search for **"C4 Architecture As A Code"**
4. Click **Install**

### From VSIX

1. Build the extension (see [Development](#development)) or download a release `.vsix`
2. In VS Code, open the Extensions view (`Ctrl+Shift+X`)
3. Click the **⋮** menu → **Install from VSIX...**
4. Select the `.vsix` file

### Pre-Release Channel

To test the latest unreleased build, use the **Switch to Pre-Release** option in the
extension details page (Marketplace installs only).

## Quick Start

Create a `.dsl` file and start writing your architecture:

```c4
workspace {
    model {
        user = person "User"
        system = softwareSystem "Software System" {
            web = container "Web Application"
            db  = container "Database"
            web -> db "Reads/Writes"
        }
        user -> system "Uses"
    }

    views {
        systemContext system {
            include *
            autolayout
        }
    }
}
```

Click **"Show As Structurizr Diagram"** above the `systemContext` block to render the diagram.

## Model Context Protocol

With `varp.mcp.autoStart` enabled, the extension starts a built-in **MCP server**
(streamable HTTP on `127.0.0.1`) that exposes the resolved C4 model, and the language
servers' answers for the open files, to AI assistants. It is available in the desktop
build only.

### Connecting clients

The server speaks **streamable HTTP** and is bound to the loopback interface, so a
client only needs the URL. Enable it in VS Code first (desktop build only, with the
workspace open):

```jsonc
// VS Code settings.json
{
  "varp.mcp.autoStart": true
}
```

The endpoint is `http://127.0.0.1:47474/mcp`; the port is fixed. Restart the client
(or reload its MCP servers) after enabling the setting — the tools, prompts and
resources above then appear under the `c4-varp` name.

#### opencode

Add the server to `opencode.json` in the project, or to the global
`~/.config/opencode/opencode.json` ([docs](https://opencode.ai/docs/mcp-servers/)):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "c4-varp": {
      "type": "remote",
      "url": "http://127.0.0.1:47474/mcp",
      "enabled": true
    }
  }
}
```

#### Hermes

Hermes Agent reads MCP servers from `~/.hermes/config.yaml` under `mcp_servers`;
a remote server only needs its URL ([docs](https://hermes-agent.nousresearch.com/docs/user-guide/features/mcp)):

```yaml
mcp_servers:
  c4-varp:
    url: "http://127.0.0.1:47474/mcp"
```

Hermes prefixes the server's tools as `mcp_<server>_<tool>`, with dashes in the server
name replaced by underscores (`mcp_c4_varp_list_projects`); run `/reload-mcp` in a
running session after editing the file, and `hermes mcp test c4-varp` to check the
connection.

### Tools

| Tool | Description |
|------|-------------|
| `list-projects` | List all root workspace documents (projects) that currently have a resolved C4 model. |
| `list-views` | Catalog of all views in a project: key, type, title, description, element/relationship counts and a `byType` breakdown; optionally filtered by type. |
| `read-project-summary` | Summary of a project: element counts by type, total relationships, and available views. |
| `search-element` | Search elements in a project by id, name, type or tags. |
| `read-element` | Full details of an element: attributes, outgoing relationships, and the views that include it. |
| `read-view` | Details of a single view: metadata, elements and relationships (with names resolved). |
| `read-deployment` | Deployment tree: deployment nodes, infrastructure nodes and deployed instances (with instance counts). |
| `query-graph` | Neighbourhood of an element: ancestors, descendants, siblings, children, parent and/or direct incoming/outgoing relationships. |
| `query-incomers-graph` | Recursive graph of elements that (directly or transitively) depend on the given element, up to a depth/node cap. |
| `query-outgoers-graph` | Recursive graph of elements the given element (directly or transitively) depends on, up to a depth/node cap. |
| `find-relationships` | Find model relationships by optional source, destination and/or tag. |
| `find-relationship-paths` | Find paths (sequences of relationships) between two elements via BFS; with `includeIndirect=false` only a direct relationship is returned. |
| `query-by-tags` | Query elements by tags: `allOf` (must have every tag), `anyOf` (at least one), `noneOf` (must have none). |
| `query-by-tag-pattern` | Query elements whose any tag matches a pattern by prefix, contains or suffix. |
| `query-by-metadata` | Query elements by a property (key/value): only key matches presence, key+value matches the value by the operator. |
| `read-model-json` | Raw Structurizr model JSON (`json.model`): people, software systems, deployment nodes with their relationships. |
| `read-view-json` | Raw Structurizr view JSON for a view key: elements with computed positions/sizes, relationships and dimensions. |
| `read-raw-workspace-json` | Complete resolved Structurizr workspace JSON: model, views, configuration, styles/themes, documentation and more. |
| `batch-read-elements` | Read full details of multiple elements in one call; not-found ids are reported in `missing`. |
| `element-diff` | Side-by-side comparison of two elements: attributes, properties, tags and relationships. |
| `subgraph-summary` | Compact summary of all descendants of an element: per-element metadata, tags, relationship counts and a breakdown by type. |
| `get-diagnostics` | Errors, warnings, information and hints from the language servers, optionally for one file. |
| `find-references` | All references to the symbol at a position, as reported by the language server. |
| `go-to-definition` | Definition location(s) of the symbol at a position. |
| `get-hover` | Hover information (type, documentation) for the symbol at a position. |
| `get-document-symbols` | Symbols declared in a document, with their nesting. |
| `search-workspace-symbols` | Search symbols across the workspace through the language servers. |

The last six query whichever language server VS Code has for the file, so they answer
for C4 DSL files through this extension's Langium server and for other languages
through theirs.

### Prompts

| Prompt | Description |
|--------|-------------|
| `summarize-project` | Instruct the model to summarize a C4 project: its elements, relationships and views. |
| `explore-element` | Instruct the model to deep-dive into one element: its details, relationships and views. |

### Resources

| Resource | Description |
|----------|-------------|
| `projects` | List of all C4 projects (root workspace document URIs). |
| `project` | Flattened C4 model (elements, relationships, views) of a project. |

## Development

### Prerequisites

- [Node.js](https://nodejs.org/) 24.18.0
- npm

### Setup

```bash
# 1. Install dependencies
npm install

# 2. Build (generate grammar, compile, bundle, run tests)
npm run build

# 3. Launch the Extension Development Host
#    In VS Code: press F5 (or use the provided launch configuration)
```

### Useful Commands

| Command | Description |
|---------|-------------|
| `npm run build` | Full local build: grammar + typescript + bundle + tests |
| `npm run build:ci` | CI build: grammar + typescript + bundle + tests + package `.vsix` |
| `npm test` | Run the test suite (Vitest) |
| `npm run package` | Create a `.vsix` installable package |

### Grammar

The DSL grammar lives in [`src/language/c4.langium`](src/language/c4.langium).
After editing the grammar, regenerate the Langium artifacts:

```bash
npx langium generate
```

## Contributing

Contributions are welcome!

## License

[Apache License 2.0](LICENSE) © VimpelCom PJSC
