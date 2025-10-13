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
  commands,
  window,
  ProgressLocation,
  Position,
  workspace
} from "vscode";

import * as fs from 'fs';
import * as httpm from 'typed-rest-client/HttpClient';
import { IRequestOptions } from "typed-rest-client/Interfaces";
import { BEELINE_API_URL, NOTLS } from "../config";
import { generateHmac } from "./hmac";
import { CodeLensCommandArgs } from "../types/CodeLensCommandArgs";

export function c4InsertSla() {
  commands.registerCommand("c4.insert.sla", async (args : CodeLensCommandArgs) => {
    const options: IRequestOptions = <IRequestOptions>{};
    options.ignoreSslError = workspace.getConfiguration().get(NOTLS) as boolean;
    const httpc = new httpm.HttpClient('vscode-c4-dsl-plugin', [], options);

    window.withProgress({
      location: ProgressLocation.Notification,
      title: "Генерация SLA",
      cancellable: false
    }, (progress, token) => {

      return new Promise<void>(resolve => {
        const insertSla = (content: string) => {

          const beelineApiUrl = workspace.getConfiguration().get(BEELINE_API_URL) as string;
          const path = '/structurizr-backend/api/v1/integration/sla'
          const contentType = 'text/plain';
          const headers = generateHmac('POST', path, content, contentType);
          headers['Content-Type'] = contentType;
          progress.report({ message: "Формирование SLA..." });
          httpc.post(beelineApiUrl + path, content, headers)
            .then((result) => { return result.readBody() }).then((body) => {
              var lines = body.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0).map((line) => " ".repeat(args.padding) + line);
              const editor = window.activeTextEditor;
              if (editor) {
                editor.edit(editBuilder => {
                  if(lines.length === 1) {
                    const json = lines.at(0);
                    if(json !== undefined) {
                      try {
                        let obj = JSON.parse(json);
                        if (obj.message !== undefined) {
                          window.showErrorMessage(obj.message);
                        }
                      } catch (e) {
                        window.showErrorMessage(body);
                      }
                      return;
                    }
                  }
                  var os = require('os');
                  editBuilder.insert(new Position(args.lastLine, 0), lines.join(os.EOL) + os.EOL);
                });
              }
            })
            .catch((error) => {
              window.showErrorMessage(error.message);
            })
        };

        progress.report({ message: "Запрос описания API..." });
        if(args.apiUrl.startsWith("http://") || args.apiUrl.startsWith("https://")) {
          httpc.get(args.apiUrl).then((result) => { return result.readBody() }).then((body) => {
            insertSla(body);
          }).catch((error) => {
            window.showErrorMessage(error.message);
          }).finally(() => {
            resolve();
          });
        } else {
          fs.readFile(args.apiUrl, 'utf8', (error, data) => {
            if (error) {
              window.showErrorMessage(error.message);
            } else {
              insertSla(data);
            }
            resolve();
          });
        }
      });
    });
  });
}