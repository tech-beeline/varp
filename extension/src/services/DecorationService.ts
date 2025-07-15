import {
  DecorationOptions,
  TextDocument,
  TextEditor,
  TextEditorDecorationType,
  commands,
  window,
} from "vscode";
import { CommandResultTextDecorations, DecoratedRange } from "../types";

class DecorationService {
  private decorationType: TextEditorDecorationType;

  constructor(decorationType: TextEditorDecorationType) {
    this.decorationType = decorationType;
  }

  public triggerDecorations(
    editor: TextEditor | undefined,
    document: TextDocument | undefined
  ) {
    if (!editor) {
      editor = window.activeTextEditor;
    }
    if (!document) {
      document = editor?.document;
    }
    if (editor && document && document.languageId === "c4") {
      commands.executeCommand("c4-server.text-decorations", { uri: document.uri.path, }).then((callback) => {
        editor?.setDecorations(
          this.decorationType,
          this.getDecorationOptions(callback as CommandResultTextDecorations)
        );
      });
    }
  }

  private getDecorationOptions(
    fromLanguageServer: CommandResultTextDecorations
  ): DecorationOptions[] {
    return (
      fromLanguageServer.resultdata?.map((range) =>
        this.nameDecoration(range)
      ) ?? []
    );
  }

  private nameDecoration(decoRange: DecoratedRange): DecorationOptions {
    return {
      range: decoRange.range,
      renderOptions: {
        before: {
          color: "gray",
          fontStyle: "italic",
          contentText: decoRange.type,
        },
      },
    };
  }
}

export { DecorationService };
