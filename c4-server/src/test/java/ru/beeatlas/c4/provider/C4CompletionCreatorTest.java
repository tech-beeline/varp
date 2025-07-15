package ru.beeatlas.c4.provider;

import java.util.List;

import org.eclipse.lsp4j.CompletionItem;
import org.eclipse.lsp4j.CompletionItemKind;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

public class C4CompletionCreatorTest {
    
    private C4CompletionItemCreator creator;

    @BeforeEach    
    public void setup() {
        creator = new C4CompletionItemCreator();
    }

    @Test
    void createKeywordCompletions() {
        List<String> keywords = List.of("keyword1", "keyword2", "keyword3");
        List<CompletionItem> completions = creator.keyWordCompletion(keywords);
        assertThat(completions.stream().map(CompletionItem::getKind)).allMatch( kind -> kind.equals(CompletionItemKind.Keyword));
        assertThat(completions.stream().map(CompletionItem::getLabel)).containsExactly("keyword1", "keyword2", "keyword3");
    }

    @Test
    void createPropertyCompletions() {
        List<String> properties = List.of("prop1", "prop2", "prop3");
        List<CompletionItem> completions = creator.propertyCompletion(properties);
        assertThat(completions.stream().map(CompletionItem::getKind)).allMatch( kind -> kind.equals(CompletionItemKind.Property));
        assertThat(completions.stream().map(CompletionItem::getLabel)).containsExactly("prop1", "prop2", "prop3");
    }

    @Test
    void createReferenceCompletions() {
        List<String> references = List.of("ref1", "ref2", "ref3");
        List<CompletionItem> completions = C4CompletionItemCreator.identifierCompletion(references);
        assertThat(completions.stream().map(CompletionItem::getKind)).allMatch( kind -> kind.equals(CompletionItemKind.Reference));
        assertThat(completions.stream().map(CompletionItem::getLabel)).containsExactly("ref1", "ref2", "ref3");
    }

}
