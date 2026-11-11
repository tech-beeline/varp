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

import {
    AstUtils,
    Cancellation,
    DefaultDocumentValidator,
    DocumentValidator,
    type LangiumDocument,
    type LangiumSharedCoreServices,
    type ParseResult,
    type ValidationOptions,
} from 'langium';
import { DiagnosticSeverity, type Diagnostic } from 'vscode-languageserver';
import { isC4Document, isInclude, isWorkspace, type C4Document } from '../generated/ast';
import type { C4Services } from './c4-module';
import { getAncestorChain, getConstantsForDocument } from './c4-include-resolver';
import { isRecoveredParseResult } from './c4-parse-recovery';
import { codePositions, lineEnd } from './c4-source-text';

/**
 * Document validator that reports what the document itself gets wrong.
 *
 * The parser recovers from an error and continues, so one mistake produces several
 * diagnostics: the tokens it leaves over are reported again, the recovered tree is
 * linked and reported as unresolved, and every construct after the failure is read
 * from a position the parser invented. The reference implementation stops at the
 * first problem and reports none of them. This validator keeps the diagnostics that
 * describe the input and drops the ones that describe the recovery.
 */
export class C4DocumentValidator extends DefaultDocumentValidator {
    private readonly sharedServices: LangiumSharedCoreServices;

    constructor(services: C4Services) {
        super(services);
        this.sharedServices = services.shared;
    }

    override async validateDocument(
        document: LangiumDocument,
        options: ValidationOptions = {},
        cancelToken: Cancellation.CancellationToken = Cancellation.CancellationToken.None
    ): Promise<Diagnostic[]> {
        const diagnostics = await super.validateDocument(document, options, cancelToken);
        const result = withoutRecoveredCascades(document, diagnostics);
        extendDirectiveRanges(document, result);
        const warning = standaloneConstantWarning(this.sharedServices, document);
        if (warning) {
            result.push(warning);
        }
        return result;
    }

    protected override processParsingErrors(parseResult: ParseResult, diagnostics: Diagnostic[], options: ValidationOptions): void {
        // A recovered result already reports one error per rejected construct, so
        // none of them is a leftover of another failure.
        const errors = isRecoveredParseResult(parseResult)
            ? parseResult.parserErrors
            : withoutLeftoverCascades(parseResult.parserErrors);
        super.processParsingErrors({ ...parseResult, parserErrors: errors }, diagnostics, options);
    }

    protected override processLinkingErrors(document: LangiumDocument, diagnostics: Diagnostic[], options: ValidationOptions): void {
        const reported = diagnostics.length;
        super.processLinkingErrors(document, diagnostics, options);
        dropScopeReferences(diagnostics, reported);
        dropLinkingErrorsOnReportedTokens(diagnostics, reported);
    }
}

/**
 * Extends a diagnostic that points at the `!` of a directive to the whole word.
 *
 * The lexer reads `!` as a token of its own and the directive name after it, so a
 * rejected directive such as `!contstant` is reported on a single character unless
 * the range is widened to the rest of the word.
 */
function extendDirectiveRanges(document: LangiumDocument, diagnostics: Diagnostic[]): void {
    const text = document.textDocument.getText();
    for (const diagnostic of diagnostics) {
        if (!isParsingDiagnostic(diagnostic)) {
            continue;
        }
        const start = document.textDocument.offsetAt(diagnostic.range.start);
        const end = document.textDocument.offsetAt(diagnostic.range.end);
        if (end - start !== 1 || text[start] !== '!') {
            continue;
        }
        let cursor = end;
        while (cursor < text.length && /[\w$]/.test(text[cursor])) {
            cursor++;
        }
        if (cursor === end) {
            continue;
        }
        diagnostic.range = { start: diagnostic.range.start, end: document.textDocument.positionAt(cursor) };
    }
}

/**
 * Warns about a fragment that no workspace reaches and that references constants it
 * cannot resolve on its own.
 *
 * Such a file is validated as a standalone document: the constants declared in the
 * files around it are not visible, so the placeholder stays in the include path and
 * the include is reported as missing. The warning names the cause, and covers the
 * whole file because the file itself is what has to be placed under a workspace.
 */
function standaloneConstantWarning(
    shared: LangiumSharedCoreServices,
    document: LangiumDocument
): Diagnostic | undefined {
    const root = document.parseResult.value;
    if (!isC4Document(root) || root.workspaces.length > 0) {
        return undefined;
    }
    const text = document.textDocument.getText();
    if (!text.includes('${')) {
        return undefined;
    }
    const docUri = document.uri.toString();
    if (getAncestorChain(shared, docUri).length > 0) {
        return undefined;
    }
    const unresolved = unresolvedConstants(shared, docUri, root);
    if (unresolved.length === 0) {
        return undefined;
    }
    return {
        severity: DiagnosticSeverity.Warning,
        range: {
            start: { line: 0, character: 0 },
            end: document.textDocument.positionAt(text.length)
        },
        message: 'File is not included by any workspace, so constants declared in other files are '
            + `not visible here: ${unresolved.join(', ')}.`
    };
}

/**
 * Placeholders used by the include paths of the document that it does not declare
 * itself. Only the paths are inspected: they are where an unresolved placeholder
 * turns into a "could not be found" report.
 */
function unresolvedConstants(shared: LangiumSharedCoreServices, docUri: string, root: C4Document): string[] {
    const declared = getConstantsForDocument(shared, docUri);
    const paths: string[] = [];
    for (const node of AstUtils.streamAllContents(root)) {
        if (isInclude(node)) {
            paths.push(node.file ?? '');
        } else if (isWorkspace(node) && node.extendsUri) {
            paths.push(node.extendsUri);
        }
    }
    const unresolved: string[] = [];
    for (const path of paths) {
        for (const match of path.matchAll(/\$\{([^}]+)\}/g)) {
            const name = match[1].trim();
            const placeholder = `\${${name}}`;
            if (!declared.has(name) && !unresolved.includes(placeholder)) {
                unresolved.push(placeholder);
            }
        }
    }
    return unresolved;
}

/**
 * Drops the tokens that the recovered parser leaves over at the top level. When the
 * input has no other problem, the first of them is the real one and stays.
 */
function withoutLeftoverCascades(errors: ParseResult['parserErrors']): ParseResult['parserErrors'] {
    const leftover = errors.filter(isLeftoverToken);
    if (leftover.length === 0) {
        return errors;
    }
    const meaningful = errors.filter(error => !isLeftoverToken(error));
    return meaningful.length > 0 ? meaningful : leftover.slice(0, 1);
}

/** Whether the error was raised by the entry rule for a token after the document. */
function isLeftoverToken(error: any): boolean {
    // Chevrotain reports the tokens before the last one from inside the entry rule,
    // where a token it cannot place leaves a one-frame rule stack. The last one is
    // checked after the entry rule has returned and reported without a rule stack.
    if (error?.name === 'NotAllInputParsedException') {
        return true;
    }
    return error?.name === 'MismatchedTokenException'
        && error?.context?.ruleStack?.length === 1
        && error?.token?.tokenType?.name !== 'EOF';
}

/**
 * Drops a linking error that starts on a token the parser already rejected: the
 * target cannot be resolved because the construct was recovered, not because the
 * reference is wrong.
 */
function dropLinkingErrorsOnReportedTokens(diagnostics: Diagnostic[], reported: number): void {
    const parsedTokens = new Set(
        diagnostics.slice(0, reported)
            .filter(diagnostic => (diagnostic.data as any)?.code === DocumentValidator.ParsingError)
            .map(diagnostic => `${diagnostic.range.start.line}:${diagnostic.range.start.character}`)
    );
    if (parsedTokens.size === 0) {
        return;
    }
    const linking = diagnostics.splice(reported).filter(
        diagnostic => !parsedTokens.has(`${diagnostic.range.start.line}:${diagnostic.range.start.character}`)
    );
    diagnostics.push(...linking);
}

/**
 * Drops the linking errors of view scope references. Their target carries a type the
 * message has to name, and that type is known only after the identifier is looked up
 * in the whole workspace, so the validator reports these references instead.
 */
function dropScopeReferences(diagnostics: Diagnostic[], reported: number): void {
    const views = new Set(['SystemContextView', 'ContainerView', 'ComponentView', 'DeploymentView', 'DynamicView', 'ImageView']);
    const scopes = new Set(['softwareSystem', 'container', 'environment', 'element']);
    const kept = diagnostics.splice(reported).filter(diagnostic => {
        const data = diagnostic.data as any;
        return !views.has(data?.containerType) || !scopes.has(data?.property);
    });
    diagnostics.push(...kept);
}

/**
 * Drops the diagnostics produced by the recovered tree.
 *
 * After a construct fails the parser abandons it and rebuilds the rest of the file
 * from the tokens it can still place: keywords become elements, and linking or
 * validation reports describe that rebuilt tree rather than the input. The reference
 * implementation reports none of this, because it stops at the first problem. Here
 * the first parsing diagnostic and everything before the line it starts on is kept,
 * and a later parsing diagnostic is kept only when it lies outside the block the
 * parser fell out of, where the input is read as written again. A declaration whose
 * opening brace is missing gives up on the rest of the file: every following brace
 * would be matched one level higher.
 */
function withoutRecoveredCascades(document: LangiumDocument, diagnostics: Diagnostic[]): Diagnostic[] {
    const firstParsing = diagnostics.find(isParsingDiagnostic);
    if (firstParsing === undefined) {
        return diagnostics;
    }
    const text = document.textDocument.getText();
    // The recovered parser removed each rejected construct before reading what
    // follows, so its diagnostics describe the input and not the recovery.
    if (isRecoveredParseResult(document.parseResult)) {
        for (const diagnostic of diagnostics.filter(isParsingDiagnostic)) {
            moveToFirstVisibleToken(document, diagnostic, text);
        }
        return diagnostics;
    }
    const failure = document.textDocument.offsetAt(firstParsing.range.start);
    const constructEnd = enclosingBlockEnd(text, failure);
    const failureLineStart = text.lastIndexOf('\n', failure - 1) + 1;
    // A declaration that never opened its body is read as if the next closing brace
    // belonged to it, so every later brace is matched one level higher and the rest
    // of the file is reported from a tree that does not follow the source.
    const shiftedBraces = messageText(firstParsing).endsWith(' {');
    const kept = diagnostics.filter(diagnostic => {
        if (diagnostic === firstParsing) {
            return true;
        }
        if (shiftedBraces && isParsingDiagnostic(diagnostic)) {
            return false;
        }
        const offset = document.textDocument.offsetAt(diagnostic.range.start);
        return isParsingDiagnostic(diagnostic) ? offset >= constructEnd : offset < failureLineStart;
    });
    for (const diagnostic of kept.filter(isParsingDiagnostic)) {
        moveToFirstVisibleToken(document, diagnostic, text);
    }
    return kept;
}

function messageText(diagnostic: Diagnostic): string {
    return typeof diagnostic.message === 'string' ? diagnostic.message : diagnostic.message.value;
}

function isParsingDiagnostic(diagnostic: Diagnostic): boolean {
    return (diagnostic.data as any)?.code === DocumentValidator.ParsingError;
}

/**
 * Offset of the closing brace of the block that encloses the given position, or
 * `Infinity` when the position is outside every block.
 */
function enclosingBlockEnd(text: string, offset: number): number {
    const code = codePositions(text);
    let open = -1;
    for (let index = 0; index < offset && index < text.length; index++) {
        if (code[index] === 1 && text[index] === '{') {
            open = index;
        }
    }
    if (open < 0) {
        return Number.POSITIVE_INFINITY;
    }
    let depth = 0;
    for (let index = open; index < text.length; index++) {
        if (code[index] !== 1) {
            continue;
        }
        if (text[index] === '{') {
            depth++;
        } else if (text[index] === '}' && --depth === 0) {
            return index;
        }
    }
    return Number.POSITIVE_INFINITY;
}

/**
 * Moves a diagnostic anchored on a line break to the token that follows it. A message
 * about a missing token points at the entry the token belongs to instead.
 */
function moveToFirstVisibleToken(document: LangiumDocument, diagnostic: Diagnostic, text: string): void {
    const message = messageText(diagnostic);
    const start = document.textDocument.offsetAt(diagnostic.range.start);
    if (start >= text.length || !/\s/.test(text[start])) {
        return;
    }
    if (message.startsWith('Expected:')) {
        // The token is missing at the end of an entry, and the break that follows it
        // is where the parser noticed. The entry itself is what has to be corrected.
        const lineStart = text.lastIndexOf('\n', start - 1) + 1;
        let from = lineStart;
        while (from < start && /\s/.test(text[from])) {
            from++;
        }
        diagnostic.range = {
            start: document.textDocument.positionAt(from),
            end: document.textDocument.positionAt(start)
        };
        return;
    }
    let cursor = start;
    while (cursor < text.length && /\s/.test(text[cursor])) {
        cursor++;
    }
    if (cursor >= text.length) {
        return;
    }
    let end = cursor;
    while (end < text.length && !/[\s{}]/.test(text[end])) {
        end++;
    }
    diagnostic.range = {
        start: document.textDocument.positionAt(cursor),
        end: document.textDocument.positionAt(end)
    };
}


