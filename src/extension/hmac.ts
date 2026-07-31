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
import { workspace } from 'vscode';

export function generateHmac(method: string, path: string, body: string | undefined = undefined, contentType: string | undefined = undefined) {
    const archopsApiSecret = workspace.getConfiguration().get<string>('archops.api.secret');
    const archopsApiKey = workspace.getConfiguration().get<string>('archops.api.key');
    if(!archopsApiKey || !archopsApiSecret) return undefined;
    const nonce = randomBytes(8).toString('base64');
    const md5Hash = (body === undefined) ? 'd41d8cd98f00b204e9800998ecf8427e' : createHash('md5').update(body).digest('hex');
    const parts: string[] = [method, path, md5Hash, contentType ?? '', nonce];
    const message: string = parts.join('\n') + '\n';
    const hmac = createHmac('sha256', archopsApiSecret).update(message).digest('base64');
    return {
        'X-Authorization': archopsApiKey + ':' + hmac,
        'Nonce': nonce
    };
}