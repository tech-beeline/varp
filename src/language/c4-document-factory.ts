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
    AstNode,
    Cancellation,
    DefaultLangiumDocumentFactory,
    DocumentState,
    LangiumDocument,
    LangiumSharedCoreServices,
    Mutable,
    ParserOptions,
    TextDocument,
} from 'langium';
import { URI } from 'vscode-uri';

/**
 * Removes a single leading UTF-8 byte order mark (\uFEFF) from the given text.
 *
 * Text loaded from disk (the workspace scan, `!include` targets and `extendsUri`
 * files) keeps the BOM that Node's fs.readFile returns. The lexer's
 * UNQUOTED_STRING rule starts with `[a-zA-Z0-9_\u00A0-\uFFFF]`, so the BOM gets
 * glued to the first token - "workspace" then parses as an `ArchetypeInstance`
 * referencing a definition literally named "\uFEFFworkspace" (the reported
 * "Could not resolve reference to ArchetypeDefinition" errors).
 */
export function stripBom(text: string): string {
    return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * Document factory that strips a leading UTF-8 BOM before the text is parsed and
 * stored on the document, so CST offsets and the document text stay in sync.
 *
 * Replaces the default factory in the shared module (C4SharedAddedModule), so every
 * document source - workspace initialization, `!include` loading, `fromString` and
 * editor open/change - goes through the same normalization. This is what makes the
 * "loads broken on project open, works once the file is opened in the editor"
 * behavior disappear: opening the editor worked only because VSCode strips the BOM
 * from the text it sends via didOpen, while disk-loaded documents kept it.
 */
export class C4LangiumDocumentFactory extends DefaultLangiumDocumentFactory {
    override create<T extends AstNode = AstNode>(
        uri: URI,
        content: string | TextDocument | { $model: T },
        options?: ParserOptions,
    ): LangiumDocument<T> {
        if (typeof content === 'string') {
            return super.create(uri, stripBom(content), options);
        }
        return super.create(uri, content, options);
    }

    override async createAsync<T extends AstNode = AstNode>(
        uri: URI,
        content: string | TextDocument,
        cancelToken: Cancellation.CancellationToken,
    ): Promise<LangiumDocument<T>> {
        if (typeof content === 'string') {
            return super.createAsync(uri, stripBom(content), cancelToken);
        }
        return super.createAsync(uri, content, cancelToken);
    }

    override async update<T extends AstNode = AstNode>(
        document: Mutable<LangiumDocument<T>>,
        cancellationToken: Cancellation.CancellationToken,
    ): Promise<LangiumDocument<T>> {
        // The default update() reads the text itself (LSP TextDocument or the file
        // system) and both parses and stores it - replicate it here so the BOM is
        // removed from the text used for the parse AND for the textDocument, keeping
        // offset<->position mapping consistent with the CST.
        const oldText = document.parseResult.value.$cstNode?.root.fullText;
        const textDocument = this.textDocuments?.get(document.uri.toString());
        const rawText = textDocument ? textDocument.getText() : await this.fileSystemProvider.readFile(document.uri);
        const text = stripBom(rawText);

        if (textDocument) {
            Object.defineProperty(document, 'textDocument', {
                value: textDocument
            });
        } else {
            const textDocumentGetter = this.createTextDocumentGetter(document.uri, text);
            Object.defineProperty(document, 'textDocument', {
                get: textDocumentGetter
            });
        }

        if (oldText !== text) {
            document.parseResult = await this.parseAsync(document.uri, text, cancellationToken);
            (document.parseResult.value as Mutable<AstNode>).$document = document;
        }
        document.state = DocumentState.Parsed;
        return document;
    }
}
