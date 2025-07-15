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
