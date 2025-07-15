package ru.beeatlas.c4.helper;

import java.io.File;
import java.io.IOException;
import java.net.URISyntaxException;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.util.Arrays;
import java.util.List;

import org.eclipse.lsp4j.TextDocumentIdentifier;

import ru.beeatlas.c4.model.C4DocumentManager;
import ru.beeatlas.c4.model.C4DocumentModel;

public class C4TestHelper {
    
    public static List<String> MODELS_TO_TEST = Arrays.asList("amazon_web_service.dsl", "big_bank.dsl", "financial_risk.dsl");

    public static String PATH_INVALID_MODELS = String.join(File.separator, Arrays.asList("src", "test", "java", "resources", "invalid"));

    public static String PATH_VALID_MODELS = String.join(File.separator, Arrays.asList("src", "test", "java", "resources", "valid"));

    public static String PATH_INCLUDE_MODELS = String.join(File.separator, Arrays.asList("src", "test", "java", "resources", "include"));

    public static String PATH_SCRIPT_MODELS = String.join(File.separator, Arrays.asList("src", "test", "java", "resources", "scripts"));

    public static C4DocumentModel createDocumentFromFile(File file, C4DocumentManager documentManager) throws IOException, URISyntaxException {
        String content = new String(Files.readAllBytes(Paths.get(file.getAbsolutePath())));
        documentManager.calcDiagnostics(file, content);
        TextDocumentIdentifier documentId = new TextDocumentIdentifier(file.toURI().toURL().toString());
        return documentManager.getDocument(documentId);
    }


}
