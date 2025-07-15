package ru.beeatlas.c4.service;

import java.util.concurrent.CompletableFuture;
import org.eclipse.lsp4j.CodeLensOptions;
import org.eclipse.lsp4j.CompletionOptions;
import org.eclipse.lsp4j.ExecuteCommandOptions;
import org.eclipse.lsp4j.InitializeParams;
import org.eclipse.lsp4j.InitializeResult;
import org.eclipse.lsp4j.SemanticTokensLegend;
import org.eclipse.lsp4j.SemanticTokensWithRegistrationOptions;
import org.eclipse.lsp4j.ServerCapabilities;
import org.eclipse.lsp4j.SetTraceParams;
import org.eclipse.lsp4j.TextDocumentSyncKind;
import org.eclipse.lsp4j.services.LanguageClient;
import org.eclipse.lsp4j.services.LanguageClientAware;
import org.eclipse.lsp4j.services.LanguageServer;
import org.eclipse.lsp4j.services.TextDocumentService;
import org.eclipse.lsp4j.services.WorkspaceService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import ru.beeatlas.c4.commands.C4ExecuteCommandProvider;
import ru.beeatlas.c4.provider.C4SemanticTokenProvider;

public class C4LanguageServer implements LanguageServer, LanguageClientAware {

    private static final Logger logger = LoggerFactory.getLogger(C4LanguageServer.class);

	private LanguageClient client;
	private C4TextDocumentService documentService;
	private C4WorkspaceService workspaceService;
	private final InitializeResult res = new InitializeResult(new ServerCapabilities());	

	public C4LanguageServer() {
	
		this.documentService = new C4TextDocumentService(this);
		this.workspaceService = new C4WorkspaceService(this.documentService);

		res.getCapabilities().setCompletionProvider(new CompletionOptions());
		res.getCapabilities().setTextDocumentSync(TextDocumentSyncKind.Full);
		res.getCapabilities().setCodeLensProvider(new CodeLensOptions());
		res.getCapabilities().setHoverProvider(Boolean.TRUE);
		res.getCapabilities().setColorProvider(Boolean.TRUE);
		res.getCapabilities().setDefinitionProvider(Boolean.TRUE);
		res.getCapabilities().setDocumentFormattingProvider(Boolean.TRUE);
		SemanticTokensWithRegistrationOptions semanticTokenOptions = new SemanticTokensWithRegistrationOptions();
		semanticTokenOptions.setFull(true);
		SemanticTokensLegend legend = new SemanticTokensLegend(C4SemanticTokenProvider.TOKEN_TYPES, C4SemanticTokenProvider.TOKEN_MODIFIERS);
		semanticTokenOptions.setLegend(legend);
		res.getCapabilities().setSemanticTokensProvider(semanticTokenOptions);
		res.getCapabilities().setExecuteCommandProvider(new ExecuteCommandOptions(C4ExecuteCommandProvider.SERVER_COMMANDS));		
	}
	
	@Override
	public void connect(LanguageClient client) {
		logger.info("connect");		
		this.client = client;
	}	

	@Override
	public CompletableFuture<InitializeResult> initialize(InitializeParams params) {
		logger.info("initialize");
		return CompletableFuture.completedFuture(res);
	}

	@Override
	public CompletableFuture<Object> shutdown() {
		logger.info("shutdown");
		return CompletableFuture.supplyAsync(() -> Boolean.TRUE);
	}

	@Override
	public void exit() {
		logger.info("exit");
		System.exit(0);
		
	}

	@Override
	public TextDocumentService getTextDocumentService() {
		logger.info("getTextDocumentService");
		return this.documentService;
	}

	@Override
	public WorkspaceService getWorkspaceService() {
		logger.info("getWorkspaceService");
		return this.workspaceService;
	}

	public LanguageClient getClient() {
		return client;
	}

	@Override
	public void setTrace(SetTraceParams params) {
		logger.info("setTrace {}", params.getValue());
	}

}
