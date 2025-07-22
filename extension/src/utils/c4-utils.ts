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

import * as net from "net";
import { ServerOptions, StreamInfo } from "vscode-languageclient/node";

class C4Utils {
  static getJavaVersion(versionDetails: string): number {
    const matchedRegex = versionDetails.match(/version\s"\d\d/i)?.at(0);
    if (matchedRegex) {
      const version = parseInt(
        matchedRegex.slice('version "'.length, matchedRegex.length)
      );
      return version;
    }
    return 0;
  }

  static getServerOptions(): ServerOptions {
    const serverDebugOptions = () => {
      let socket = net.connect({ port: 5008 });
      let result: StreamInfo = {
        writer: socket,
        reader: socket,
      };
      return Promise.resolve(result);
    };
    return serverDebugOptions;
  }
}

export { C4Utils };
