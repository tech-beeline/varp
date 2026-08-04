<div align="center">

# C4 Architecture As A Code

**VS Code extension for C4/Structurizr architecture modeling** — write, validate, and render
architecture diagrams directly from code. Powered by [Langium](https://langium.org/).

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![VS Code Marketplace](https://img.shields.io/badge/VS%20Code%20Marketplace-2.0.1-0078D4.svg)](https://marketplace.visualstudio.com/items?itemName=vimpelcom.c4-varp)
[![Open VSX](https://img.shields.io/open-vsx/v/vimpelcom/c4-varp.svg?label=Open%20VSX)](https://open-vsx.org/extension/vimpelcom/c4-varp)
[![Node.js LTS](https://img.shields.io/badge/Node.js-%3E%3D%2020-339933.svg)](package.json)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.5-3178C6.svg)](package.json)

</div>

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Screenshots](#screenshots)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Commands](#commands)
- [Configuration](#configuration)
- [Architecture Center Integration](#architecture-center-integration)
- [Development](#development)
- [Project Structure](#project-structure)
- [How It Works](#how-it-works)
- [Contributing](#contributing)
- [License](#license)

---

## Overview

C4 Architecture As A Code brings the [C4 model](https://c4model.com/) and the
[Structurizr DSL](https://docs.structurizr.com/dsl/cookbook/) into your VS Code
workflow. Describe your software architecture as text, get instant validation,
intellisense-style hints, and a **live diagram preview** — no separate tooling required.

It runs on the **desktop** (VS Code) and in the **browser** (`vscode.dev`).

## Features

### 📐 Full Structurizr DSL support

- Complete C4 model: `Person`, `SoftwareSystem`, `Container`, `Component`
- Deployment model: `deploymentEnvironment`, `deploymentNode`, `infrastructureNode`, instances
- Relationships (explicit `->`, implicit, implied)
- Deployment groups with relationship scoping
- Archetypes, groups, health checks, perspectives

### 🔍 Intelligent Language Server (Langium-based)

- **Syntax highlighting** with a generated TextMate grammar
- **Semantic tokens** (macros, classes, properties)
- **Validation** — uniqueness checks, reference resolution, style validation with
  human-readable error messages
- **Inlay hints** — inline `name:`, `description:`, `technology:` labels
- **Document links** — `Ctrl+Click` on `!include` paths and `extendsUri` to navigate
- **Scope provider** — hierarchical identifiers and cross-file references

### 🖼️ Diagram Preview

- Render any view as an interactive Structurizr diagram
- **Auto-refresh** on file save
- Export to **SVG** and **DrawIO** (`.drawio`)
- One-click preview via CodeLens: *"Show As Structurizr Diagram"*

### 🧩 Views & Filtering

- All view types: System Landscape, System Context, Container, Component, Deployment, Dynamic, Filtered, Custom
- Rich include/exclude expressions (`element.tag==`, `element.type==`, `relationship==`, afferent/efferent coupling, star expressions)
- `!elements` and `!relationships` directives for per-view element injection
- Automatic layouts, animations, theming, terminology

### 🔗 Modularity

- `!include` of other files (relative paths, directories, remote URLs)
- `extendsUri` workspace inheritance
- `${CONST}` constant substitution across files

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

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `archops.api.url` | *(internal)* | ArchOps automation server URL |
| `archops.api.key` | *(internal)* | Workspace API key |
| `archops.api.secret` | *(internal)* | Workspace API secret |

## Architecture Center Integration

The extension ships with optional sidebar views that integrate with an internal
**Architecture Center** API:

- **C4 DSL Snippets** — ready-to-use DSL snippets
- **Patterns Catalogue** — browse and insert architecture patterns as C4 DSL
- **Capabilities Catalogue** — browse business/technical capabilities

These views require the `archops.api.*` configuration settings to be reachable.

## Development

### Prerequisites

- [Node.js](https://nodejs.org/) ≥ 20 (LTS recommended)
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

## Project Structure

```
src/
├── generated/            # Langium-generated AST, module, and grammar artifacts
├── language/             # Language server (Langium) implementation
│   ├── c4.langium        # C4 DSL grammar definition
│   ├── c4-json-generator.ts     # Structurizr-compatible JSON generator
│   ├── c4-json-generator-handler.ts  # JSON build lifecycle & caching
│   ├── c4-validator.ts   # Validation checks
│   ├── c4-scope-provider.ts    # Reference scoping & includes
│   ├── c4-document-builder.ts  # Auto-loading of !include files
│   ├── c4-inlay-hints.ts / c4-code-lens.ts / c4-document-link.ts  # LSP features
│   ├── c4-tokens.ts / c4-module.ts / c4-utils.ts
│   └── main.ts / main.browser.ts  # Language server entry points
├── extension/            # VS Code extension host
│   ├── init.ts           # Extension activation & command registration
│   ├── diagram-preview.ts  # Structurizr diagram webview
│   ├── c4-snippets.ts / patterns.ts / capabilities.ts  # Sidebar views
│   └── hmac.ts / config.ts
css/                      # Structurizr rendering styles
js/                       # Structurizr rendering engine (JointJS, Dagre, etc.)
test/fixtures/            # DSL → expected JSON golden tests
```

## How It Works

The extension is split into two cooperating processes: a **language server** (built on
[Langium](https://langium.org/)) and the **extension host** that provides the VS Code UI.

### Language Server pipeline

1. **Parsing** — When you open or edit a `.dsl` file, the language server parses it
   with the Chevrotain-based LL(k) parser generated from [`c4.langium`](src/language/c4.langium).
   `!include` directives and `extendsUri` inheritance are resolved automatically, and
   `${CONST}` placeholders are substituted.

2. **Validation & reference resolution** — The `C4Validator` checks uniqueness of element
   identifiers, resolves cross-file references (via `C4ScopeProvider`), and validates
   style properties and relationship syntax. Errors and warnings are reported inline.

3. **JSON generation** — The `C4JsonGenerator` walks the validated AST and produces
   **Structurizr-compatible workspace JSON**, including the model, all views, styles,
   deployment elements, and relationship scoping. `!elements` / `!relationships`
   directives are applied as overlays during this phase.

4. **Caching** — The `C4GeneratorHandler` hooks into the document build lifecycle and
   stores the generated JSON per workspace document, keeping it in sync with edits.

### Rendering in VS Code

5. **Diagram preview** — A CodeLens button ("Show As Structurizr Diagram") appears above
   each view block. Clicking it sends the cached JSON to the extension host, which opens
   a **Structurizr webview** (JointJS + Dagre rendering engine) to display the diagram.

6. **Auto-refresh** — On every save, the extension requests fresh JSON via the custom
   `custom/getContentForUri` LSP request and re-renders the open preview automatically.

7. **Export** — The webview can export the current diagram to **SVG** or **DrawIO**
   (`.drawio`) via the editor title menu.

### Sidebar views

Independent of the diagram pipeline, the sidebar provides optional **Architecture Center**
integrations — C4 DSL snippets, a patterns catalogue, and a capabilities catalogue — each
loading data from the configured `archops.api.*` endpoint (see
[Architecture Center Integration](#architecture-center-integration)).

## Contributing

Contributions are welcome!

## License

[Apache License 2.0](LICENSE) © VimpelCom PJSC
