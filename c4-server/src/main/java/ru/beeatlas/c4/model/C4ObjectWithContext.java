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

package ru.beeatlas.c4.model;

import java.util.List;
import java.util.stream.IntStream;
import java.util.stream.Stream;

import org.eclipse.lsp4j.Position;
import org.eclipse.lsp4j.Range;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import com.structurizr.model.Component;
import com.structurizr.model.Container;
import com.structurizr.model.ContainerInstance;
import com.structurizr.model.DeploymentNode;
import com.structurizr.model.InfrastructureNode;
import com.structurizr.model.Person;
import com.structurizr.model.Relationship;
import com.structurizr.model.SoftwareSystem;
import com.structurizr.model.SoftwareSystemInstance;
import com.structurizr.view.FilteredView;
import com.structurizr.view.View;

import ru.beeatlas.c4.utils.LineToken;
import ru.beeatlas.c4.utils.LineTokenizer;
import ru.beeatlas.c4.utils.C4Utils;

public class C4ObjectWithContext<T> {

    private static final Logger logger = LoggerFactory.getLogger(C4ObjectWithContext.class);

    private String identifier;
    private String line;
    private int lineNumber;
    private T object;
    private C4DocumentModel container;

    public int getLineNumber() {
        return lineNumber;
    }

    public String getIdentifier() {
        return identifier;
    }

    public T getObject() {
        return object;
    }

    public C4DocumentModel getContainer() {
        return container;
    }

    private static DecoratorRange createDecoratorRange(String type, int line, int character) {
        return new DecoratorRange(type, new Range(new Position(line, character), new Position(line, character)));
    }

    public Range getCodeLensRange() {
        int pos = C4Utils.findFirstNonWhitespace(line, 0, true);
        return new Range(new Position(lineNumber - 1, pos), new Position(lineNumber - 1, pos));
    }

    static public Stream<DecoratorRange> decorationsForRelationship(String line, int lineNumber) {
        List<LineToken> tokens = LineTokenizer.tokenize(line);
        if (tokens.size() < 2) {
            return Stream.empty();
        }
        int firstIndex = (tokens.get(1).token().equals(LineTokenizer.TOKEN_EXPR_RELATIONSHIP)) ? 3 : 2;

        return IntStream.range(0, RELATIONSHIP_DECORATIONS.length)
                .filter(i -> firstIndex + i < tokens.size() && !tokens.get(firstIndex + i).token().equals("{"))
                .mapToObj(i -> createDecoratorRange(RELATIONSHIP_DECORATIONS[i], lineNumber - 1,
                        tokens.get(firstIndex + i).start()));
    }

    static Stream<DecoratorRange> decorationsForElement(String line, int lineNumber, String[] decorationLabels) {
        List<LineToken> tokens = LineTokenizer.tokenize(line);
        if (tokens.size() < 2) {
            return Stream.empty();
        }

        int firstIndex = (tokens.get(1).token().equals(LineTokenizer.TOKEN_EXPR_ASSIGNMENT)) ? 3 : 1;

        return IntStream.range(0, decorationLabels.length)
                .filter(i -> firstIndex + i < tokens.size() && !tokens.get(firstIndex + i).token().equals("{"))
                .mapToObj(i -> createDecoratorRange(decorationLabels[i], lineNumber - 1,
                        tokens.get(firstIndex + i).start()));
    }

    Stream<DecoratorRange> decorationsForView(String line, int lineNumber) {
        List<LineToken> tokens = LineTokenizer.tokenize(line);
        if (tokens.size() < 2) {
            return Stream.empty();
        }

        int firstIndex = 2;

        return IntStream.range(0, VIEW_DECORATIONS.length)
                .filter(i -> firstIndex + i < tokens.size() && !tokens.get(firstIndex + i).token().equals("{"))
                .mapToObj(i -> createDecoratorRange(VIEW_DECORATIONS[i], lineNumber - 1,
                        tokens.get(firstIndex + i).start()));
    }

    Stream<DecoratorRange> decorationsForFilteredView(String line, int lineNumber) {
        List<LineToken> tokens = LineTokenizer.tokenize(line);
        if (tokens.size() < 2) {
            return Stream.empty();
        }

        int firstIndex = 1;

        return IntStream.range(0, FILTERED_VIEW_DECORATIONS.length)
                .filter(i -> firstIndex + i < tokens.size())
                .mapToObj(i -> createDecoratorRange(FILTERED_VIEW_DECORATIONS[i], lineNumber - 1,
                        tokens.get(firstIndex + i).start()));
    }

    private final static String[] PERSON_DECORATIONS = new String[] { "name: ", "description: ", "tags: " };
    private final static String[] SOFTWARE_SYSTEM_DECORATIONS = new String[] { "name: ", "description: ", "tags: " };
    private final static String[] CONTAINER_DECORATIONS = new String[] { "name: ", "description: ", "technology: ", "tags: " };
    private final static String[] COMPONENT_DECORATIONS = new String[] { "name: ", "description: ", "technology: ", "tags: " };
    private final static String[] DEPLOYMENT_NODE_DECORATIONS = new String[] { "name: ", "description: ", "technology: ", "tags: ", "instances: " };
    private final static String[] INFRASTRUCUTRE_NODE_DECORATIONS = new String[] { "name: ", "description: ", "technology: ", "tags: " };
    private final static String[] SOFTWARE_SYSTEM_INSTANCE_DECORATIONS = new String[] { "identifier: ", "deploymentGroups: ", "tags: " };
    private final static String[] CONTAINER_INSTANCE_DECORATIONS = new String[] { "identifier: ", "deploymentGroups: ", "tags: " };
    private final static String[] RELATIONSHIP_DECORATIONS = new String[] { "description: ", "technology: ", "tags: " };
    private final static String[] VIEW_DECORATIONS = new String[] { "key: ", "description: " };
    private final static String[] FILTERED_VIEW_DECORATIONS = new String[] { "baseKey: ", "mode: ", "tags: ", "key: ", "description: " };

    public static Stream<DecoratorRange> decorationsForPerson(String line, int lineNumber) {
        return decorationsForElement(line, lineNumber, PERSON_DECORATIONS);
    }

    public static Stream<DecoratorRange> decorationsForSoftwareSystem(String line, int lineNumber) {
        return decorationsForElement(line, lineNumber, SOFTWARE_SYSTEM_DECORATIONS);
    }

    public static Stream<DecoratorRange> decorationsForContainer(String line, int lineNumber) {
        return decorationsForElement(line, lineNumber, CONTAINER_DECORATIONS);
    }

    public static Stream<DecoratorRange> decorationsForComponent(String line, int lineNumber) {
        return decorationsForElement(line, lineNumber, COMPONENT_DECORATIONS);
    }    

    public static Stream<DecoratorRange> decorationsForDeploymentNode(String line, int lineNumber) {
        return decorationsForElement(line, lineNumber, DEPLOYMENT_NODE_DECORATIONS);
    }

    public static Stream<DecoratorRange> decorationsForInfrastructureNode(String line, int lineNumber) {
        return decorationsForElement(line, lineNumber, INFRASTRUCUTRE_NODE_DECORATIONS);
    }

    public static Stream<DecoratorRange> decorationsForSoftwareSystemInstance(String line, int lineNumber) {
        return decorationsForElement(line, lineNumber, SOFTWARE_SYSTEM_INSTANCE_DECORATIONS);
    }

    public static Stream<DecoratorRange> decorationsForContainerInstance(String line, int lineNumber) {
        return decorationsForElement(line, lineNumber, CONTAINER_INSTANCE_DECORATIONS);
    }    

    public Stream<DecoratorRange> getDecorations() {

        if (object instanceof FilteredView) {
            return decorationsForFilteredView(line, lineNumber);
        }

        if (object instanceof View) {
            return decorationsForView(line, lineNumber);
        }

        if (object instanceof Relationship) {
            return decorationsForRelationship(line, lineNumber);
        }

        if (object instanceof Person) {
            return decorationsForPerson(line, lineNumber);
        }

        if (object instanceof SoftwareSystem) {
            return decorationsForSoftwareSystem(line, lineNumber);
        }

        if (object instanceof Container) {
            return decorationsForContainer(line, lineNumber);
        }

        if (object instanceof Component) {
            return decorationsForComponent(line, lineNumber);
        }

        if (object instanceof DeploymentNode) {
            return decorationsForDeploymentNode(line, lineNumber);
        }

        if (object instanceof InfrastructureNode) {
            return decorationsForInfrastructureNode(line, lineNumber);
        }

        if (object instanceof SoftwareSystemInstance) {
            return decorationsForSoftwareSystemInstance(line, lineNumber);
        }

        if (object instanceof ContainerInstance) {
            return decorationsForContainerInstance(line, lineNumber);
        }

        return Stream.empty();
    }

    public C4ObjectWithContext(String identifier, int lineNumber, String line, T object, C4DocumentModel container) {
        this.identifier = identifier;
        this.line = line;
        this.lineNumber = lineNumber;
        this.object = object;
        this.container = container;
    }

}