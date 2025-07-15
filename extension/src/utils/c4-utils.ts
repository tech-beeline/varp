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
