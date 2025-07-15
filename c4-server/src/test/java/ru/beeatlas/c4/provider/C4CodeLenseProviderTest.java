package ru.beeatlas.c4.provider;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;

import java.io.File;
import java.io.IOException;
import java.net.URISyntaxException;
import java.util.List;

import org.eclipse.lsp4j.CodeLens;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import com.google.inject.AbstractModule;
import com.google.inject.Guice;
import com.google.inject.Module;

import ru.beeatlas.c4.helper.C4TestHelper;
import ru.beeatlas.c4.intercept.InterceptParserAspect;
import ru.beeatlas.c4.intercept.StructurizrDslParserListener;
import ru.beeatlas.c4.model.C4DocumentManager;

import static org.aspectj.lang.Aspects.*;


public class C4CodeLenseProviderTest {

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
    public void noCodeLenses() {
        
        C4TestHelper.MODELS_TO_TEST.forEach( model -> {
            File testFile = new File(C4TestHelper.PATH_INVALID_MODELS + File.separator + model);
            try {
                List<CodeLens> codeLenses = C4TestHelper.createDocumentFromFile(testFile, documentManager).calcCodeLenses();
                assertEquals(0, codeLenses.size());
            } 
            catch (IOException | URISyntaxException e) {
                e.printStackTrace();
            }    
        });
    }

    @Test
    public void codeLensesStrcuturizr() {

        File testFile = new File(C4TestHelper.PATH_VALID_MODELS + File.separator + "amazon_web_service.dsl");
        try {
            List<CodeLens> codeLenses = C4TestHelper.createDocumentFromFile(testFile, documentManager).calcCodeLenses();

            assertEquals(1, codeLenses.size());

            assertEquals("c4.show.diagram", codeLenses.get(0).getCommand().getCommand());
            assertEquals(36, codeLenses.get(0).getRange().getStart().getLine());
            assertEquals(8, codeLenses.get(0).getRange().getStart().getCharacter());
            assertEquals(36, codeLenses.get(0).getRange().getEnd().getLine());
            assertEquals(8, codeLenses.get(0).getRange().getEnd().getCharacter());

            assertNotNull(codeLenses.get(0).getCommand().getArguments().get(0));

            assertEquals("AmazonWebServicesDeployment",codeLenses.get(0).getCommand().getArguments().get(1));

        } 
        catch (IOException | URISyntaxException e) {
            e.printStackTrace();
        }
    }

}
