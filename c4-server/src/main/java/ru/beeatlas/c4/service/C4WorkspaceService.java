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

import java.util.concurrent.CompletableFuture;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.structurizr.Workspace;
import com.structurizr.export.Diagram;
import com.structurizr.util.WorkspaceUtils;
import com.structurizr.view.ModelView;
import com.structurizr.view.ThemeUtils;
import com.structurizr.view.View;

import ru.beeatlas.c4.dto.RefreshOptions;
import ru.beeatlas.c4.utils.C4Utils;
import ru.beeatlas.c4.utils.MxExporter;
import ru.beeatlas.c4.utils.SVGReader;
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
	private SVGReader svgReader = new SVGReader(400, true);

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
					boolean beelineNoTelemetry = ((JsonObject) params.getArguments().get(0)).get("beelineNoTelemetry").getAsJsonPrimitive().getAsBoolean();
					Custom.getInstance().setNoTLS(noTLS);
					Custom.getInstance().setBeelineNoTelemetry(beelineNoTelemetry);
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
				case C4ExecuteCommandProvider.REFRESH_PREVIEW: {
					RefreshOptions refreshOptions = RefreshOptions.fromJson((JsonObject) params.getArguments().get(0));
					Workspace workspace = documentService.getWorkspace(refreshOptions.document());
					try {
						String jsonContent = WorkspaceUtils.toJson(workspace, false);
						return C4ExecuteCommandResult.OK.setMessage(jsonContent).toJson();
					} catch (Exception e) {
						return C4ExecuteCommandResult.OK;
					}
				}
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
				case C4ExecuteCommandProvider.WORKSPACE_2_DOT: {
					RefreshOptions refreshOptions = RefreshOptions.fromJson((JsonObject) params.getArguments().get(0));
					Workspace workspace = documentService.getWorkspace(refreshOptions.document());
					View view = workspace.getViews().getViewWithKey(refreshOptions.viewKey());
					if (view != null && view instanceof ModelView) {
						ModelView modelView = (ModelView) view;
						String dot = C4Utils.export2Dot(modelView);
						return C4ExecuteCommandResult.OK.setMessage(dot).toJson();
					}
					return C4ExecuteCommandResult.OK;
				}
				case C4ExecuteCommandProvider.SVG_LAYOUT: {
					RefreshOptions refreshOptions = RefreshOptions.fromJson((JsonObject) params.getArguments().get(0));
					Workspace workspace = documentService.getWorkspace(refreshOptions.document());
					if(workspace == null) {
						return C4ExecuteCommandResult.OK;
					}
					View view = workspace.getViews().getViewWithKey(refreshOptions.viewKey());
					try {
						if (view != null && view instanceof ModelView) {
							svgReader.parseAndApplyLayout((ModelView) view, refreshOptions.svg());
						}
						String jsonContent = WorkspaceUtils.toJson(workspace, false);
						return C4ExecuteCommandResult.OK.setMessage(jsonContent).toJson();
					} catch (Exception e) {
						return C4ExecuteCommandResult.OK;
					}
				}
				case C4ExecuteCommandProvider.VIEW_2_MX: {
					RefreshOptions refreshOptions = RefreshOptions.fromJson((JsonObject) params.getArguments().get(0));
					Workspace workspace = documentService.getWorkspace(refreshOptions.document());
					if(workspace == null) {
						return C4ExecuteCommandResult.OK;
					}
					try {
						ThemeUtils.loadThemes(workspace);
					} catch (Exception e) {
						logger.error(e.getMessage());
					}
					workspace.getViews().getConfiguration().getThemes();
					View view = workspace.getViews().getViewWithKey(refreshOptions.viewKey());
					try {
						if (view != null && view instanceof ModelView) {
							ModelView modelView = (ModelView)view;
							String content = C4Utils.export2Mx(modelView);
							return C4ExecuteCommandResult.OK.setMessage(content).toJson();	
						}
						return C4ExecuteCommandResult.OK;
					} catch (Exception e) {
						return C4ExecuteCommandResult.OK;
					}
				}				
				default:
					return C4ExecuteCommandProvider.execute(params.getCommand(), params.getArguments(), null).toJson();
			}
		});

	}
}
