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
