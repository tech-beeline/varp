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

import { GrammarAST } from 'langium';

type Element = GrammarAST.AbstractElement;
type ParserRule = GrammarAST.ParserRule;
type AbstractRule = GrammarAST.AbstractRule;

interface FirstSet {
    keywords: Set<string>;
    nullable: boolean;
}

/** Canonical spelling of keywords whose terminal rule is written in lower case. */
const CANONICAL_SPELLINGS: Record<string, string> = {
    autolayout: 'autoLayout',
    deploymentenvironment: 'deploymentEnvironment',
    deploymentgroup: 'deploymentGroup',
    fontsize: 'fontSize',
    iconposition: 'iconPosition',
    impliedrelationships: 'impliedRelationships',
    infrastructurenode: 'infrastructureNode',
    instanceof: 'instanceOf',
    softwaresystem: 'softwareSystem',
    softwaresysteminstance: 'softwareSystemInstance',
    strokewidth: 'strokeWidth',
    systemcontext: 'systemContext',
    systemlandscape: 'systemLandscape',
};

/**
 * Keywords that can start a child of each block, derived from the grammar.
 *
 * The DSL spells its keywords as terminal rules (`VIEWS_KW: /views\b/i`) and requires a
 * newline before every child, so the completion parser cannot report the expected
 * keyword at the start of a line. This index supplies them: for every parser rule it
 * holds the leading keywords of the rules that can appear inside it.
 */
export function buildKeywordIndex(grammar: GrammarAST.Grammar): Map<string, string[]> {
    const parserRules = new Map<string, ParserRule>();
    for (const rule of grammar.rules) {
        if (GrammarAST.isParserRule(rule)) parserRules.set(rule.name, rule);
    }

    const firstCache = new Map<string, Set<string>>();
    const firstOfRule = (rule: AbstractRule): Set<string> => {
        if (GrammarAST.isTerminalRule(rule)) {
            const keyword = keywordOf(rule);
            return keyword ? new Set([keyword]) : new Set();
        }
        if (!GrammarAST.isParserRule(rule) || rule.dataType) return new Set();
        const cached = firstCache.get(rule.name);
        if (cached) return cached;
        const keywords = new Set<string>();
        firstCache.set(rule.name, keywords);
        for (const keyword of firstOfElement(rule.definition, firstOfRule).keywords) {
            keywords.add(keyword);
        }
        return keywords;
    };

    const index = new Map<string, string[]>();
    for (const rule of parserRules.values()) {
        const keywords = new Set<string>();
        collectChildren(rule, keywords, firstOfRule);
        if (keywords.size > 0) index.set(rule.name, [...keywords]);
    }
    return index;
}

/** The keyword a terminal rule matches, or `undefined` for terminals that are not plain words. */
function keywordOf(rule: GrammarAST.TerminalRule): string | undefined {
    const raw = terminalPattern(rule.definition);
    if (!raw) return undefined;
    const match = /^\/(.*)\/([a-z]*)$/.exec(raw);
    if (!match) return undefined;
    return plainKeyword(match[1].replace(/\\b$/, ''));
}

/** Keywords that read as one word; punctuation and multi-word terminals are skipped. */
function plainKeyword(text: string): string | undefined {
    if (!/^[!A-Za-z_][A-Za-z0-9_!-]*$/.test(text)) return undefined;
    const canonical = CANONICAL_SPELLINGS[text.replace(/^!/, '').toLowerCase()];
    if (!canonical) return text;
    return text.startsWith('!') ? `!${canonical}` : canonical;
}

/** Source text of a terminal definition; only plain regex tokens are rendered. */
function terminalPattern(element: GrammarAST.TerminalElement): string | undefined {
    return GrammarAST.isRegexToken(element) ? element.regex : undefined;
}

function firstOfElement(element: Element, firstOfRule: (rule: AbstractRule) => Set<string>): FirstSet {
    const result = computeFirst(element, firstOfRule);
    if (element.cardinality === '*' || element.cardinality === '?') {
        result.nullable = true;
    }
    return result;
}

function computeFirst(element: Element, firstOfRule: (rule: AbstractRule) => Set<string>): FirstSet {
    if (GrammarAST.isAlternatives(element)) {
        const keywords = new Set<string>();
        let nullable = false;
        for (const branch of element.elements) {
            const first = firstOfElement(branch, firstOfRule);
            for (const keyword of first.keywords) keywords.add(keyword);
            nullable = nullable || first.nullable;
        }
        return { keywords, nullable };
    }
    if (GrammarAST.isGroup(element)) {
        const keywords = new Set<string>();
        let nullable = true;
        for (const child of element.elements) {
            const first = firstOfElement(child, firstOfRule);
            for (const keyword of first.keywords) keywords.add(keyword);
            if (!first.nullable) {
                nullable = false;
                break;
            }
        }
        return { keywords, nullable };
    }
    if (GrammarAST.isUnorderedGroup(element)) {
        const keywords = new Set<string>();
        let nullable = true;
        for (const child of element.elements) {
            const first = firstOfElement(child, firstOfRule);
            for (const keyword of first.keywords) keywords.add(keyword);
            nullable = nullable && first.nullable;
        }
        return { keywords, nullable };
    }
    if (GrammarAST.isAssignment(element)) {
        return firstOfElement(element.terminal, firstOfRule);
    }
    if (GrammarAST.isRuleCall(element)) {
        const rule = element.rule.ref;
        if (!rule) return { keywords: new Set(), nullable: false };
        if (GrammarAST.isTerminalRule(rule)) {
            const keyword = keywordOf(rule);
            return { keywords: keyword ? new Set([keyword]) : new Set(), nullable: false };
        }
        return { keywords: new Set(firstOfRule(rule)), nullable: false };
    }
    if (GrammarAST.isKeyword(element)) {
        const keyword = plainKeyword(element.value);
        return { keywords: keyword ? new Set([keyword]) : new Set(), nullable: false };
    }
    if (GrammarAST.isAction(element)) {
        return { keywords: new Set(), nullable: true };
    }
    return { keywords: new Set(), nullable: false };
}

/**
 * Adds the leading keywords of every rule referenced by `rule`. Fragment rules are
 * transparent: their references belong to the enclosing block.
 */
function collectChildren(
    rule: ParserRule,
    target: Set<string>,
    firstOfRule: (rule: AbstractRule) => Set<string>
): void {
    const visitRule = (current: ParserRule): void => {
        visit(current.definition);
    };
    const visit = (element: Element): void => {
        if (GrammarAST.isRuleCall(element)) {
            const referenced = element.rule.ref;
            if (!referenced || GrammarAST.isTerminalRule(referenced)) return;
            if (!GrammarAST.isParserRule(referenced)) return;
            if (referenced.fragment) {
                visitRule(referenced);
                return;
            }
            for (const keyword of firstOfRule(referenced)) target.add(keyword);
            return;
        }
        for (const child of childrenOf(element)) visit(child);
    };
    visitRule(rule);
}

function childrenOf(element: Element): Element[] {
    if (GrammarAST.isAlternatives(element) || GrammarAST.isGroup(element) || GrammarAST.isUnorderedGroup(element)) {
        return element.elements;
    }
    if (GrammarAST.isAssignment(element)) return [element.terminal];
    return [];
}
