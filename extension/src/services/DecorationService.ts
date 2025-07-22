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
