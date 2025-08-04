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

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;

import java.io.File;
import java.io.IOException;
import java.net.URISyntaxException;
import java.util.List;

import org.eclipse.lsp4j.ColorInformation;
import org.eclipse.lsp4j.Position;
import org.eclipse.lsp4j.Range;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import com.google.inject.AbstractModule;
import com.google.inject.Guice;
import com.google.inject.Module;

import ru.beeatlas.c4.helper.C4TestHelper;
import ru.beeatlas.c4.intercept.InterceptParserAspect;
import ru.beeatlas.c4.intercept.StructurizrDslParserListener;
import ru.beeatlas.c4.model.C4DocumentManager;
import ru.beeatlas.c4.model.C4DocumentModel;

import static org.aspectj.lang.Aspects.*;

public class C4ColorProviderTest {

    private C4DocumentManager documentManager;

    @BeforeEach
    public void initialize() throws IOException, URISyntaxException {

        Module testModule = new AbstractModule() {

            @Override
            protected void configure() {                
                documentManager = new C4DocumentManager();
                bind(StructurizrDslParserListener.class).toInstance(documentManager);
                requestInjection(aspectOf(InterceptParserAspect.class));
            }
            
        };

        Guice.createInjector(testModule);
    }

    @Test
    public void calcDocumentColors() throws IOException, URISyntaxException {

        C4DocumentModel document = C4TestHelper.createDocumentFromFile( new File(C4TestHelper.PATH_VALID_MODELS + File.separator + "amazon_web_service.dsl"), documentManager);

        assertDoesNotThrow( () -> {
            List<ColorInformation> result = document.getColorInformation();
            assertEquals(1, result.size());

            assertEquals(1.0, result.get(0).getColor().getRed());
            assertEquals(1.0, result.get(0).getColor().getGreen());
            assertEquals(1.0, result.get(0).getColor().getBlue());

            assertEquals(new Range(new Position(44, 27), new Position(44, 34)), result.get(0).getRange());
        });

    }

}