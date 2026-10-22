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

import { describe, it, expect, vi } from 'vitest';
import { createHash, createHmac } from 'node:crypto';
import { gunzipSync } from 'fflate';

const credentials = vi.hoisted(() => ({ configured: true }));

vi.mock('vscode', () => ({
    env: { uiKind: 1 },
    extensions: { getExtension: () => ({ packageJSON: { version: '9.9.9' } }) },
    UIKind: { Web: 1, Desktop: 2 },
    workspace: {
        getConfiguration: () => ({
            get: (key: string) => credentials.configured ? (key === 'archops.api.key' ? 'the-key' : 'the-secret') : undefined,
        }),
    },
}));

const { generateHmac, gzipBody } = await import('./hmac');

const BODY = JSON.stringify({ workspace: 'demo', results: [{ rule: 'no-cycles', passed: true }] });
const CONTENT_TYPE = 'application/json';

/** Recomputes the signature the server is expected to verify. */
function expectedAuthorization(headers: Record<string, string>, method: string, path: string, body: string, contentType: string, gzip: boolean): string {
    const digest = createHash('md5').update(gzip ? gzipBody(body) : body).digest('hex');
    const message = [method, path, digest, contentType, headers['Nonce']].join('\n') + '\n';
    return 'the-key:' + createHmac('sha256', 'the-secret').update(message).digest('base64');
}

describe('generateHmac', () => {
    it('signs the plain body without a content encoding', () => {
        const headers = generateHmac('POST', '/api/results', BODY, CONTENT_TYPE);
        expect(headers['Content-Encoding']).toBeUndefined();
        expect(headers['X-Authorization']).toBe(expectedAuthorization(headers, 'POST', '/api/results', BODY, CONTENT_TYPE, false));
    }, 30000);

    it('signs the compressed body and announces gzip', () => {
        const headers = generateHmac('POST', '/api/results', BODY, CONTENT_TYPE, true);
        expect(headers['Content-Encoding']).toBe('gzip');
        expect(headers['X-Authorization']).toBe(expectedAuthorization(headers, 'POST', '/api/results', BODY, CONTENT_TYPE, true));
    }, 30000);

    it('signs a compressed body differently from the same plain body', () => {
        const plain = generateHmac('POST', '/api/results', BODY, CONTENT_TYPE);
        const compressed = generateHmac('POST', '/api/results', BODY, CONTENT_TYPE, true);
        const plainDigest = plain['X-Authorization']!.split(':')[1];
        const compressedDigest = compressed['X-Authorization']!.split(':')[1];
        expect(compressedDigest).not.toBe(plainDigest);
    }, 30000);

    it('announces gzip even without configured credentials', () => {
        credentials.configured = false;
        try {
            const headers = generateHmac('GET', '/api/results', undefined, undefined, true);
            expect(headers['Content-Encoding']).toBe('gzip');
            expect(headers['X-Authorization']).toBeUndefined();
        } finally {
            credentials.configured = true;
        }
    }, 30000);

    it('compresses a body into stable bytes that decompress back', () => {
        const first = gzipBody(BODY);
        const second = gzipBody(BODY);
        expect(Buffer.from(first)).toEqual(Buffer.from(second));
        expect(new TextDecoder().decode(gunzipSync(first))).toBe(BODY);
    }, 30000);
});
