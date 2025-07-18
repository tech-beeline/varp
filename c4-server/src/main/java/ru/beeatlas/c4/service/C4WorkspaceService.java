package ru.beeatlas.c4.service;

import java.util.concurrent.CompletableFuture;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;

import ru.beeatlas.c4.dto.C4UpdateViewDto;
import ru.beeatlas.c4.commands.C4ExecuteCommandProvider;
import ru.beeatlas.c4.commands.C4ExecuteCommandResult;
import ru.beeatlas.c4.custom.Custom;

import org.eclipse.lsp4j.DidChangeConfigurationParams;
import org.eclipse.lsp4j.DidChangeWatchedFilesParams;
import org.eclipse.lsp4j.DidChangeWorkspaceFoldersParams;
import org.eclipse.lsp4j.ExecuteCommandParams;
import org.eclipse.lsp4j.services.WorkspaceService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class C4WorkspaceService implements WorkspaceService {

	private static final Logger logger = LoggerFactory.getLogger(C4WorkspaceService.class);
	private C4TextDocumentService documentService;

	public C4WorkspaceService(C4TextDocumentService documentService) {
		this.documentService = documentService;
	}

	@Override
	public void didChangeConfiguration(DidChangeConfigurationParams params) {
		logger.info("didChangeConfiguration");
	}

	@Override
	public void didChangeWatchedFiles(DidChangeWatchedFilesParams params) {
		logger.info("didChangeWatchedFiles");
	}

	@Override
	public void didChangeWorkspaceFolders(DidChangeWorkspaceFoldersParams params) {
		logger.info("didChangeWorkspaceFolders");
		WorkspaceService.super.didChangeWorkspaceFolders(params);
	}

	@Override
	public CompletableFuture<Object> executeCommand(ExecuteCommandParams params) {
		return CompletableFuture.supplyAsync(() -> {
			logger.info("executeCommand {}", params.getCommand());
			switch (params.getCommand()) {
				case C4ExecuteCommandProvider.UPDATE_CONFIGURATION : {
					String beelineApiUrl = ((JsonObject) params.getArguments().get(0)).get("beelineApiUrl").getAsJsonPrimitive().getAsString();
					String beelineApiSecret = ((JsonObject) params.getArguments().get(0)).get("beelineApiSecret").getAsJsonPrimitive().getAsString();
					String beelineApiKey = ((JsonObject) params.getArguments().get(0)).get("beelineApiKey").getAsJsonPrimitive().getAsString();
					String beelineCloudUrl = ((JsonObject) params.getArguments().get(0)).get("beelineCloudUrl").getAsJsonPrimitive().getAsString();
					String beelineCloudToken = ((JsonObject) params.getArguments().get(0)).get("beelineCloudToken").getAsJsonPrimitive().getAsString();
					boolean noTLS = ((JsonObject) params.getArguments().get(0)).get("noTLS").getAsJsonPrimitive().getAsBoolean();
					boolean serverLogsEnabled = ((JsonObject) params.getArguments().get(0)).get("serverLogsEnabled").getAsJsonPrimitive().getAsBoolean();
					Custom.getInstance().setNoTLS(noTLS);
					Custom.getInstance().setBeelineApiUrl(beelineApiUrl);
					Custom.getInstance().setBeelineCloudUrl(beelineCloudUrl);
					Custom.getInstance().setBeelineCloudToken(beelineCloudToken);
					Custom.getInstance().setServerLogsEnabled(serverLogsEnabled);
					Custom.getInstance().setBeelineApiSecret(beelineApiSecret);
					Custom.getInstance().setBeelineApiKey(beelineApiKey);
					Custom.getInstance().reinit();
					return C4ExecuteCommandResult.OK;
				}
				case C4ExecuteCommandProvider.CALCULATE_TEXT_DECORATIONS:
					JsonElement decorations = documentService
							.textDecorations((JsonObject) params.getArguments().get(0));
					return C4ExecuteCommandResult.TEXT_DECORATIONS.setResultData(decorations).toJson();
				case C4ExecuteCommandProvider.REFRESH_PREVIEW:
					String encodedContent = documentService
							.getUpdatedView(C4UpdateViewDto.fromJson((JsonObject) params.getArguments().get(0)));
					return C4ExecuteCommandResult.OK.setMessage(encodedContent).toJson();
				case C4ExecuteCommandProvider.AUTO_FORMAT_INDENT:
					var newIndent = ((JsonObject) params.getArguments().get(0)).get("indent").getAsJsonPrimitive()
							.getAsInt();
					documentService.setNewIndent(newIndent);
					return C4ExecuteCommandResult.OK;
				case C4ExecuteCommandProvider.SEND_SNIPPET_TELEMETRY:
					String langId = ((JsonObject) params.getArguments().get(0)).get("langId").getAsJsonPrimitive()
							.getAsString();
					String snippetId = ((JsonObject) params.getArguments().get(0)).get("name").getAsJsonPrimitive()
							.getAsString();
					Custom.getInstance().snippetTelemetry(langId + "." + snippetId);
					return C4ExecuteCommandResult.OK;
				case C4ExecuteCommandProvider.SEND_DEPLOYMENT_TELEMETRY:
					Custom.getInstance().deploymentTelemetry();
					return C4ExecuteCommandResult.OK;
				default:
					return C4ExecuteCommandProvider.execute(params.getCommand(), params.getArguments(), null).toJson();
			}
		});

	}
}
