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
  workspace,
  commands,
  window,
  ProgressLocation,
  ViewColumn
} from "vscode";

import { writeFile, mkdirSync, existsSync } from 'fs';
import { dirname, join, basename } from 'path';
import { HttpClient } from 'typed-rest-client/HttpClient';
import { IRequestOptions } from 'typed-rest-client/Interfaces';
import { BEELINE_API_URL, NOTLS } from '../config';
import { generateHmac } from './hmac';
import { CodeLensCommandArgs } from '../types/CodeLensCommandArgs';
import { C4Utils } from '../utils';
import { EOL } from 'os';

const CONF_VEGA_TOKEN = "c4.vega.token";

class ErrorMsg {
   error_msg: string; 
}

class Detail {
  detail: string;
}

export function c4ExportDeployment() {

    commands.registerCommand("c4.export.deployment", async (args : CodeLensCommandArgs) => {

    const vegaToken = workspace.getConfiguration().get(CONF_VEGA_TOKEN) as string;

    const options: IRequestOptions = <IRequestOptions>{};
    options.ignoreSslError = workspace.getConfiguration().get(NOTLS) as boolean;
    const httpc = new HttpClient('vscode-c4-dsl-plugin', [], options);

    window.withProgress({
      location: ProgressLocation.Notification,
      title: "Создаю terraform скрипт",
      cancellable: false
    }, (progress, token) => {

      token.onCancellationRequested(() => { console.log("User canceled the long running operation"); });

      const beelineApiUrl = C4Utils.removeTrailingSlash(workspace.getConfiguration().get(BEELINE_API_URL) as string);
      const path = '/structurizr-backend/api/v1/workspace/terraform/generate';
      const name = '?environment=' + args.deploymentEnvironment;
      progress.report({ message: "Распаковка модели данных..." });
      const content = Buffer.from(args.encodedWorkspace, 'base64').toString('utf8');
      const contentType = 'text/plain';
      const headers = generateHmac('POST', path, content, contentType);
      headers['Content-Type'] = contentType;
      headers['X-Token'] = vegaToken;

      const p = new Promise<void>(resolve => {
        progress.report({ message: "Отправка запроса..." });
        httpc.post(beelineApiUrl + path + name, content, headers).then((result) => { return result.readBody() }).then((body) => {
          const editor = window.activeTextEditor;
          const document = editor?.document;
          const fileName = document?.fileName;
          const paths = workspace.workspaceFolders;
          if(fileName !== undefined && paths !== undefined && paths.length > 0) {
            let directoryPath = dirname(fileName);
            for (const path of paths) {
              if(directoryPath.startsWith(path.uri.fsPath)) {
                directoryPath = path.uri.fsPath;
                break;
              }
            }
            const dirpath = join(directoryPath, 'terraform');
            if (!existsSync(dirpath)) {
              mkdirSync(dirpath);
            }
            const bname = basename('main.tf');
            const filepath = join(dirpath, bname);                      
            try {
              const detial = JSON.parse(body) as Detail;
              try {
                const errors = JSON.parse(detial.detail) as ErrorMsg[];
                const message = errors.map(obj => obj.error_msg).join(EOL) + EOL;                
                window.showErrorMessage(message);
              } catch (e) {
                window.showErrorMessage(detial.detail);
              }
            } catch (e) {
              writeFile(filepath, body, function (error) {
                if (error) {
                  window.showErrorMessage(error.message);
                } else {
                  workspace.openTextDocument(filepath).then((doc) => window.showTextDocument(doc, ViewColumn.Beside));
                }
              });
            }
          }
        }).catch((error) => {
          window.showErrorMessage(error.message);
        }).finally(() => {
          resolve();
          commands.executeCommand('c4-server.send-deployment-telemetry');
        });
      });
      return p;
    });
  });

}