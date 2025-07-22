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

import java.io.File;
import java.io.IOException;
import java.net.URISyntaxException;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import com.google.inject.AbstractModule;
import com.google.inject.Module;

import ru.beeatlas.c4.generator.C4Generator;
import ru.beeatlas.c4.helper.C4TestHelper;
import ru.beeatlas.c4.intercept.InterceptParserAspect;
import ru.beeatlas.c4.intercept.StructurizrDslParserListener;
import ru.beeatlas.c4.model.C4DocumentManager;

import com.google.inject.Guice;

import static org.aspectj.lang.Aspects.*;
import static org.junit.jupiter.api.Assertions.assertNotNull;

public class C4ViewProviderTest {
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
    void testGetView_OK() {        
        File testFile = new File(C4TestHelper.PATH_VALID_MODELS + File.separator + "amazon_web_service.dsl");
        try {
            final String resultStructurizr = C4Generator.generateEncodedWorkspace(C4TestHelper.createDocumentFromFile(testFile, documentManager).getWorkspace());
            assertNotNull(resultStructurizr);
        } catch (Exception e) {
            e.printStackTrace();
        }
    }
}
