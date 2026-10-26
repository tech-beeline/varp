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

import { URI } from 'vscode-uri';
import type { ViewExpression } from '../generated/ast';

/**
 * Quotes filter values that contain whitespace so the expression grammar can
 * read them. Only values following `==` / `!=` are touched; already-quoted
 * values and single-token values (which may be keywords) are left alone.
 */
export function requoteFilterValues(text: string): string {
    const stopsAt = /[,()[\]&|=!>}]/;
    let result = '';
    let index = 0;

    while (index < text.length) {
        const isOperator = text.startsWith('==', index) || text.startsWith('!=', index);
        if (!isOperator) {
            result += text[index++];
            continue;
        }

        result += text.substring(index, index + 2);
        index += 2;
        // Whitespace between the operator and its value is preserved as-is.
        while (index < text.length && /\s/.test(text[index])) {
            result += text[index++];
        }

        let end = index;
        while (end < text.length && !stopsAt.test(text[end])) end++;
        const value = text.substring(index, end);
        const trimmed = value.trimEnd();
        const alreadyQuoted = /^(["']).*\1$/.test(trimmed);
        // Only whitespace-bearing values need quoting. Quoting a single token
        // would turn a keyword value (`element.type==infrastructureNode`) into a
        // STRING, which ElementTypeExpression cannot read.
        const needsQuoting = /\s/.test(trimmed);
        const quoted = trimmed === '' || alreadyQuoted || !needsQuoting ? trimmed : `"${trimmed}"`;
        result += quoted + value.substring(trimmed.length);
        index = end;
    }

    return result;
}

export interface QuotedFilterParseResult {
    /** Expressions the filter text parsed into; empty when it is not a valid filter. */
    expressions: ViewExpression[];
    /** True when the whole text is `*`, which selects the default elements of the view. */
    all: boolean;
    /** Raw parser messages, for callers that want the underlying reason. */
    parserErrors: string[];
}

/**
 * Re-parses the content of a quoted view filter through the grammar. The filter
 * text is wrapped in a synthetic `views { custom { include ... } }` document that
 * is never registered or linked; the caller resolves its references from
 * `$refText` instead.
 */
export function parseQuotedFilterText(sharedServices: any, text: string): QuotedFilterParseResult {
    if (!text) return { expressions: [], all: false, parserErrors: [] };

    const dsl = `views {\n    custom {\n        include ${requoteFilterValues(text)}\n    }\n}`;
    const document = sharedServices.workspace.LangiumDocumentFactory
        .fromString(dsl, URI.parse('inmemory:/quoted-filter.dsl'));
    // A bare `views { ... }` block is valid at the document root.
    const root: any = document.parseResult.value;

    const expressions: ViewExpression[] = [];
    for (const include of root?.viewsBlocks?.at(0)?.views?.at(0)?.includeProps ?? []) {
        for (const element of include.expressions ?? []) {
            if (element.expression) expressions.push(element.expression);
        }
    }
    const includeProps = root?.viewsBlocks?.at(0)?.views?.at(0)?.includeProps ?? [];
    return {
        expressions,
        all: includeProps.some((include: any) => include.all === '*'),
        parserErrors: document.parseResult.parserErrors.map((e: any) => e.message)
    };
}
