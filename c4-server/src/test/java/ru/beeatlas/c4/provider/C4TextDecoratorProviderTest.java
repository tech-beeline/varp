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

import org.eclipse.lsp4j.Position;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import ru.beeatlas.c4.model.C4ObjectWithContext;
import ru.beeatlas.c4.model.DecoratorRange;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assertions.assertAll;

public class C4TextDecoratorProviderTest {
    
    @BeforeEach
    public void setup() {
    }

    @Test
    void componentWithoutIdentifier() {
        String line = "component myname mydescription mytechnology mytags";
        List<DecoratorRange> decorations = C4ObjectWithContext.decorationsForComponent(line, 1).toList();
        assertThat(decorations).hasSize(4);
        assertThat(decorations.stream().map(DecoratorRange::type)).containsExactly("name: ", "description: ", "technology: ", "tags: ");
        assertThat(decorations.stream().map(dr -> dr.range().getStart().getLine())).allMatch(l -> l == 0);
        assertThat(decorations.get(0).range().getStart()).isEqualTo(new Position(0, 10));
        assertThat(decorations.get(1).range().getStart()).isEqualTo(new Position(0, 17));
        assertThat(decorations.get(2).range().getStart()).isEqualTo(new Position(0, 31));
        assertThat(decorations.get(3).range().getStart()).isEqualTo(new Position(0, 44));
    }

    @Test
    void componentWithIdentifier() {
        String line = "identifier = component myname mydescription mytechnology mytags";
        List<DecoratorRange> decorations = C4ObjectWithContext.decorationsForComponent(line, 1).toList();
        assertThat(decorations).hasSize(4);
        assertThat(decorations.stream().map(DecoratorRange::type)).containsExactly("name: ", "description: ", "technology: ", "tags: ");
        assertThat(decorations.stream().map(dr -> dr.range().getStart().getLine())).allMatch(l -> l == 0);
    }

    @Test
    void componentWithIdentifierAndBracket() {
        String line = "identifier = component myname mydescription mytechnology mytags {";
        List<DecoratorRange> decorations = C4ObjectWithContext.decorationsForComponent(line, 1).toList();
        assertThat(decorations).hasSize(4);
        assertThat(decorations.stream().map(DecoratorRange::type)).containsExactly("name: ", "description: ", "technology: ", "tags: ");
        assertThat(decorations.stream().map(dr -> dr.range().getStart().getLine())).allMatch(l -> l == 0);
    }

    @Test
    void componentOnlyName() {
        String line = "identifier = component myname";
        List<DecoratorRange> decorations = C4ObjectWithContext.decorationsForComponent(line, 1).toList();
        assertThat(decorations).hasSize(1);
        assertThat(decorations.stream().map(DecoratorRange::type)).containsExactly("name: ");
        assertThat(decorations.stream().map(dr -> dr.range().getStart().getLine())).allMatch(l -> l == 0);
    }

    @Test
    void personWithQuotedDescription() {
        String line = "user = person myname \"mydescription\" \"tag1 tag2\"";
        List<DecoratorRange> decorations = C4ObjectWithContext.decorationsForPerson(line, 1).toList();
        assertThat(decorations).hasSize(3);
        assertThat(decorations.stream().map(DecoratorRange::type)).containsExactly("name: ", "description: ", "tags: ");
    }

    @Test
    void softwareSystemDecorations() {
        String line = "identifier = softwareSystem myname \"mydescription\"  \"mytags\" {";
        List<DecoratorRange> decorations = C4ObjectWithContext.decorationsForSoftwareSystem(line, 1).toList();
        assertThat(decorations).hasSize(3);
        assertThat(decorations.stream().map(DecoratorRange::type)).containsExactly("name: ", "description: ", "tags: ");
    }

    @Test
    void relationshipDecorations() {
        String line = "sys1 -> sys2 \"Using\" \"REST\" \"async\"";
        List<DecoratorRange> decorations = C4ObjectWithContext.decorationsForRelationship(line, 1).toList();
        assertAll(
            () -> assertThat(decorations).hasSize(3),
            () -> assertThat(decorations.stream().map(DecoratorRange::type)).containsExactly("description: ", "technology: ", "tags: "),
            () -> assertThat(decorations.get(0).range().getStart()).isEqualTo(new Position(0, 13)),
            () -> assertThat(decorations.get(1).range().getStart()).isEqualTo(new Position(0, 21)),
            () -> assertThat(decorations.get(2).range().getStart()).isEqualTo(new Position(0, 28))
        );
    }

    @Test
    void hierarchicalRelationshipDecorations() {
        String line = "sys1.con1 -> sys2.con2 \"Using\" \"REST\" \"async\"";
        List<DecoratorRange> decorations = C4ObjectWithContext.decorationsForRelationship(line, 1).toList();
        assertAll(
            () -> assertThat(decorations).hasSize(3),
            () -> assertThat(decorations.stream().map(DecoratorRange::type)).containsExactly("description: ", "technology: ", "tags: "),
            () -> assertThat(decorations.get(0).range().getStart()).isEqualTo(new Position(0, 23)),
            () -> assertThat(decorations.get(1).range().getStart()).isEqualTo(new Position(0, 31)),
            () -> assertThat(decorations.get(2).range().getStart()).isEqualTo(new Position(0, 38))    
        );
    }

}
