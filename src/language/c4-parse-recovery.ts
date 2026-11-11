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

import { CstUtils, type AstNode, type ParseResult } from 'langium';
import { codePositions, lineEnd } from './c4-source-text';

/** Guards against a document that keeps producing errors after every attempt. */
const MAX_PASSES = 20;

const recoveredResults = new WeakSet<ParseResult>();

/**
 * Whether the result comes from {@link recoverParseResult}. Its errors are one per
 * failed construct rather than the cascade a single failure produces, so they must
 * be reported as they are.
 */
export function isRecoveredParseResult(result: ParseResult): boolean {
    return recoveredResults.has(result);
}

/**
 * Parses the document and, when a construct is rejected, parses again with that
 * construct blanked out.
 *
 * The parser abandons the whole nesting when an entry it cannot place is the last
 * one in a block, so every later declaration is read as a top-level token and is
 * lost to the program: no diagnostics, no inline hints and no tree. Blanking the
 * rejected construct keeps its offsets (only characters are replaced, line breaks
 * are kept), so the next parse produces a tree for the rest of the document and the
 * diagnostics and hints of everything that follows become available.
 *
 * Each pass contributes its first error only: the remaining errors of that pass
 * describe the same failure, and the next construct that fails becomes the first
 * error of the next pass. Merging the passes therefore reports every rejected
 * construct once, in source order.
 */
export function recoverParseResult<T extends AstNode>(
    text: string,
    parse: (text: string) => ParseResult<T>
): ParseResult<T> {
    const original = parse(text);
    // A lexical error (an unterminated string, for example) makes the tokens that
    // follow it unreliable, so the constructs cannot be told apart.
    if (original.lexerErrors.length > 0) {
        return original;
    }
    const code = codePositions(text);
    // When the parser has read every declaration and lost only closing braces, the
    // tree it built is the one to keep: reparsing would remove the construct that is
    // being edited and take away completion and hints near it.
    const originalCoverage = coveredEnd(original.value);
    if (!lostContent(text, code, originalCoverage)) {
        return original;
    }

    const errors: ParseResult['parserErrors'] = [];
    let current = original;
    let masked = text;
    let previousMaskEnd = -1;

    for (let pass = 0; pass < MAX_PASSES; pass++) {
        const first = current.parserErrors[0];
        if (first === undefined) {
            break;
        }
        const span = maskSpan(first, text, code);
        if (span === undefined || span.start < previousMaskEnd) {
            break;
        }
        const nextMasked = blank(masked, span);
        const next = parse(nextMasked);
        const nextFirst = next.parserErrors[0];
        // An error that still points into the blanked construct (or before it) means
        // blanking moved the failure instead of removing it, so this parse is worse.
        if (nextFirst !== undefined && errorOffset(nextFirst) < span.end) {
            break;
        }
        errors.push(first);
        masked = nextMasked;
        current = next;
        previousMaskEnd = span.end;
    }

    if (errors.length === 0) {
        return original;
    }
    // Blanking a construct can also remove a declaration the parser had rebuilt one
    // level higher after giving up on its block. Keep the original tree when the
    // recovery reads less of the document than it did.
    if (coveredEnd(current.value) < originalCoverage) {
        return original;
    }
    const result: ParseResult<T> = { ...current, parserErrors: errors };
    recoveredResults.add(result);
    return result;
}

/** End offset of the last construct the tree covers. */
function coveredEnd(node: unknown): number {
    let end = 0;
    const seen = new Set<object>();
    const visit = (value: unknown): void => {
        if (value === null || typeof value !== 'object' || seen.has(value)) {
            return;
        }
        seen.add(value);
        const candidate = value as { $type?: unknown; $cstNode?: { offset?: number; length?: number } };
        if (typeof candidate.$type !== 'string') {
            return;
        }
        // The entry rule spans the whole text even where it placed no construct,
        // so it says nothing about what the parser has read.
        const cst = candidate.$type === 'C4Document' ? undefined : candidate.$cstNode;
        if (typeof cst?.offset === 'number' && typeof cst.length === 'number') {
            end = Math.max(end, cst.offset + cst.length);
        }
        for (const [key, child] of Object.entries(candidate)) {
            if (key.startsWith('$')) {
                continue;
            }
            if (Array.isArray(child)) {
                child.forEach(visit);
            } else {
                visit(child);
            }
        }
    };
    visit(node);
    return end;
}

/** Whether the text after the covered range holds something other than closing braces. */
function lostContent(text: string, code: Uint8Array, covered: number): boolean {
    for (let index = covered; index < text.length; index++) {
        if (code[index] !== 1) {
            continue;
        }
        const char = text[index];
        if (char !== '}' && !/\s/.test(char)) {
            return true;
        }
    }
    return false;
}

interface Span {
    start: number;
    end: number;
}

interface ParserToken {
    tokenType?: { name?: string };
    startOffset: number;
    endOffset: number;
}

/** The token the error points at, when it carries a usable position. */
function tokenOf(error: ParseResult['parserErrors'][number]): ParserToken | undefined {
    const token = (error as { token?: unknown }).token as ParserToken | undefined;
    return token !== undefined && CstUtils.isValidTokenRange(token) ? token : undefined;
}

/**
 * The characters to blank for the given error, or `undefined` when the error does
 * not point at a construct that can be removed.
 */
function maskSpan(error: ParseResult['parserErrors'][number], text: string, code: Uint8Array): Span | undefined {
    const token = tokenOf(error);
    if (token === undefined) {
        return undefined;
    }
    const name = token.tokenType?.name;
    if (name === 'EOF') {
        return undefined;
    }
    const ruleDepth = error.context?.ruleStack?.length ?? 0;
    if (name === '}') {
        // A closing brace the document has no block for ends the input: everything
        // that follows is read outside every block, so the rest of the file is blank.
        return ruleDepth <= 1
            ? { start: token.startOffset, end: text.length }
            : undefined;
    }
    if (name === 'NL') {
        // A missing token is noticed at the line break that ends the incomplete
        // entry, which is the line that has to be corrected.
        return previousLine(text, token.startOffset);
    }
    return statementSpan(text, code, token.startOffset, token.endOffset + 1);
}

/** The line that ends with the given line break, without the break itself. */
function previousLine(text: string, offset: number): Span | undefined {
    const start = text.lastIndexOf('\n', offset - 1) + 1;
    if (start >= offset || text.slice(start, offset).trim().length === 0) {
        return undefined;
    }
    return { start, end: offset };
}

/**
 * The declaration that starts on the line of `start`: its line, the lines joined to
 * it with a trailing backslash and, when it opens a body, up to the matching brace.
 */
function statementSpan(text: string, code: Uint8Array, start: number, tokenEnd: number): Span | undefined {
    let end = includeContinuations(text, start, lineEnd(text, start));
    end = includeBody(text, code, start, end);
    if (end <= start || text.slice(start, end).trim().length === 0) {
        return undefined;
    }
    return { start, end };
}

function includeContinuations(text: string, start: number, end: number): number {
    while (end < text.length) {
        let last = end - 1;
        while (last >= start && (text[last] === ' ' || text[last] === '\t' || text[last] === '\r')) {
            last--;
        }
        if (text[last] !== '\\') {
            break;
        }
        end = lineEnd(text, end + 1);
    }
    return end;
}

/** Extends the span to the closing brace of a body the declaration opens. */
function includeBody(text: string, code: Uint8Array, start: number, end: number): number {
    let depth = 0;
    for (let index = start; index < end; index++) {
        if (code[index] !== 1) {
            continue;
        }
        if (text[index] === '{') {
            depth++;
        } else if (text[index] === '}') {
            depth--;
        }
    }
    if (depth <= 0) {
        return end;
    }
    for (let index = end; index < text.length; index++) {
        if (code[index] !== 1) {
            continue;
        }
        if (text[index] === '{') {
            depth++;
        } else if (text[index] === '}' && --depth === 0) {
            return index + 1;
        }
    }
    return text.length;
}

/** Replaces every character of the span except line breaks with a space. */
function blank(text: string, span: Span): string {
    const replacement = text.slice(span.start, span.end).replace(/[^\r\n]/g, ' ');
    return text.slice(0, span.start) + replacement + text.slice(span.end);
}

function errorOffset(error: ParseResult['parserErrors'][number]): number {
    const token = tokenOf(error);
    if (token !== undefined) {
        return token.startOffset;
    }
    const previous = (error as { previousToken?: unknown }).previousToken as ParserToken | undefined;
    return previous !== undefined && CstUtils.isValidTokenRange(previous) ? previous.startOffset : -1;
}
