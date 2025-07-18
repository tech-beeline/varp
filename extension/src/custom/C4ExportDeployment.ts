import {
  workspace,
  commands,
  window,
  ProgressLocation,
  ViewColumn
} from "vscode";

import { writeFile, mkdirSync, existsSync } from 'fs';
import { join, basename } from 'path';
import { HttpClient } from 'typed-rest-client/HttpClient';
import { IHeaders, IRequestOptions } from "typed-rest-client/Interfaces";
import { BEELINE_API_URL, NOTLS } from "../config";

const CONF_VEGA_TOKEN = "c4.vega.token";

class ErrorMsg {
   error_msg: string; 
}

class Detail {
  detail: string;
}

export function c4ExportDeployment() {

    commands.registerCommand("c4.export.deployment", async (...args: string[]) => {

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

      const beelineApiUrl = workspace.getConfiguration().get(BEELINE_API_URL) as string;
      const path = '/api-gateway/terraform/v1/generate?environment='
      const encodedWorkspaceJson = args[0];
      const name = args[1];
      progress.report({ message: "Распаковка модели данных..." });
      const content = Buffer.from(encodedWorkspaceJson, 'base64').toString('utf8');
      const headers: IHeaders = <IHeaders>{};
      headers['Content-Type'] = 'text/plain';
      headers['X-Token'] = vegaToken;

      const p = new Promise<void>(resolve => {
        progress.report({ message: "Отправка запроса..." });
        httpc.post(beelineApiUrl + path + name, content, headers).then((result) => { return result.readBody() }).then((body) => {
          const paths = workspace.workspaceFolders;
          if (paths !== undefined && paths.length > 0) {
            progress.report({ message: "Запись в файл..." });
            const dirname = 'terraform';
            const dirpath = join(paths[0].uri.fsPath, dirname);
            if (!existsSync(dirpath)) {
              mkdirSync(dirpath);
            }
            const bname = basename('main.tf');
            const filepath = join(dirpath, bname);

            try {
              const detial = JSON.parse(body) as Detail;
              try {
                const errors = JSON.parse(detial.detail) as ErrorMsg[];
                errors.forEach(e => {
                  writeFile(filepath, e.error_msg, function (error) { });
                });
              } catch (e) {
                writeFile(filepath, detial.detail, function (error) { });
              }
            } catch (e) {
              writeFile(filepath, body, function (error) { });
            }
            workspace.openTextDocument(filepath).then((doc) => { window.showTextDocument(doc, ViewColumn.Beside); });
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