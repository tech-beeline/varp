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
 * Classifies the characters of a DSL document: 1 for grammar code, 0 for a comment,
 * a quoted string or a script body. Offsets match the original text, so callers can
 * use the result to look for braces and quotes without being misled by their
 * occurrence inside a value.
 */
export function codePositions(text: string): Uint8Array {
    const code = new Uint8Array(text.length).fill(1);
    const hide = (from: number, to: number) => code.fill(0, from, Math.min(to, text.length));
    let index = 0;
    while (index < text.length) {
        const char = text[index];
        if (char === '"') {
            const close = text.startsWith('"""', index) ? '"""' : '"';
            let end = index + close.length;
            while (end < text.length) {
                if (text[end] === '\\') {
                    end += 2;
                } else if (text.startsWith(close, end)) {
                    end += close.length;
                    break;
                } else {
                    end++;
                }
            }
            hide(index, end);
            index = end;
        } else if (char === '/' && (text[index + 1] === '/' || text[index + 1] === '*')) {
            const end = text[index + 1] === '/'
                ? lineEnd(text, index)
                : closeBlockComment(text, index);
            hide(index, end);
            index = end;
        } else if (char === '#' && !isHexColour(text, index)) {
            const end = lineEnd(text, index);
            hide(index, end);
            index = end;
        } else {
            index++;
        }
    }
    return code;
}

/** Offset of the line break that ends the line containing `index`, or the text length. */
export function lineEnd(text: string, index: number): number {
    const end = text.indexOf('\n', index);
    return end < 0 ? text.length : end;
}

function closeBlockComment(text: string, index: number): number {
    const close = text.indexOf('*/', index + 2);
    return close < 0 ? text.length : close + 2;
}

/** Whether the `#` at the given position starts a colour value rather than a comment. */
function isHexColour(text: string, index: number): boolean {
    return /^#[a-fA-F0-9]{3}(?:[a-fA-F0-9]{3})?(?![a-fA-F0-9])/.test(text.slice(index, index + 8));
}
