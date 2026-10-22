/*
	Copyright 2026 VimpelCom PJSC

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

import { createHash, createHmac, randomBytes } from 'crypto';
import { gzipSync } from 'fflate';
import { env, extensions, UIKind, workspace } from 'vscode';

const EXTENSION_ID = 'vimpelcom.c4-varp';

/**
 * Identifier of this extension for the ArchOps server:
 * `varp-<web|desktop>-<extension version>`. The host kind and the version are
 * resolved at runtime.
 */
function agentHeader(): string {
    const host = env.uiKind === UIKind.Web ? 'web' : 'desktop';
    const version = extensions.getExtension(EXTENSION_ID)?.packageJSON?.version ?? 'unknown';
    return `varp-${host}-${version}`;
}

/**
 * Compresses a request body for `generateHmac` called with `gzip: true`. The gzip
 * header carries no timestamp, so a body always compresses to the same bytes and the
 * caller can send them as the request body as they are.
 */
export function gzipBody(body: string): Uint8Array {
    return gzipSync(new TextEncoder().encode(body), { level: 9, mtime: 0 });
}

/**
 * Builds the ArchOps authentication headers for a request. The signature covers the
 * MD5 of the body, so with `gzip` the digest is taken over the compressed bytes the
 * caller sends: pass the request body through `gzipBody` and add the returned
 * `Content-Encoding: gzip` header to the request.
 */
export function generateHmac(method: string, path: string, body: string | undefined = undefined, contentType: string | undefined = undefined, gzip = false): Record<string, string> {
    const headers: Record<string, string> = { 'X-Agent': agentHeader() };
    if (gzip) {
        headers['Content-Encoding'] = 'gzip';
    }
    const archopsApiSecret = workspace.getConfiguration().get<string>('archops.api.secret');
    const archopsApiKey = workspace.getConfiguration().get<string>('archops.api.key');
    if(!archopsApiKey || !archopsApiSecret) return headers;
    const nonce = randomBytes(8).toString('base64');
    const payload: string | Uint8Array | undefined = body === undefined ? undefined : (gzip ? gzipBody(body) : body);
    const md5Hash = (payload === undefined) ? 'd41d8cd98f00b204e9800998ecf8427e' : createHash('md5').update(payload).digest('hex');
    const parts: string[] = [method, path, md5Hash, contentType ?? '', nonce];
    const message: string = parts.join('\n') + '\n';
    const hmac = createHmac('sha256', archopsApiSecret).update(message).digest('base64');
    headers['X-Authorization'] = archopsApiKey + ':' + hmac;
    headers['Nonce'] = nonce;
    return headers;
}