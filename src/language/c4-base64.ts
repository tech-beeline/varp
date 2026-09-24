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

/**
 * Base64 helpers that do not rely on Node's Buffer, so they work both in the
 * language server (desktop and web worker) and in the extension host.
 */

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Base64 of a byte array. */
export function base64EncodeBytes(bytes: Uint8Array): string {
	let result = '';
	for (let i = 0; i < bytes.length; i += 3) {
		const b0 = bytes[i];
		const b1 = i + 1 < bytes.length ? bytes[i + 1] : undefined;
		const b2 = i + 2 < bytes.length ? bytes[i + 2] : undefined;
		result += BASE64_ALPHABET[b0 >> 2];
		result += BASE64_ALPHABET[((b0 & 0x03) << 4) | ((b1 ?? 0) >> 4)];
		result += b1 === undefined ? '=' : BASE64_ALPHABET[((b1 & 0x0f) << 2) | ((b2 ?? 0) >> 6)];
		result += b2 === undefined ? '=' : BASE64_ALPHABET[b2 & 0x3f];
	}
	return result;
}

/** Decodes base64 into a byte array, ignoring whitespace. */
export function base64DecodeToBytes(encoded: string): Uint8Array {
	const clean = encoded.replace(/[\r\n\s]/g, '');
	const bytes = new Uint8Array(Math.floor((clean.length * 3) / 4));
	let byteIndex = 0;
	let buffer = 0;
	let bits = 0;

	for (const character of clean) {
		if (character === '=') break;
		const value = BASE64_ALPHABET.indexOf(character);
		if (value < 0) continue;
		buffer = (buffer << 6) | value;
		bits += 6;
		if (bits >= 8) {
			bits -= 8;
			bytes[byteIndex++] = (buffer >> bits) & 0xff;
		}
	}

	return bytes.subarray(0, byteIndex);
}
