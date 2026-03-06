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

class C4Utils {
  static getJavaVersion(versionDetails: string): number {
    const matchedRegex = new RegExp(/version\s"\d\d/i).exec(versionDetails)?.at(0);
    return (matchedRegex) ? Number.parseInt(
        matchedRegex.slice('version "'.length, matchedRegex.length)
      ) : 0;
  }

  static removeTrailingSlash(str: string): string {
    return str.replace(/\/+$/, '');
  }  

}

export { C4Utils };
