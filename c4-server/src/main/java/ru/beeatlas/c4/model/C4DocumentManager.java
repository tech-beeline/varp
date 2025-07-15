package ru.beeatlas.c4.model;

import java.io.File;
import java.io.IOException;
import java.net.URI;
import java.net.URISyntaxException;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.Stack;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicReference;

import org.eclipse.lsp4j.Diagnostic;
import org.eclipse.lsp4j.DiagnosticSeverity;
import org.eclipse.lsp4j.Position;
import org.eclipse.lsp4j.PublishDiagnosticsParams;
import org.eclipse.lsp4j.Range;
import org.eclipse.lsp4j.TextDocumentIdentifier;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import com.structurizr.Workspace;
import com.structurizr.dsl.DslPackage.Line;
import com.structurizr.dsl.StructurizrDslParser;
import com.structurizr.dsl.StructurizrDslParserException;
import com.structurizr.model.Element;
import com.structurizr.model.Relationship;
import com.structurizr.util.WorkspaceUtils;
import com.structurizr.view.View;
import com.structurizr.view.ViewSet;

import ru.beeatlas.c4.intercept.StructurizrDslParserListener;
import ru.beeatlas.c4.utils.C4Utils;

public class C4DocumentManager implements StructurizrDslParserListener {

	class ParseContext {
		public File file;
		public C4DocumentModel model;
		public int lineNumber;
		public String currentIdentifier;
		public String line;
		public LinkedList<Line> lines;
	}

    private static final Logger logger = LoggerFactory.getLogger(C4DocumentManager.class);

    private Map<String, C4DocumentModel> c4Models = new ConcurrentHashMap<>();
	private AtomicReference<Set<C4ObjectWithContext<Element>>> elements = new AtomicReference<>(new HashSet<>());

	private ParseContext context = null;
	private Stack<ParseContext> contextStack = new Stack<>();

	private Workspace jsonWorkspace = null;
	private long jsonModified = 0;

	private Map<File, String> fileContent = new HashMap<>();

	private Workspace lastParsedWorkspace = null;

	public Workspace getLastParsedWorkspace() {
		return lastParsedWorkspace;
	}

	public Set<C4ObjectWithContext<Element>> getElements() {
		return elements.get();
	}

    public C4DocumentModel getDocument(TextDocumentIdentifier documentId) throws URISyntaxException {
		File file = new File(new URI(documentId.getUri()));
		String path = file.getAbsolutePath();
		return Optional.ofNullable(c4Models.get(path)).orElse(new C4DocumentModel(path, true));
    }

	@Override
	public void onExtendsBy(File file) {
		C4DocumentModel extendsBy = getModel(file);
		context.model.setExtendsBy(extendsBy);
	}

	@Override
	public void onLines(LinkedList<Line> lines) {
		context.lines = lines;
	}

	@Override
	public void onNewLine() {
		if(context.lines != null) {
			Line line = context.lines.pollFirst();
			if(line != null) {
				context.line = line.source();
				context.lineNumber = line.lineNumber();
			}
		}
	}	

	@Override
	public void onIdentifier(String identifier) {
		context.currentIdentifier = identifier;
	}

	@Override
	public void onStartFile(File file) {
		contextStack.push(context);
		context = new ParseContext();
		context.file = file;
		context.model = getModel(file);
		context.model.clear();
	}

	@Override
	public void onEndFile() {
		context = contextStack.pop();
	}	

	@Override
	public void onParsedRelationShip(Relationship relationship) {
		if (relationship != null) {
			context.model.addRelationship(context.lineNumber, new C4ObjectWithContext<Relationship>(
					context.currentIdentifier, context.lineNumber, context.line, relationship, context.model));
		} else {
			logger.error("onParsedRelationShip() - Context is null");
		}
	}

	@Override
	public void onParsedModelElement(Element item) {
		if (context != null) {
			C4ObjectWithContext<Element> element = new C4ObjectWithContext<Element>(context.currentIdentifier, context.lineNumber, context.line, item, context.model);
			context.model.addElement(context.lineNumber, element);
			elements.get().add(element);
		} else {
			logger.error("onParsedModelElement() - Context is null");
		}
	}

	@Override
	public void onParsedView(View view) {
		if (context != null) {
			context.model.addView(context.lineNumber,
					new C4ObjectWithContext<View>(null, context.lineNumber, context.line, view, null));
		} else {
			logger.error("onParsedView() - Context is null");
		}
	}
	
	@Override
	public void onParsedColor() {
		if (context != null) {
			context.model.addColor(context.lineNumber, context.line);
		} else {
			logger.error("onParsedColor() - Context is null");
		}
	}
			
	@Override
	public void onInclude(File referencedFile, String path) {
		if (context != null) {
			context.model.addReferencedModel(getModel(referencedFile), context.lineNumber, path);
		} else {
			logger.error("onInclude() - Context is null");
		}
	}

	@Override
	public void onStartContext(int contextId, String contextName) {
		if (context != null) {
			context.model.openScope(context.lineNumber, contextId, contextName);
		} else {
			logger.error("onStartContext() - Context is null");
		}
	}

	@Override
	public void onEndContext(int contextId, String contextName) {
		if (context != null) {
			context.model.closeScope(context.lineNumber, contextId, contextName);
		} else {
			logger.error("onEndContext() - Context is null");
		}
	}

	@Override
	public void onException(StructurizrDslParserException e) throws StructurizrDslParserException {
		logger.debug("Rethrow exception {}", e.getMessage());
		throw e;
	}

	@Override
	public void onParsedProperty(String name, String value) {
		if(context != null) {
			context.model.addProperty(new C4Property(context.lineNumber, name, value));
		} else {
			logger.error("onParsedProperty() - Context is null");
		}
	}

	@Override
	public String findContent(File file) { 
		return fileContent.get(file);
	}

	private C4DocumentModel getModel(File _file) {
		String file = _file.getAbsolutePath();
		return c4Models.computeIfAbsent(file, key -> new C4DocumentModel(file, true));
	}

	private C4DocumentModel createModel(File file, String content) {
		C4DocumentModel model = new C4DocumentModel(content, file.getAbsolutePath());
		return c4Models.compute(file.getAbsolutePath(), (k, v) -> model);	
	}

	private static File findWorksapce(String currentDirectory, String fileName) {
		File worksapceFile = new File(currentDirectory, fileName);
		while (!worksapceFile.exists() && currentDirectory != null) {
			currentDirectory = Paths.get(currentDirectory).toFile().getParent();
			worksapceFile = new File(currentDirectory, fileName);
		}
		return worksapceFile;
	}

	private static void updateModel(C4DocumentModel model, CompletableFuture<ViewSet> layouts) {
		model.setValid(true);
		if (layouts == null) {
			return;
		}
		try {
			ViewSet viewSet = layouts.get();
			if (viewSet == null) {
				return;
			}
			model.getWorkspace().getViews().copyLayoutInformationFrom(viewSet);
		} catch (Exception e) {
		}
	}

	private PublishDiagnosticsParams calcDiagnosticsForFile(File file, String content) {
		
		String currentDirectory = file.getParent();
		CompletableFuture<ViewSet> layouts = null;

		fileContent.put(file, content);

		File worksapceJson = findWorksapce(currentDirectory, "workspace.json");
		if(worksapceJson.exists() && worksapceJson.canRead()) {
			if(jsonWorkspace == null || jsonModified != worksapceJson.lastModified()) {
				logger.info("Get layout from workspace.json");
				jsonModified = worksapceJson.lastModified();
				layouts = CompletableFuture.supplyAsync(() -> {
					try {
						jsonWorkspace = WorkspaceUtils.loadWorkspaceFromJson(worksapceJson);
						return jsonWorkspace.getViews();
					} catch(Exception e) {
						return null;
					}
				});
			} else if(jsonWorkspace != null) {
				layouts = CompletableFuture.completedFuture(jsonWorkspace.getViews());
			}
		}

		context = null;
		elements.set(new HashSet<>());
		contextStack.clear();

		StructurizrDslParser parser = new StructurizrDslParser();
		List<Diagnostic> errors = new ArrayList<>();

		File worksapceFile = findWorksapce(currentDirectory, "workspace.dsl");
		boolean isWorkspace = worksapceFile.getAbsolutePath().equals(file.getAbsolutePath());

		if (isWorkspace) {
			C4DocumentModel model = createModel(file, content);
			try {
				model.clear();
				parser.parse(content, file);
			} catch (StructurizrDslParserException e) {
				logger.info("ParserException {}", e.getMessage());
				errors.add(createError(e));
			} catch (Exception e) {
				logger.error("ParserException {}", e.getMessage());
			} finally {
				if (parser.getWorkspace() != null) {
					lastParsedWorkspace = parser.getWorkspace();
					model.setWorkspace(lastParsedWorkspace);
					if(errors.size() == 0) {
						updateModel(model, layouts);
					}					
				} else {
					errors.clear();
					model.setValid(true);
				}
			}
			return new PublishDiagnosticsParams(file.toURI().toString(), errors);
		}

		C4DocumentModel model = createModel(file, content);
		try {
			model.clear();
			parser.parse(content, file);
		} catch (StructurizrDslParserException e) {
			logger.info("Got structurizr exception {}", e.getMessage());
			if (worksapceFile.exists()) {
				logger.info("try to parse workspace {}", worksapceFile.getAbsolutePath());
				String content0 = fileContent.get(worksapceFile);
				if (content0 == null) {
					try {
						content0 = new String(Files.readAllBytes(Paths.get(worksapceFile.getAbsolutePath())));
						fileContent.put(worksapceFile, content0);
					} catch (IOException e0) {
					}
				}
				if (content0 != null) {
					model = createModel(worksapceFile, content0);
					createModel(file, content);
					try {
						model.clear();
						parser.parse(content0, worksapceFile);
					} catch (StructurizrDslParserException e0) {
						logger.info("ParserException {}", e0.getMessage());
						errors.add(createError(e0));
					} catch (Exception e0) {
						logger.error("ParserException {}", e0.getMessage());
					} finally {
						if (parser.getWorkspace() != null) {
							lastParsedWorkspace = parser.getWorkspace();
							model.setWorkspace(lastParsedWorkspace);
							if(errors.size() == 0) {
								updateModel(model, layouts);
							}							
						} else {
							errors.clear();
							model.setValid(true);
						}
					}
					return new PublishDiagnosticsParams(worksapceFile.toURI().toString(), errors);
				}
			} else {
				logger.info("ParserException {}", e.getMessage());
				errors.add(createError(e));
			}
		} catch (Exception e) {
			logger.error("calcDiagnostics {}", e.getMessage());
		} finally {
			if (parser.getWorkspace() != null) {
				lastParsedWorkspace = parser.getWorkspace();
				model.setWorkspace(lastParsedWorkspace);
				if(errors.size() == 0) {
					updateModel(model, layouts);
				}
			} else {
				errors.clear();
				model.setValid(true);
			}
		}
		return new PublishDiagnosticsParams(file.toURI().toString(), errors);
	}

	public List<PublishDiagnosticsParams> calcDiagnostics(File file, String content) {
		List<PublishDiagnosticsParams> diagnostics = new ArrayList<>();
		diagnostics.add( calcDiagnosticsForFile(file, content));
		return diagnostics;
	}

	private Diagnostic createError(StructurizrDslParserException e) {

		int startPos = C4Utils.findFirstNonWhitespace(e.getLine(), 0, true);
		int endPos = e.getLine().length();
		int row = e.getLineNumber()-1;
					
		Diagnostic diagnostic = new Diagnostic();
		diagnostic.setSeverity(DiagnosticSeverity.Error);
		diagnostic.setMessage(e.getMessage());
		diagnostic.setRange(new Range(new Position(row, startPos), new Position(row, endPos)));

		return diagnostic;
	}
    
}
