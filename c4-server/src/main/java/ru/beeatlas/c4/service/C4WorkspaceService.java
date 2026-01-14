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

import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonPrimitive;
import com.structurizr.Workspace;
import com.structurizr.util.WorkspaceUtils;
import com.structurizr.view.ModelView;
import com.structurizr.view.ThemeUtils;
import com.structurizr.view.View;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.LoggerContext;
import ch.qos.logback.classic.PatternLayout;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.encoder.LayoutWrappingEncoder;
import ru.beeatlas.c4.dto.RefreshOptions;
import ru.beeatlas.c4.utils.C4Utils;
import ru.beeatlas.c4.utils.ClientAppender;
import ru.beeatlas.c4.utils.MxReader;
import ru.beeatlas.c4.utils.SVGReader;
import ru.beeatlas.c4.commands.C4ExecuteCommandProvider;
import ru.beeatlas.c4.commands.C4ExecuteCommandResult;
import ru.beeatlas.c4.custom.Custom;

import org.eclipse.lsp4j.ConfigurationItem;
import org.eclipse.lsp4j.ConfigurationParams;
import org.eclipse.lsp4j.DidChangeConfigurationParams;
import org.eclipse.lsp4j.DidChangeWatchedFilesParams;
import org.eclipse.lsp4j.DidChangeWorkspaceFoldersParams;
import org.eclipse.lsp4j.ExecuteCommandParams;
import org.eclipse.lsp4j.services.LanguageClient;
import org.eclipse.lsp4j.services.WorkspaceService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class C4WorkspaceService implements WorkspaceService {

	private static final Logger logger = LoggerFactory.getLogger(C4WorkspaceService.class);
	private C4TextDocumentService documentService;
	private SVGReader svgReader = new SVGReader(400, true);
	private MxReader mxReader = new MxReader(400, true);

	private PatternLayout pattern = new PatternLayout();
    private LayoutWrappingEncoder<ILoggingEvent> encoder = new LayoutWrappingEncoder<>();
    private ClientAppender<ILoggingEvent> clientAppender = new ClientAppender<>();

	public C4WorkspaceService(C4TextDocumentService documentService) {
		this.documentService = documentService;
        LoggerContext loggerContext = (LoggerContext) LoggerFactory.getILoggerFactory();
        pattern.setContext(loggerContext);
        pattern.setPattern("%d{yyyy-MM-dd HH:mm:ss.SSS} [%-5level] %logger{0} - %msg");
        pattern.start();

        encoder.setContext(loggerContext);
        encoder.setCharset(StandardCharsets.UTF_8);
        encoder.setLayout(pattern);

        clientAppender.setEncoder(encoder);
        clientAppender.setContext(loggerContext);		
	}

	void toggleLog() {
        ConfigurationItem serverLogsEnabledItem = new ConfigurationItem();
        serverLogsEnabledItem.setSection("c4.languageserver.logs.enabled");
        ConfigurationParams configurationParams = new ConfigurationParams(Arrays.asList(serverLogsEnabledItem));

        boolean serverLogsEnabled = false;
		LanguageClient client = documentService.getServer().getClient();

        try {
            List<Object> values = client.configuration(configurationParams).get();
            serverLogsEnabled = ((JsonPrimitive)values.get(0)).getAsBoolean();
        } catch (Exception e) {
            logger.debug(e.getMessage());
        }
        LoggerContext loggerContext = (LoggerContext) LoggerFactory.getILoggerFactory(); 
        ch.qos.logback.classic.Logger log = loggerContext.getLogger(Logger.ROOT_LOGGER_NAME);             
        if(serverLogsEnabled) {
            if(!log.isAttached(clientAppender)) {
                clientAppender.setClient(client);                
                clientAppender.start();

                log.setAdditive(false);
                log.setLevel(Level.DEBUG);
                log.addAppender(clientAppender);
                logger.info("Start logging...");
            }
        } else {
            if(log.isAttached(clientAppender)) {
                logger.info("Stop logging...");
                log.setLevel(Level.OFF);
                log.detachAndStopAllAppenders();
            }
        }
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
					toggleLog();
					String version = ((JsonObject) params.getArguments().get(0)).get("version").getAsJsonPrimitive().getAsString();
					Custom.getInstance().setVersion(version);
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
					if(workspace == null) {
						return C4ExecuteCommandResult.OK;
					}
					try {
						String jsonContent = WorkspaceUtils.toJson(workspace, false);
						return C4ExecuteCommandResult.OK.setMessage(jsonContent).toJson();
					} catch (Exception e) {
						logger.error(e.getMessage());
					}
					return C4ExecuteCommandResult.OK;
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
					if(workspace == null) {
						return C4ExecuteCommandResult.OK;
					}				
					View view = workspace.getViews().getViewWithKey(refreshOptions.viewKey());
					if (view != null && view instanceof ModelView modelView && modelView.getAutomaticLayout() != null) {
						String dot = C4Utils.export2Dot(modelView);
						return C4ExecuteCommandResult.OK.setMessage(dot).toJson();
					}
					return C4ExecuteCommandResult.OK;
				}
				case C4ExecuteCommandProvider.GET_JSON: {
					RefreshOptions refreshOptions = RefreshOptions.fromJson((JsonObject) params.getArguments().get(0));
					Workspace workspace = documentService.getWorkspace(refreshOptions.document());
					if(workspace == null) {
						return C4ExecuteCommandResult.OK;
					}
					String originalWorkspaceJson = "";
					String renderedWorkspaceJson = "";
					String viewKey = refreshOptions.viewKey();
					try {
						if (viewKey == null) {
							// no view key - return workspace json as is
							renderedWorkspaceJson = WorkspaceUtils.toJson(workspace, false);
						} else {
							View view = workspace.getViews().getViewWithKey(viewKey);
							if(view != null && view instanceof ModelView modelView) {
								if (refreshOptions.svg() != null) {
									// autolayout from svg
									// keep original workspace as json before applying
									originalWorkspaceJson = WorkspaceUtils.toJson(workspace, false);
									svgReader.parseAndApplyLayout(modelView, refreshOptions.svg());
									renderedWorkspaceJson = WorkspaceUtils.toJson(workspace, false);
								} else if (refreshOptions.mx() != null) {
									// layout from drawio
									// apply and return json
									mxReader.parseAndApplyLayout(modelView, refreshOptions.mx());
									renderedWorkspaceJson = WorkspaceUtils.toJson(workspace, false);
								} else {
									// no autolayout, no import layout from drawio
									// return json
									renderedWorkspaceJson = WorkspaceUtils.toJson(workspace, false);
								}								
							} else {
								// no view to render - return workspace json as is
								renderedWorkspaceJson = WorkspaceUtils.toJson(workspace, false);								
							}
						}
					} catch (Exception e) {
						logger.error(e.getMessage());
						return C4ExecuteCommandResult.OK;
					}
					if(!originalWorkspaceJson.isEmpty()) {
						try {
							// try to restore workspace to its original state (before applying autolayout)
							Workspace originalWorkspace = WorkspaceUtils.fromJson(originalWorkspaceJson);
							workspace.getViews().copyLayoutInformationFrom(originalWorkspace.getViews());	
						} catch (Exception e) {
						}
					}
					return C4ExecuteCommandResult.OK.setMessage(renderedWorkspaceJson).toJson();
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
						if (view != null && view instanceof ModelView modelView) {
							String content = C4Utils.export2Mx(modelView);
							return C4ExecuteCommandResult.OK.setMessage(content).toJson();	
						}
					} catch (Exception e) {
						logger.error(e.getMessage());
					}
					return C4ExecuteCommandResult.OK;
				}
				case C4ExecuteCommandProvider.SEND_PATTERN_TELEMETRY: {
					String patternId = ((JsonObject) params.getArguments().get(0)).get("patternId").getAsJsonPrimitive()
							.getAsString();
					String action = ((JsonObject) params.getArguments().get(0)).get("action").getAsJsonPrimitive()
							.getAsString();							
					Custom.getInstance().patternTelemetry(patternId, action);
					return C4ExecuteCommandResult.OK;
				}
				default:
					return C4ExecuteCommandProvider.execute(params.getCommand(), params.getArguments(), null).toJson();
			}
		});

	}
}
