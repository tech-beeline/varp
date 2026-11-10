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

import { createToken, Lexer, type TokenType, type TokenVocabulary } from 'chevrotain';
import {
    DefaultLexer,
    DefaultTokenBuilder,
    DEFAULT_TOKENIZE_OPTIONS,
    isTokenTypeArray,
    type Grammar,
    type LangiumCoreServices,
    type LexerResult,
    type TokenBuilderOptions,
    type TokenizeOptions,
} from 'langium';

const DOUBLE_QUOTE = 34; // "

/**
 * Terminals the grammar reads through the `KEYWORD` category. They may act as a
 * name or a value wherever a reserved word is allowed; listing them here keeps
 * the grammar's `IdentifierKeyword` rule at a single alternative.
 */
const IDENTIFIER_KEYWORDS = new Set([
    'DEPLOYMENT_ENV_KW', 'SOFTWARE_SYSTEM_KW', 'CONTAINER_KW', 'PERSON_KW',
    'AUTOLAYOUT_KW', 'INFRASTRUCTURE_NODE_KW', 'DEPLOYMENT_NODE_KW', 'SYSTEM_LANDSCAPE_KW',
    'CUSTOM_KW', 'SYSTEM_CONTEXT_KW', 'COMPONENTS_KW', 'COMPONENT_KW',
    'GROUP_KW', 'THIS_KW', 'DEPLOYMENT_GROUP_KW', 'ANIMATION_KW',
    'STYLES_KW', 'ELEMENT_KW', 'RELATIONSHIP_KW', 'SHAPE_KW',
    'BACKGROUND_KW', 'THEME_KW', 'THEMES_KW', 'DESCRIPTION_KW',
    'NAME_KW', 'SOFTWARE_SYSTEM_INSTANCE_KW', 'CONTAINER_INSTANCE_KW', 'INSTANCEOF_KW',
    'PLANTUML_KW', 'MERMAID_KW', 'KROKI_KW', 'IMAGE_KW',
    'INCLUDE_KW', 'EXCLUDE_KW', 'TECHNOLOGY_KW', 'URL_KW',
    'TAG_KW', 'TAGS_KW', 'STROKE_KW', 'METADATA_KW',
    'STROKE_WIDTH_KW', 'FONTSIZE_KW', 'FILTERED_KW', 'ICON_KW',
    'DASHED_KW', 'COLOR_KW', 'COLOUR_KW', 'JUMP_KW',
    'STYLE_KW', 'LIGHT_KW', 'DARK_KW', 'POSITION_KW',
    'ROUTING_KW', 'WIDTH_KW', 'HEIGHT_KW', 'INSTANCES_KW',
    'PROPERTIES_KW', 'DYNAMIC_KW', 'DEPLOYMENT_KW', 'MODEL_KW',
    'VIEWS_KW', 'TERMINOLOGY_KW', 'SCOPE_KW', 'VISIBILITY_KW',
    'USERS_KW', 'CONFIGURATION_KW', 'PERSPECTIVE_KW', 'PERSPECTIVES_KW',
    'TRUE_KW', 'FALSE_KW', 'LANDSCAPE_KW', 'NONE_KW',
    'DEFAULT_KW', 'THICKNESS_KW', 'HIERARCHICAL_KW', 'FLAT_KW',
    'PRIVATE_KW',
    'PUBLIC_KW', 'VALUE_KW', 'TITLE_KW', 'WORKSPACE_KW',
    'EXTENDS_KW', 'ARCHETYPES_KW', 'HEALTHCHECK_KW',
]);

/**
 * Keywords that must stay lexer terminals. They are declared before
 * `RELATIONSHIP_SOURCE`, so they win the equal-length tie against it, which is
 * what keeps `include ->a` an include expression and `this -> x` a relationship.
 */
const LEXER_KEYWORDS = new Set(['THIS_KW', 'INCLUDE_KW', 'EXCLUDE_KW']);

/**
 * Literal keywords that the lexer no longer matches itself: `UNQUOTED_STRING`
 * covers them and `C4Lexer` retags the token by its image. A keyword left in the
 * token table costs a match attempt at every input position.
 */
const KEYWORD_LITERALS = new WeakMap<TokenType, KeywordInfo>();

interface KeywordInfo {
    text: string;
    caseInsensitive: boolean;
}

/**
 * Token builder that prepares the vocabulary for both the lexer and the parser:
 * the identifier keywords join the `KEYWORD` category, and a keyword that is a
 * plain word gives up its own pattern because `UNQUOTED_STRING` matches it and
 * `C4Lexer` retags the token. Chevrotain expands token categories once, when the
 * vocabulary is bound to the lexer, and the parser reads that expansion from the
 * same token objects.
 */
export class C4TokenBuilder extends DefaultTokenBuilder {
    override buildTokens(grammar: Grammar, options?: TokenBuilderOptions): TokenVocabulary {
        const tokens = super.buildTokens(grammar, options);
        if (!isTokenTypeArray(tokens)) {
            return tokens;
        }
        const category = tokens.find(token => token.name === 'KEYWORD');
        if (category !== undefined) {
            // The category only groups other terminals, so it must never be matched.
            category.PATTERN = Lexer.NA;
        }
        const retaggable = tokens.some(token => token.name === 'UNQUOTED_STRING');
        for (const token of tokens) {
            if (category !== undefined && IDENTIFIER_KEYWORDS.has(token.name)) {
                token.CATEGORIES = [category];
            }
            if (!retaggable || !token.name.endsWith('_KW') || LEXER_KEYWORDS.has(token.name)) {
                continue;
            }
            const keyword = keywordInfo(token.PATTERN);
            // A directive such as `!const` starts with `!`, which no UNQUOTED_STRING
            // can begin with, so it has to stay a lexer terminal.
            if (keyword === undefined || keyword.text.startsWith('!')) {
                continue;
            }
            KEYWORD_LITERALS.set(token, keyword);
            token.PATTERN = Lexer.NA;
        }
        return tokens;
    }
}

interface KeywordTypes {
    /** Keywords whose terminal is case-insensitive, keyed by lowercase keyword. */
    caseInsensitive: Map<string, KeywordEntry>;
    /** Keywords whose terminal is case-sensitive, keyed by the keyword itself. */
    exact: Map<string, KeywordEntry>;
    /** Longest keyword plus the two quotes: a longer token can never be a keyword. */
    maxImageLength: number;
}

interface KeywordEntry {
    /** The terminal the lexer produces for the bare keyword. */
    type: TokenType;
    /** The variant a quoted occurrence is retagged to. */
    quoted: TokenType;
}

/**
 * Lexer that accepts a keyword wherever the grammar expects one, quoted or not.
 *
 * The reference library tokenizes the DSL without the surrounding quotes and
 * compares tokens to keywords by their text, so `"tags" "sample"` means the same
 * as `tags "sample"` (`Structurizr` accepts both, and generated DSL files use the
 * quoted form). Langium matches keywords by token type, so a quoted keyword would
 * otherwise be a plain `STRING` token and fail the keyword expectation.
 *
 * Bare keywords take the same route: the token table keeps only the structural
 * terminals, so `tags` arrives as an `UNQUOTED_STRING` and is retagged to the
 * keyword terminal after tokenizing. Both retags leave the image and the offsets
 * untouched - the parsed text is exactly the source text.
 *
 * A keyword that continues into a path suffix (`group-name`, `container/child`) stays a
 * single `UNQUOTED_STRING` instead of a keyword plus a suffix token, so the
 * identifier rules accept both shapes and produce the same value.
 *
 * The quoted variants are created here with two categories, the keyword itself and
 * `STRING`, so a quoted keyword is accepted both where a keyword and where a value
 * is expected. They have no pattern: the lexer never matches them itself, they are
 * only assigned to existing tokens.
 */
export class C4Lexer extends DefaultLexer {

    /**
     * Built eagerly: the token types must exist (and be registered as categories
     * of the keyword terminals) before the parser is constructed, because the
     * parser picks its token matcher based on whether categories are in use.
     */
    private readonly keywordTypes: KeywordTypes | undefined;

    /** Retag results by token image; names repeat heavily across a workspace. */
    private readonly retagCache = new Map<string, TokenType | null>();

    constructor(services: LangiumCoreServices) {
        super(services);
        this.keywordTypes = buildKeywordTypes(this.tokenTypes);
    }

    override tokenize(text: string, options: TokenizeOptions = DEFAULT_TOKENIZE_OPTIONS): LexerResult {
        const result = super.tokenize(text, options);
        const lookup = this.keywordTypes;
        if (lookup === undefined) {
            return result;
        }
        const stringType = this.tokenTypes.STRING;
        const unquotedType = this.tokenTypes.UNQUOTED_STRING;
        const cache = this.retagCache;
        const maxLength = lookup.maxImageLength;
        const tokens = result.tokens;
        for (let i = 0; i < tokens.length; i++) {
            const token = tokens[i];
            const type = token.tokenType;
            const quoted = type === stringType;
            if (!quoted && type !== unquotedType) {
                continue;
            }
            const image = token.image;
            if (image.length > maxLength) {
                continue;
            }
            let keyword = cache.get(image);
            if (keyword === undefined) {
                keyword = quoted
                    ? quotedKeyword(image, lookup) ?? null
                    : keywordEntry(image, lookup)?.type ?? null;
                cache.set(image, keyword);
            }
            if (keyword === null) {
                continue;
            }
            token.tokenType = keyword;
            token.tokenTypeIdx = keyword.tokenTypeIdx ?? token.tokenTypeIdx;
        }
        return result;
    }
}

/** The token type a quoted keyword stands for, or `undefined` for a plain string. */
function quotedKeyword(image: string, lookup: KeywordTypes): TokenType | undefined {
    const last = image.length - 1;
    if (last < 2 || image.charCodeAt(0) !== DOUBLE_QUOTE || image.charCodeAt(last) !== DOUBLE_QUOTE) {
        return undefined;
    }
    // A keyword is a single word, but the STRING terminal also accepts escaped
    // line breaks, so a quoted token spanning lines is never a keyword.
    const inner = image.slice(1, last);
    if (inner.includes('\n') || inner.includes('\r')) {
        return undefined;
    }
    return keywordEntry(inner, lookup)?.quoted;
}

function keywordEntry(image: string, lookup: KeywordTypes): KeywordEntry | undefined {
    return lookup.caseInsensitive.get(lowercase(image)) ?? lookup.exact.get(image);
}

/** Lowercases without allocating a new string when the text is already lowercase. */
function lowercase(text: string): string {
    for (let i = 0; i < text.length; i++) {
        const code = text.charCodeAt(i);
        // Keywords are ASCII: ASCII lower case is a no-op, and a non-ASCII
        // character may case-fold to an ASCII keyword, so fall back then.
        if (code >= 65 && code <= 90) return text.toLowerCase();
        if (code > 127) return text.toLowerCase();
    }
    return text;
}

/**
 * Indexes the keyword terminals by their text and creates the quoted variant of
 * every keyword. Each variant belongs to two categories - the keyword itself and
 * `STRING` - so a retagged token is accepted both where a keyword is expected and
 * where a value is expected.
 */
function buildKeywordTypes(tokenTypes: Record<string, TokenType>): KeywordTypes | undefined {
    const stringType = tokenTypes.STRING;
    if (stringType === undefined) {
        return undefined;
    }
    const caseInsensitive = new Map<string, KeywordEntry>();
    const exact = new Map<string, KeywordEntry>();
    let maxImageLength = 0;
    for (const [name, tokenType] of Object.entries(tokenTypes)) {
        if (!name.endsWith('_KW')) {
            continue;
        }
        const keyword = KEYWORD_LITERALS.get(tokenType) ?? keywordInfo(tokenType.PATTERN);
        if (keyword === undefined) {
            continue;
        }
        const key = keyword.caseInsensitive ? keyword.text.toLowerCase() : keyword.text;
        const map = keyword.caseInsensitive ? caseInsensitive : exact;
        map.set(key, {
            type: tokenType,
            quoted: createToken({
                name: `QUOTED_${name}`,
                categories: [tokenType, stringType],
            }),
        });
        maxImageLength = Math.max(maxImageLength, key.length + 2);
    }
    return { caseInsensitive, exact, maxImageLength };
}

/**
 * Describes a keyword terminal pattern such as `/tags\b/i` or `/element.tag\b/i`.
 * Returns undefined for patterns that are not a single literal word, which keeps
 * the transformation conservative.
 */
function keywordInfo(pattern: unknown): KeywordInfo | undefined {
    if (!(pattern instanceof RegExp)) {
        return undefined;
    }
    const source = pattern.source.replace(/\\b$/, '');
    const flags = pattern.flags.replace(/[gy]/g, '');
    // Only plain words (optionally containing a dot, as in `element.tag`) are
    // keywords; anything with other regex syntax is not a keyword terminal.
    if (/[\\^$*+?()[\]{}|]/.test(source)) {
        return undefined;
    }
    const literal = source.replace(/\\(.)/g, '$1');
    const matchesWhole = new RegExp(`^(?:${pattern.source})$`, flags).test(literal);
    return matchesWhole ? { text: literal, caseInsensitive: pattern.flags.includes('i') } : undefined;
}
