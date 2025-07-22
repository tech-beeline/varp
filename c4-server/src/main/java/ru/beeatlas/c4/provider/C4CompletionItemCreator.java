/*
    Copyright 2025 VimpelCom PJSC

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

package ru.beeatlas.c4.provider;

import java.util.List;

import org.eclipse.lsp4j.CompletionItem;
import org.eclipse.lsp4j.CompletionItemKind;
import org.eclipse.lsp4j.InsertTextFormat;

import ru.beeatlas.c4.model.C4TokensConfig.C4TokenSnippet;

public class C4CompletionItemCreator {

    public List<CompletionItem> keyWordCompletion(List<String> keywords) {
        return keywords.stream().map(keyword -> createCompletionItem(keyword, CompletionItemKind.Keyword))
                .toList();
    }

    public List<CompletionItem> idCompletion(List<String> ids) {
        return ids.stream().map(id -> createCompletionItem(id, CompletionItemKind.Property))
                .toList();
    }

    public List<CompletionItem> propertyCompletion(List<String> properties) {
        return properties.stream().map(prop -> createCompletionItem(prop, CompletionItemKind.Property))
                .toList();
    }

    public List<CompletionItem> snippetCompletion(List<C4TokenSnippet> snippets) {
        return snippets.stream().map(snippet -> {
            CompletionItem item = createCompletionItem(snippet.label(), CompletionItemKind.Snippet);
            item.setDetail(snippet.detail());
            item.setInsertTextFormat(InsertTextFormat.Snippet);
            item.setInsertText(snippet.insertText());
            return item;
        }).toList();
    }

    public static List<CompletionItem> identifierCompletion(List<String> identifier) {
        return identifier.stream().map(id -> createCompletionItem(id, CompletionItemKind.Reference))
                .toList();
    }

    public static CompletionItem createCompletionItem(String label, CompletionItemKind kind) {
        CompletionItem item = new CompletionItem();
        item.setLabel(label);
        item.setKind(kind);
        return item;
    }

}
