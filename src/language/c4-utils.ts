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

export class StringUtils {

    /**
     * Simple and fast string hashing to a 32-bit hex string.
     * Uses the FNV-1a hash algorithm variant.
     * Works in any JS environment (Node, Browser, Worker).
     * Used for generating stable element/view IDs from CST offsets.
     * 
     * @param str The input string to hash
     * @returns 32-bit unsigned integer as lowercase hex string (e.g., "a1b2c3d4")
     */
    static stringHash(str: string): string {
        let hash = 0x811c9dc5;
        for (let i = 0; i < str.length; i++) {
            hash ^= str.charCodeAt(i);
            hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
        }
        // Return as unsigned hex
        return (hash >>> 0).toString(16);
    }
    
    /**
     * Generates a compact hash from multiple string parts joined by '|'.
     * Uses a Bernstein-style hash (djb2 variant) transformed to 32-bit integer.
     * Used for generating stable IDs for relationships from source/target element IDs and offsets.
     * 
     * @param parts String parts to hash (typically element type, source ID, target ID, offset)
     * @returns Compact positive hex string (e.g., "1a2b3c")
     */
    static generateHash(...parts: string[]): string {
        const input = parts.join('|');
        let hash = 0;
        for (let i = 0; i < input.length; i++) {
            const char = input.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash |= 0; // Convert to 32-bit integer
        }
        return Math.abs(hash).toString(16);
    }

    /**
     * Removes surrounding quotes (single, double, or triple-double) and trims whitespace.
     * Handles: `"value"`, `'value'`, `"""value"""`, and partial trimming.
     * Returns empty string for undefined/null input.
     * 
     * @param value The raw DSL string value, possibly with quotes
     * @returns Cleaned string without surrounding quotes
     */
    static stripQuotes(value: string | undefined): string {
        return value?.trim().replace(/^("""|'|")([\s\S]*?)\1$/, '$2').trim() ?? '';
    }
}
