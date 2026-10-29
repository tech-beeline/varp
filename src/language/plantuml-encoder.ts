import { deflateSync } from 'fflate';

/** PlantUML's URL-safe 6-bit alphabet. */
const PLANTUML_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_';

function encode64(bytes: Uint8Array): string {
    let encoded = '';
    for (let index = 0; index < bytes.length; index += 3) {
        const b1 = bytes[index];
        const b2 = bytes[index + 1] ?? 0;
        const b3 = bytes[index + 2] ?? 0;
        encoded += PLANTUML_ALPHABET[b1 >> 2];
        encoded += PLANTUML_ALPHABET[((b1 & 0x03) << 4) | (b2 >> 4)];
        encoded += PLANTUML_ALPHABET[((b2 & 0x0f) << 2) | (b3 >> 6)];
        encoded += PLANTUML_ALPHABET[b3 & 0x3f];
    }
    return encoded;
}

/**
 * Encodes a PlantUML diagram source the way PlantUML servers expect it in a URL:
 * raw DEFLATE at the best compression level, then the URL-safe 6-bit alphabet.
 *
 * @param source the PlantUML diagram definition
 * @returns the encoded URL fragment
 */
export function encodePlantUml(source: string): string {
    const input = new TextEncoder().encode(source);
    return encode64(deflateSync(input, { level: 9 }));
}
