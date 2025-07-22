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

package ru.beeatlas.c4.service;

import java.io.File;
import java.net.URI;
import java.net.URISyntaxException;
import java.util.Collections;
import java.util.List;
import java.util.Set;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.Executors;
import java.util.concurrent.ExecutorService;
import org.eclipse.lsp4j.CodeLens;
import org.eclipse.lsp4j.CodeLensParams;
import org.eclipse.lsp4j.Color;
import org.eclipse.lsp4j.ColorInformation;
import org.eclipse.lsp4j.ColorPresentation;
import org.eclipse.lsp4j.ColorPresentationParams;
import org.eclipse.lsp4j.CompletionItem;
import org.eclipse.lsp4j.CompletionList;
import org.eclipse.lsp4j.CompletionParams;
import org.eclipse.lsp4j.DefinitionParams;
import org.eclipse.lsp4j.DidChangeTextDocumentParams;
import org.eclipse.lsp4j.DidCloseTextDocumentParams;
import org.eclipse.lsp4j.DidOpenTextDocumentParams;
import org.eclipse.lsp4j.DidSaveTextDocumentParams;
import org.eclipse.lsp4j.DocumentColorParams;
import org.eclipse.lsp4j.DocumentFormattingParams;
import org.eclipse.lsp4j.Hover;
import org.eclipse.lsp4j.HoverParams;
import org.eclipse.lsp4j.Location;
import org.eclipse.lsp4j.LocationLink;
import org.eclipse.lsp4j.PublishDiagnosticsParams;
import org.eclipse.lsp4j.SemanticTokens;
import org.eclipse.lsp4j.SemanticTokensParams;
import org.eclipse.lsp4j.TextDocumentIdentifier;
import org.eclipse.lsp4j.TextEdit;
import org.eclipse.lsp4j.jsonrpc.messages.Either;
import org.eclipse.lsp4j.services.TextDocumentService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import com.google.gson.Gson;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.inject.AbstractModule;
import com.google.inject.Guice;
import com.google.inject.Module;
import com.structurizr.model.Element;

import ru.beeatlas.c4.custom.Custom;
import ru.beeatlas.c4.intercept.StructurizrDslParserListener;
import ru.beeatlas.c4.model.C4DocumentModel;
import ru.beeatlas.c4.model.C4ObjectWithContext;
import ru.beeatlas.c4.model.C4TokensLoader;
import ru.beeatlas.c4.provider.C4CompletionProvider;
import ru.beeatlas.c4.provider.C4DefinitionProvider;
import ru.beeatlas.c4.provider.C4FormatterProvider;
import ru.beeatlas.c4.provider.C4HoverProvider;
import ru.beeatlas.c4.dto.C4UpdateViewDto;
import ru.beeatlas.c4.generator.C4Generator;
import ru.beeatlas.c4.intercept.InterceptParserAspect;
import ru.beeatlas.c4.model.C4DocumentManager;

import static org.aspectj.lang.Aspects.*;

public class C4TextDocumentService implements TextDocumentService {

    private static final Logger logger = LoggerFactory.getLogger(C4TextDocumentService.class);
	private static final int DEFAULT_INDENT_FOR_FORMATTING = 4;

	private C4LanguageServer ls;

	private C4DocumentManager documentManager;

	private C4DefinitionProvider definitionProvider;
	private C4CompletionProvider completionProvider;
	private C4FormatterProvider formatterProvider;
	private C4HoverProvider hoverProvider;

	private int changeCount = 0;

	private Gson gson = new Gson();
	private CompletableFuture<Void> currentFuture = new CompletableFuture<>();
	private ExecutorService diagnosticService = Executors.newSingleThreadScheduledExecutor(); 

	public C4TextDocumentService(C4LanguageServer c4LanguageServer) {
		definitionProvider = new C4DefinitionProvider();
		completionProvider = new C4CompletionProvider(new C4TokensLoader());
		formatterProvider = new C4FormatterProvider(DEFAULT_INDENT_FOR_FORMATTING);
		hoverProvider = new C4HoverProvider();
		this.ls = c4LanguageServer;
		setUpDependencies();
	}

	private void setUpDependencies() {
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

	@Override
	public CompletableFuture<Hover> hover(HoverParams params) {
		return params.getTextDocument().getUri().toLowerCase().endsWith(".dsl") ? CompletableFuture.supplyAsync(() -> {
			C4DocumentModel model = getDocument(params.getTextDocument());
			if (model == null) {
				return null;
			}
			if (!model.isValid()) {
				return null;
			}
			try {
				return hoverProvider.calcHover(model, params);
			} finally {
			}
		}) : null;
	}

	@Override
	public CompletableFuture<Either<List<CompletionItem>, CompletionList>> completion(CompletionParams params) {
		return CompletableFuture.supplyAsync(() -> {
			String uri = params.getTextDocument().getUri();
			if (uri.length() < 3) {
				return Either.forLeft(Collections.emptyList());	
			}
			if(uri.substring(uri.length() - 3).equalsIgnoreCase(".md")) {
				return Either.forLeft(Custom.getInstance().calcCompletionsAdr(uri, params.getPosition()));
			}			
			C4DocumentModel model = getDocument(params.getTextDocument());
			if(model == null) {
				return Either.forLeft(Collections.emptyList());	
			}
			if(!model.isValid()) {
				return Either.forLeft(Collections.emptyList());	
			}
			try {
				return Either.forLeft(completionProvider.calcCompletions(model, params.getPosition(), getElements()));
			} finally {
			}			
		});

	}

	@Override
	public CompletableFuture<List<ColorInformation>> documentColor(DocumentColorParams params) {

		String uri = params.getTextDocument().getUri();

		if (uri.length() < 3 || uri.substring(uri.length() - 3).equalsIgnoreCase(".md")) {
			return CompletableFuture.completedFuture(Collections.emptyList());
		}

		logger.info("documentColor");

		return CompletableFuture.supplyAsync(() -> {
			C4DocumentModel model = getDocument(params.getTextDocument());
			if (!model.isValid()) {
				return Collections.emptyList();
			}
			return model.getColorInformation();
		});
	}

	@Override
	public CompletableFuture<Either<List<? extends Location>, List<? extends LocationLink>>> definition(
			DefinitionParams params) {

		String uri = params.getTextDocument().getUri();

		if (uri.length() < 3 || uri.substring(uri.length() - 3).equalsIgnoreCase(".md")) {
			return CompletableFuture.completedFuture(Either.forLeft(Collections.emptyList()));
		}

		logger.info("definition");

		return CompletableFuture.supplyAsync(() -> {
			C4DocumentModel model = getDocument(params.getTextDocument());
			if(model == null) {
				return Either.forLeft(Collections.emptyList());	
			}
			if(!model.isValid()) {
				return Either.forLeft(Collections.emptyList());	
			}
			try {
				return definitionProvider.calcDefinitions(model, params);
			} finally {
			}
		});
	}

	private String colorToHex(Color color) {
		return String.format("#%02X%02X%02X", (int)(color.getRed()*255), (int)(color.getGreen()*255), (int)(color.getBlue()*255));
	}

	@Override
	public CompletableFuture<List<ColorPresentation>> colorPresentation(ColorPresentationParams params) {

		String uri = params.getTextDocument().getUri();

		if (uri.length() < 3 || uri.substring(uri.length() - 3).equalsIgnoreCase(".md")) {
			return CompletableFuture.completedFuture(Collections.emptyList());
		}

		logger.info("colorPresentation");

		return CompletableFuture.supplyAsync(() -> {
			try {
				return Collections.singletonList(new ColorPresentation(colorToHex(params.getColor())));
			} finally {
			}			
		});
	}

	@Override
	public CompletableFuture<SemanticTokens> semanticTokensFull(SemanticTokensParams params) {
		String uri = params.getTextDocument().getUri();

		if (uri.length() < 3 || uri.substring(uri.length() - 3).equalsIgnoreCase(".md")) {
			return CompletableFuture.completedFuture(new SemanticTokens(Collections.emptyList()));
		}

		logger.info("semanticTokensFull");

		return CompletableFuture.supplyAsync(() -> {
			C4DocumentModel model = getDocument(params.getTextDocument());
			if (model == null) {
				return new SemanticTokens(Collections.emptyList());
			}
			if (!model.isValid()) {
				return new SemanticTokens(Collections.emptyList());
			}
			try {
				return new SemanticTokens(model.calculateTokens());
			} finally {
			}
		});
	}

	@Override
	public CompletableFuture<List<? extends CodeLens>> codeLens(CodeLensParams params) {
		return params.getTextDocument().getUri().toLowerCase().endsWith(".dsl") ? CompletableFuture.supplyAsync(() -> {
			C4DocumentModel model = getDocument(params.getTextDocument());
			if (!model.isValid()) {
				return Collections.emptyList();
			}
			try {
				return model.calcCodeLenses();
			} finally {
			}
		}) : null;
	}

	@Override
	public CompletableFuture<List<? extends TextEdit>> formatting(DocumentFormattingParams params) {

		String uri = params.getTextDocument().getUri();

		if (uri.length() < 3 || uri.substring(uri.length() - 3).equalsIgnoreCase(".md")) {
			return CompletableFuture.completedFuture(Collections.emptyList());
		}

		logger.info("formatting");

		return CompletableFuture.supplyAsync(() -> {
			C4DocumentModel model = getDocument(params.getTextDocument());
			if (model == null) {
				return Collections.emptyList();
			}
			if (!model.isValid()) {
				return Collections.emptyList();
			}
			try {
				return formatterProvider.calculateFormattedTextEdits(model);
			} finally {
			}
		});
	}

	public JsonElement textDecorations(JsonObject options) {

		logger.info("textDecorations");

		String uri = options.get("uri").getAsString();

		if (uri.length() < 3 || uri.substring(uri.length() - 3).equalsIgnoreCase(".md")) {
			return null;
		}

		try {
			TextDocumentIdentifier documentId = new TextDocumentIdentifier(new File(uri).toURI().toURL().toString());
			currentFuture.join();
			C4DocumentModel model = getDocument(documentId);
			return model.isValid() ? gson.toJsonTree(model.calculateDecorations()) : null;
		} catch (Exception e) {
			return null;
		}
	}

	public String getUpdatedView(C4UpdateViewDto updateViewParams) {
		try {
			TextDocumentIdentifier documentId = new TextDocumentIdentifier(new File(updateViewParams.document()).toURI().toURL().toString());
			C4DocumentModel model = getDocument(documentId);
			return model.isValid() ? C4Generator.generateEncodedWorkspace(model.getWorkspace()) : null;
		} catch (Exception e) {
			return null;
		}
	}

	@Override
	public void didOpen(DidOpenTextDocumentParams params) {

		String uri = params.getTextDocument().getUri();

		logger.info("didOpen " + uri);

		if (uri.length() > 3 && uri.substring(uri.length() - 4).equalsIgnoreCase(".dsl")) {
			currentFuture.cancel(false);
			currentFuture = CompletableFuture.runAsync(() -> {
				List<PublishDiagnosticsParams> diagnostics = getDiagnostics(uri, params.getTextDocument().getText());
				diagnostics.forEach(d -> ls.getClient().publishDiagnostics(d));
			}, diagnosticService);
		} else {
			Custom.getInstance().didChange(uri, params.getTextDocument().getText());
		}
	}

	@Override
	public void didChange(DidChangeTextDocumentParams params) {
		String uri = params.getTextDocument().getUri();

		logger.info("didChange " + uri);

		if (uri.length() > 3 && uri.substring(uri.length() - 4).equalsIgnoreCase(".dsl")) {
			currentFuture.cancel(false);
			currentFuture = CompletableFuture.runAsync(() -> {
				getDiagnostics(uri, params.getContentChanges().get(0).getText())
						.forEach(d -> ls.getClient().publishDiagnostics(d));
			}, diagnosticService);			
		} else {
			Custom.getInstance().didChange(uri, params.getContentChanges().get(0).getText());
		}
	}

	private List<PublishDiagnosticsParams> getDiagnostics(String uri, String content) {
		
		logger.info("--> getDiagnostics {}", changeCount++);
		try {
			List<PublishDiagnosticsParams> diagnostics = documentManager.calcDiagnostics(uriToFile(uri), content);
			Custom.getInstance().processWorkspace(documentManager.getLastParsedWorkspace());
			return diagnostics;
		} catch (URISyntaxException e) {
			logger.error("getDiagnostics {}", e.getMessage());
			return Collections.emptyList();
		}
		finally {
			ls.getClient().refreshCodeLenses();
			logger.info("<-- getDiagnostics");
		}
	}

	private Set<C4ObjectWithContext<Element>> getElements() {

		logger.info("--> getElements");

		try {
			return documentManager.getElements();
		} catch (Exception e) {
			return null;
		}

		finally {
			logger.info("<-- getElements");
		}
	}

	private C4DocumentModel getDocument(TextDocumentIdentifier documentId) {

		logger.info("--> getDocument");

		try {
			return documentManager.getDocument(documentId);
		} catch (URISyntaxException e) {
			return null;
		}
		finally {
			logger.info("<-- getDocument");
		}
	}

	@Override
	public void didClose(DidCloseTextDocumentParams params) {
		logger.info("didClose " + params.getTextDocument().getUri());
	}

	@Override
	public void didSave(DidSaveTextDocumentParams params) {
		logger.info("didSave " + params.getTextDocument().getUri());
	}

	private File uriToFile(String uri) throws URISyntaxException {
		return new File(new URI(uri));
	}

    public void setNewIndent(int newIndent) {
		formatterProvider.updateIndent(newIndent);
    }

}
