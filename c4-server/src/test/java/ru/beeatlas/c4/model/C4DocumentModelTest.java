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

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.File;
import java.io.IOException;
import java.net.URISyntaxException;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.util.List;
import java.util.stream.Collectors;

import com.google.inject.AbstractModule;
import com.google.inject.Guice;
import com.google.inject.Module;
import com.structurizr.model.SoftwareSystem;

import ru.beeatlas.c4.helper.C4TestHelper;
import ru.beeatlas.c4.intercept.InterceptParserAspect;
import ru.beeatlas.c4.intercept.StructurizrDslParserListener;

import org.eclipse.lsp4j.PublishDiagnosticsParams;
import org.eclipse.lsp4j.TextDocumentIdentifier;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import static org.aspectj.lang.Aspects.*;

public class C4DocumentModelTest {

    protected C4DocumentManager documentManager;

    @BeforeEach
    public void setupDI() {

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
    public void calcDiagnosticsValidModels() throws IOException {

        C4TestHelper.MODELS_TO_TEST.forEach( model -> {
            File testFile = new File(C4TestHelper.PATH_VALID_MODELS + File.separator + model);
            String content;
            try {
                content = new String(Files.readAllBytes(Paths.get(testFile.getAbsolutePath())));
                List<PublishDiagnosticsParams> errors = documentManager.calcDiagnostics(testFile, content);
                assertEquals(0, errors.get(0).getDiagnostics().size());
            } 
            catch (IOException e) {
                e.printStackTrace();
            }    
        });

    }

    @Test
    public void calcDiagnosticsInValidModels() throws IOException {

        C4TestHelper.MODELS_TO_TEST.forEach( model -> {
            File testFile = new File(C4TestHelper.PATH_INVALID_MODELS + File.separator + model);
            String content;
            try {
                content = new String(Files.readAllBytes(Paths.get(testFile.getAbsolutePath())));
                List<PublishDiagnosticsParams> errors = documentManager.calcDiagnostics(testFile, content);
                assertEquals(1, errors.get(0).getDiagnostics().size());
            } 
            catch (IOException e) {
                e.printStackTrace();
            }    
        });
    }

    @Test
    public void getDocument() throws IOException {

        File testFile = new File(C4TestHelper.PATH_VALID_MODELS + File.separator + "c4-dsl-extension.dsl");
        String content = new String(Files.readAllBytes(Paths.get(testFile.getAbsolutePath())));
        documentManager.calcDiagnostics(testFile, content);

        TextDocumentIdentifier documentId = new TextDocumentIdentifier(testFile.toURI().toURL().toString());
        try {
            C4DocumentModel model = documentManager.getDocument(documentId);

            assertEquals(3, model.getAllViews().size());
            assertTrue(model.getViewAtLineNumber(72).isPresent());
            assertTrue(model.getViewAtLineNumber(78).isPresent());
            assertTrue(model.getViewAtLineNumber(84).isPresent());

            assertFalse(model.getViewAtLineNumber(88).isPresent());

            assertEquals(2, model.getAllElements().stream().filter(ele -> (ele.getValue().getObject() instanceof SoftwareSystem)).collect(Collectors.toList()).size());

            assertEquals(17, model.getRelationshipsCount());

        } catch (URISyntaxException e) {
            e.printStackTrace();
        }

    }
}
