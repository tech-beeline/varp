/*
    Copyright 2025 VimpelCom PJSC

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

import {
  ExtensionContext,
  workspace,
  commands,
  window,
  StatusBarAlignment,
  TextDocument
} from "vscode";

import * as path from "path";
import * as cp from "child_process"; 
import * as readline from "node:readline";

import {
  LanguageClientOptions,
  StateChangeEvent,
  State
} from "vscode-languageclient";
import { LanguageClient } from "vscode-languageclient/node";
import {
  ConfigurationOptions,
  TextDocumentChangeConfig,
} from "./types";
import { DecorationService, PreviewService } from "./services";
import { C4Utils } from "./utils";
import { PatternProvider } from "./custom/ArchitectureAsACodeView";
import { ArchitectureCatalogueProvider } from "./custom/ArchitectureCatalogueView";
import { c4InsertSnippet } from "./custom/C4InsertSnippet";
import { c4InsertSla } from "./custom/C4InsertSla";
import { c4ExportDeployment } from "./custom/C4ExportDeployment";
import * as config from "./config";
import { StructurizrPreviewService } from "./services/StructurizrPreviewService";
import { CodeLensCommandArgs } from "./types/CodeLensCommandArgs";

var proc: cp.ChildProcess;

export function activate(context: ExtensionContext) {

  cp.exec("java -version", (err, stdOut, stdErr) => {
    if (
      err?.message.includes("'java' is not recognized") ||
      err?.message.includes("'java' not found")
    ) {
      window.showErrorMessage(
        "Java is needed to run the Language server. Please install java"
      );
    } else if (C4Utils.getJavaVersion(stdErr) < 17) {
      window.showErrorMessage(
        "Java 17 or higher is needed to run the Language server. Please upgrade your java version"
      );
    } else {
      initExtension(context);
    }
  });

  new PatternProvider(context);
  let architectureCatalogueProvider : ArchitectureCatalogueProvider = new ArchitectureCatalogueProvider(context);
  architectureCatalogueProvider.refresh();

}

function initExtension(context: ExtensionContext) {

  const logger = window.createOutputChannel("C4 DSL Extension");

  const clientOptions: LanguageClientOptions = {
    documentSelector: [{ scheme: "file", language: "c4" }, { scheme: "file", language: "markdown" }],
    outputChannel: logger,
    synchronize: {
      fileEvents: [workspace.createFileSystemWatcher("**/*.dsl"), workspace.createFileSystemWatcher("**/*.md")],
    },
  };

  const languageClient = new LanguageClient(
    "c4LanguageClient",
    "C4 Language Server",
    C4Utils.getServerOptions(),
    clientOptions
  );

  const statusBarItem = window.createStatusBarItem(
    StatusBarAlignment.Right,
    100
  );
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);
  languageClient.onDidChangeState((e: StateChangeEvent) => {
    switch (e.newState) {
      case State.Starting:
        statusBarItem.text = "C4 DSL Language Server is starting up...";
        statusBarItem.color = "white";
        break;
      case State.Running:
        statusBarItem.text = "C4 DSL Language Server is ready";
        statusBarItem.color = "white";
        updateServerConfigurationIndent();
        updateServerConfiguration();
        initDecoractionService();
        break;
      case State.Stopped:
        statusBarItem.text = "C4 Language Server has stopped";
        statusBarItem.color = "red";
        break;
    }
  });

  const READY_ECHO = "READY_TO_CONNECT";
  const STRUCTURIZ_COM = "https://structurizr.com/json";

  statusBarItem.text = "C4 DSL Socket Server is starting up...";
  statusBarItem.color = "white";

  const jar = path.join('server','c4-server.jar');
  const jarPath = context.asAbsolutePath(jar);

  const args = ["-Dfile.encoding=UTF8", "-jar", jarPath, "-e=" + READY_ECHO];
  const opts = (workspace.workspaceFolders) ? { cwd: workspace.workspaceFolders[0].uri.fsPath, shell: true } : { shell: true };
  proc = cp.spawn("java", args, opts);

  if (proc.stdout) {
    const reader = readline.createInterface({ input: proc.stdout, terminal: false, });

    const startListener = (line: string) => {
      if (line.endsWith(READY_ECHO)) {
        languageClient.start();
        reader.removeListener("line", startListener);
      }
    };

    reader.on('line', startListener);

  } else {
    statusBarItem.text = "Connection to C4 DSL Socket Server could not be established";
    statusBarItem.color = "red";
  }

  const onpremisesPreviewService = new PreviewService(context);

  const structurizrPreviewService = new StructurizrPreviewService(STRUCTURIZ_COM);

  c4InsertSnippet();

  c4InsertSla();

  c4ExportDeployment();

  commands.registerCommand("c4.diagram.export.svg", async () => {
    onpremisesPreviewService.getSvg(context);
  });

  commands.registerCommand("c4.show.diagram", async (args : CodeLensCommandArgs) => {

    const render = workspace.getConfiguration().get(config.DIAGRAM_RENDER) as string;

    if(render === 'https://structurizr.com') {
      structurizrPreviewService.currentDiagram = args.diagramKey;
      structurizrPreviewService.currentDocument = window.activeTextEditor?.document as TextDocument;
      await structurizrPreviewService.updateWebView(args.encodedWorkspace);
    }
    else {
      onpremisesPreviewService.currentDiagramAsDot = args.diagramAsDot;
      onpremisesPreviewService.currentDiagram = args.diagramKey;
      onpremisesPreviewService.currentDocument = window.activeTextEditor?.document as TextDocument;
      await onpremisesPreviewService.updateWebView();
    }
  });

  workspace.onDidSaveTextDocument((document: TextDocument) => {
    const autolayoutUrl = workspace.getConfiguration().get(config.DIAGRAM_RENDER) as string;
    if (autolayoutUrl === 'https://structurizr.com') {
      structurizrPreviewService.triggerRefresh(document);
    } else {
      onpremisesPreviewService.triggerRefresh(document);
    }
  });

  workspace.onDidChangeConfiguration(event => {
    if (event.affectsConfiguration(config.AUTO_FORMAT_INDENT)) {
      updateServerConfigurationIndent()
    }
    updateServerConfiguration();
  });
}

function initDecoractionService() {
  // Defined here and not in the decoration service, as the decorations were being appended multiple times
  const decType = window.createTextEditorDecorationType({});  
  const textDecorations = workspace.getConfiguration().get(config.TEXT_DECORATIONS) as TextDocumentChangeConfig;  
  if (textDecorations !== "off") {
    const decorationService = new DecorationService(decType);

    if (textDecorations === "onSave") {
      workspace.onDidSaveTextDocument((savedDocument) => {
        decorationService.triggerDecorations(undefined, savedDocument);
      });
    } else if (textDecorations === "onChange") {
      workspace.onDidChangeTextDocument((changed) => {
        decorationService.triggerDecorations(undefined, changed.document);
      });
    }

    window.onDidChangeActiveTextEditor((editor) => {
      decorationService.triggerDecorations(editor, undefined);
    });

    decorationService.triggerDecorations(window.activeTextEditor, undefined);
  }
}

function updateServerConfigurationIndent() {
  const spaces = workspace.getConfiguration().get(config.AUTO_FORMAT_INDENT) as number
  commands.executeCommand("c4-server.autoformat.indent", { indent: spaces } )
}

export function updateServerConfiguration() {
  const configOptions: ConfigurationOptions = {
    beelineApiUrl : workspace.getConfiguration().get(config.BEELINE_API_URL) as string,
    beelineApiSecret : workspace.getConfiguration().get(config.BEELINE_API_SECRET) as string,
    beelineApiKey : workspace.getConfiguration().get(config.BEELINE_API_KEY) as string,    
    beelineCloudUrl : workspace.getConfiguration().get(config.BEELINE_CLOUD_URL) as string,
    beelineCloudToken : workspace.getConfiguration().get(config.BEELINE_CLOUD_TOKEN) as string,
    beelineGlossaries : workspace.getConfiguration().get(config.BEELINE_GLOSSARIES) as string,
    noTLS : workspace.getConfiguration().get(config.NOTLS) as boolean,
    serverLogsEnabled : workspace.getConfiguration().get(config.LOGS_ENABLED) as boolean
  };
  
  if(configOptions.noTLS) {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  } else {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "1";
  }
  commands.executeCommand("c4-server.configuration", configOptions);
}

export function deactivate() {
  if (proc) {
    proc.kill("SIGINT");
  }
}