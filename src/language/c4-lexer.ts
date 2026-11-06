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

import { createToken, type IToken, type TokenType } from 'chevrotain';
import { DefaultLexer, DEFAULT_TOKENIZE_OPTIONS, type LangiumCoreServices, type LexerResult, type TokenizeOptions } from 'langium';

const DOUBLE_QUOTE = 34; // "

interface QuotedKeywordTypes {
    /** Keyword token types whose terminal is case-insensitive, keyed by lowercase keyword. */
    caseInsensitive: Map<string, TokenType>;
    /** Keyword token types whose terminal is case-sensitive, keyed by the keyword itself. */
    exact: Map<string, TokenType>;
}

/**
 * Lexer that accepts a quoted keyword in any keyword position.
 *
 * The reference library tokenizes the DSL without the surrounding quotes and
 * compares tokens to keywords by their text, so `"tags" "sample"` means the same
 * as `tags "sample"` (`Structurizr` accepts both, and generated DSL files use the
 * quoted form). Langium matches keywords by token type, so a quoted keyword would
 * otherwise be a plain `STRING` and fail the keyword expectation.
 *
 * For every keyword terminal this lexer creates a quoted variant token type that
 * belongs to two categories: the keyword itself and `STRING`. Retagging a quoted
 * keyword token to that variant therefore satisfies both a keyword position and a
 * value position, while its image and offsets stay untouched - the parsed text is
 * exactly the source text.
 *
 * The variant types have no pattern: the lexer never matches them itself (which
 * would slow down every quoted string), they are only assigned to existing tokens.
 */
export class C4Lexer extends DefaultLexer {

    /**
     * Built eagerly: the token types must exist (and be registered as categories
     * of the keyword terminals) before the parser is constructed, because the
     * parser picks its token matcher based on whether categories are in use.
     */
    private readonly quotedKeywordTypes: QuotedKeywordTypes | undefined;

    constructor(services: LangiumCoreServices) {
        super(services);
        this.quotedKeywordTypes = buildQuotedKeywordTypes(this.tokenTypes);
    }

    override tokenize(text: string, options: TokenizeOptions = DEFAULT_TOKENIZE_OPTIONS): LexerResult {
        const result = super.tokenize(text, options);
        const lookup = this.quotedKeywordTypes;
        if (lookup === undefined) {
            return result;
        }
        return {
            ...result,
            tokens: result.tokens.map(token => this.retagQuotedKeyword(token, lookup)),
        };
    }

    /** Retags a quoted token whose text is a keyword; every other token is returned as is. */
    private retagQuotedKeyword(token: IToken, lookup: QuotedKeywordTypes): IToken {
        if (token.tokenType !== this.tokenTypes.STRING) {
            return token;
        }
        const image = token.image;
        const last = image.length - 1;
        if (last < 2 || image.charCodeAt(0) !== DOUBLE_QUOTE || image.charCodeAt(last) !== DOUBLE_QUOTE) {
            return token;
        }
        // The token must not span lines: a keyword is a single word, and the STRING
        // terminal also accepts escaped line breaks.
        const inner = image.slice(1, last);
        if (inner.includes('\n') || inner.includes('\r')) {
            return token;
        }
        const quoted = lookup.caseInsensitive.get(inner.toLowerCase()) ?? lookup.exact.get(inner);
        if (quoted === undefined) {
            return token;
        }
        return { ...token, tokenType: quoted, tokenTypeIdx: quoted.tokenTypeIdx ?? token.tokenTypeIdx };
    }
}

/**
 * Builds the quoted variant of every keyword terminal. Each variant belongs to
 * two categories - the keyword itself and `STRING` - so a retagged token is
 * accepted both where a keyword is expected and where a value is expected.
 */
function buildQuotedKeywordTypes(tokenTypes: Record<string, TokenType>): QuotedKeywordTypes | undefined {
    const stringType = tokenTypes.STRING;
    if (stringType === undefined) {
        return undefined;
    }
    const caseInsensitive = new Map<string, TokenType>();
    const exact = new Map<string, TokenType>();
    for (const [name, tokenType] of Object.entries(tokenTypes)) {
        if (!name.endsWith('_KW')) continue;
        const pattern = (tokenType as { PATTERN?: unknown }).PATTERN;
        if (!(pattern instanceof RegExp)) continue;
        const keyword = keywordText(pattern);
        if (keyword === undefined) continue;
        const isCaseInsensitive = pattern.flags.includes('i');
        const map = isCaseInsensitive ? caseInsensitive : exact;
        map.set(isCaseInsensitive ? keyword.toLowerCase() : keyword, createToken({
            name: `QUOTED_${name}`,
            categories: [tokenType, stringType],
        }));
    }
    return { caseInsensitive, exact };
}

/**
 * Extracts the literal keyword from a keyword terminal pattern such as `/tags\b/i`
 * or `/element.tag\b/i`. Returns undefined for patterns that are not a single
 * literal word, which keeps the transformation conservative.
 */
function keywordText(pattern: RegExp): string | undefined {
    const source = pattern.source.replace(/\\b$/, '');
    const flags = pattern.flags.replace(/[gy]/g, '');
    // Only plain words (optionally containing a dot, as in `element.tag`) are
    // keywords; anything with other regex syntax is not a keyword terminal.
    if (/[\\^$*+?()[\]{}|]/.test(source)) {
        return undefined;
    }
    const literal = source.replace(/\\(.)/g, '$1');
    const matchesWhole = new RegExp(`^(?:${pattern.source})$`, flags).test(literal);
    return matchesWhole ? literal : undefined;
}
