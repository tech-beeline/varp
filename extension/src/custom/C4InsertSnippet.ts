import {
  commands,
} from "vscode";

export function c4InsertSnippet() {
  commands.registerCommand("c4.insert.snippet", async ( ...args: any[]) => {
    commands.executeCommand('c4-server.send-snippet-telemetry', args[0]);
    commands.executeCommand('editor.action.insertSnippet', args[0] );
  });
}