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

package ru.beeatlas.c4.intercept;

import java.io.File;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.InOrder;

import com.google.inject.AbstractModule;
import com.google.inject.Guice;
import com.google.inject.Injector;
import com.google.inject.Module;
import com.structurizr.dsl.StructurizrDslParser;
import com.structurizr.dsl.StructurizrDslParserException;
import com.structurizr.model.Person;
import com.structurizr.model.SoftwareSystem;
import com.structurizr.view.SystemContextView;

import ru.beeatlas.c4.helper.C4TestHelper;

import static org.aspectj.lang.Aspects.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;

public class InterceptParserTest {
    
    private StructurizrDslParser parser;
    private StructurizrDslParserListener mockListener;
    private File testFile;
    private InOrder checkOrder;

    @BeforeEach
    public void setupDI() {

        testFile = new File(C4TestHelper.PATH_VALID_MODELS + "/" + "financial_risk.dsl" );

        Module testModule = new AbstractModule() {

            @Override
            protected void configure() {
                mockListener = mock(StructurizrDslParserListener.class);
                bind(StructurizrDslParserListener.class).toInstance(mockListener);
                requestInjection(aspectOf(InterceptParserAspect.class));
            }
            
        };

        Injector injector = Guice.createInjector(testModule);
        parser = injector.getInstance(StructurizrDslParser.class);

        checkOrder = inOrder(mockListener);
    }

    @Test
    void startAndEndContext() throws StructurizrDslParserException {

        parser.parse(testFile);

        checkOrder.verify(mockListener).onStartContext(anyInt(), eq("WorkspaceDslContext"));
        checkOrder.verify(mockListener).onStartContext(anyInt(), eq("ModelDslContext"));
        checkOrder.verify(mockListener).onEndContext(anyInt(), eq("ModelDslContext"));
        checkOrder.verify(mockListener).onStartContext(anyInt(), eq("ViewsDslContext"));
        checkOrder.verify(mockListener).onStartContext(anyInt(), eq("SystemContextViewDslContext"));
        checkOrder.verify(mockListener).onEndContext(anyInt(), eq("SystemContextViewDslContext"));

        // ...

        checkOrder.verify(mockListener).onEndContext(anyInt(), eq("ViewsDslContext"));
        checkOrder.verify(mockListener).onEndContext(anyInt(), eq("WorkspaceDslContext"));

    }

    @Test
    void parsedModelElements() throws StructurizrDslParserException {

        parser.parse(testFile);


        checkOrder.verify(mockListener).onIdentifier(eq("businessUser"));
        checkOrder.verify(mockListener).onParsedModelElement(any(Person.class));

        checkOrder.verify(mockListener).onIdentifier(eq("configurationUser"));
        checkOrder.verify(mockListener).onParsedModelElement(any(Person.class));

        checkOrder.verify(mockListener).onIdentifier(eq("financialRiskSystem"));
        checkOrder.verify(mockListener).onParsedModelElement(any(SoftwareSystem.class));

        checkOrder.verify(mockListener).onIdentifier(eq("tradeDataSystem"));
        checkOrder.verify(mockListener).onParsedModelElement(any(SoftwareSystem.class));

        checkOrder.verify(mockListener).onIdentifier(eq("referenceDataSystem"));
        checkOrder.verify(mockListener).onParsedModelElement(any(SoftwareSystem.class));

        checkOrder.verify(mockListener).onIdentifier(eq("referenceDataSystemV2"));
        checkOrder.verify(mockListener).onParsedModelElement(any(SoftwareSystem.class));

        checkOrder.verify(mockListener).onIdentifier(eq("emailSystem"));
        checkOrder.verify(mockListener).onParsedModelElement(any(SoftwareSystem.class));

        checkOrder.verify(mockListener).onIdentifier(eq("centralMonitoringService"));
        checkOrder.verify(mockListener).onParsedModelElement(any(SoftwareSystem.class));

        checkOrder.verify(mockListener).onIdentifier(eq("activeDirectory"));
        checkOrder.verify(mockListener).onParsedModelElement(any(SoftwareSystem.class));
    }

    @Test
    void parsedRelationships() throws StructurizrDslParserException {

        parser.parse(testFile);

        checkOrder.verify(mockListener).onParsedRelationShip(any());

        checkOrder.verify(mockListener).onParsedRelationShip(any());

        checkOrder.verify(mockListener).onParsedRelationShip(any());

        checkOrder.verify(mockListener).onParsedRelationShip(any());

        checkOrder.verify(mockListener).onParsedRelationShip(any());

        checkOrder.verify(mockListener).onParsedRelationShip(any());

        checkOrder.verify(mockListener).onParsedRelationShip(any());

        checkOrder.verify(mockListener).onParsedRelationShip(any());

        checkOrder.verify(mockListener).onParsedRelationShip(any());
    }

    @Test
    void parseColor() throws StructurizrDslParserException {

        parser.parse(testFile);

        checkOrder.verify(mockListener).onParsedColor();

        checkOrder.verify(mockListener).onParsedColor();

        checkOrder.verify(mockListener).onParsedColor();

        checkOrder.verify(mockListener).onParsedColor();

        checkOrder.verify(mockListener).onParsedColor();

        checkOrder.verify(mockListener).onParsedColor();
    }

    @Test
    void parseViews() throws StructurizrDslParserException {

        parser.parse(testFile);

        checkOrder.verify(mockListener).onParsedView(any(SystemContextView.class));
    }

    @Test
    void parseInclude() throws StructurizrDslParserException {

        File includeFile = new File(C4TestHelper.PATH_INCLUDE_MODELS + "/" + "include-test.dsl");

        File includedModelFile = new File(C4TestHelper.PATH_INCLUDE_MODELS + "/" + "subFolder" + "/" + "model.dsl");
        File includedStylesFile = new File(C4TestHelper.PATH_INCLUDE_MODELS + "/" + "subFolder" + "/" + "styles.dsl");

        parser.parse(includeFile);

        checkOrder.verify(mockListener).onInclude(eq(includedModelFile), eq("subFolder/model.dsl"));

        checkOrder.verify(mockListener).onInclude(eq(includedStylesFile), eq("subFolder/styles.dsl"));
    }

    @Test
    void parseScript() throws StructurizrDslParserException {

        File scriptDslFile = new File(C4TestHelper.PATH_SCRIPT_MODELS + "/" + "script-groovy.dsl");

        parser.parse(scriptDslFile);

        verify(mockListener, times(1)).onRunScript(anyList());
    }

}
