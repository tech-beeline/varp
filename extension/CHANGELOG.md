# Change Log

## 1.0.9 - 1.0.10

- Export styles and properties to drawio
- Fixed a paper size calculation during layout import from drawio

## 1.0.8

- Fixed a bug exporting large-sized diagrams to the drawio format
- Fixed a bug exporting diagrams with groups but without groupSeparator to the drawio format
- Escapes the characters while exporting to drawio format
- Write logs directly to the extension output instead of the file
- Button at status bar for creating\writing workspace.json file
- Fixed a bug when a reference to an element in an extended workspace could not be found from an include file while definition calculation
- Fixed a bug when elements which have hierarchical identifiers could not be found while definition calculation
- Some settings renaming
  
## 1.0.7

- Fixed an error exporting dynamic diagrams to the drawio format
- Added rendering of systemLandscape diagrams
- Implemented import of diagram layout from drawio files (only if the given drawio file was obtained by exporting this diagram before)
- After diagram layout importing, a workspace.json file is automatically created

## 1.0.6

- Fix drawio export error

## 1.0.4

- Bump lang server to Structurizr v4.1.0
- Bump Java dependencies
- Bump NodeJS dependencies
- Remove some unneeded jars from extension package
- Remove unneeded .ts file
- Option to disable ArchOps telemetry collection
- Use current workspace folder for terraform script generation
- Show Architecture views on left side only when C4 workspace opened
- Urls can be specified with or without slash at end
- Fixed a bug where the generated terraform script would not open in a new tab
- Added a parameter that allows you to specify the path to the JDK or JRE for executing c4 language server
- Fixed a bug where "c4-server.configuration" command not registered right after run c4 language server
- Updated links to Java downloading 

## 1.0.0

- Initial commit
