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

import static com.structurizr.view.Color.fromColorNameToHexColorCode;

import java.io.File;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.net.URI;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collection;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Map.Entry;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.Stack;
import java.util.function.Predicate;
import java.util.stream.Collectors;
import java.util.stream.Stream;
import org.eclipse.lsp4j.CodeLens;
import org.eclipse.lsp4j.Color;
import org.eclipse.lsp4j.ColorInformation;
import org.eclipse.lsp4j.Command;
import org.eclipse.lsp4j.Position;
import org.eclipse.lsp4j.Range;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import com.structurizr.Workspace;
import com.structurizr.model.ContainerInstance;
import com.structurizr.model.Element;
import com.structurizr.model.Relationship;
import com.structurizr.model.SoftwareSystemInstance;
import com.structurizr.view.ComponentView;
import com.structurizr.view.ContainerView;
import com.structurizr.view.DeploymentView;
import com.structurizr.view.DynamicView;
import com.structurizr.view.ModelView;
import com.structurizr.view.SystemContextView;
import com.structurizr.view.View;

import ru.beeatlas.c4.custom.Custom;
import ru.beeatlas.c4.generator.C4Generator;
import ru.beeatlas.c4.provider.C4SemanticTokenProvider;
import ru.beeatlas.c4.utils.LineToken;
import ru.beeatlas.c4.utils.LineTokenizer;
import ru.beeatlas.c4.utils.C4Utils;

public class C4DocumentModel {

	private record C4SemanticToken(
			int lineNumber,
			int startPos,
			int length,
			int tokenType,
			int tokenModifier) {
	}

	public record C4CompletionScope(
			int id,
			String name,
			int start,
			int end,
			int depth) {
		final public static int SCOPE_NOT_CLOSED = -1;
	}

	public static final String NO_SCOPE = "UnknownScope"; 

    private static final int COLOR_STR_LENGTH = 7; // e.g. #00FF00
    private static final String COLOR_START_TOKEN = "#";

	private String rawText = "";
	private Workspace workspace;
	private boolean valid = false;
	private static final String NEW_LINE = "\\r?\\n";
	
	private List<String> lines = Collections.emptyList();
    private static final Logger logger = LoggerFactory.getLogger(C4DocumentModel.class);
    
	private Stack<C4CompletionScope> scopeStack = new Stack<>();
	private List<C4CompletionScope> scopes = new ArrayList<>();

    private Map<Integer, C4ObjectWithContext<View>> viewToLineNumber = new HashMap<>();
    private Map<Integer, C4ObjectWithContext<Element>> elementsToLineNumber = new HashMap<>();
	private Map<Integer, C4ObjectWithContext<Relationship>> relationShipsToLineNumber = new HashMap<>();
	private Map<String, List<C4ObjectWithContext<Element>>> elementsById = new HashMap<>();

	private Map<Integer, String> includesToLineNumber = new HashMap<>();
	private List<ColorInformation> colorInformations = new ArrayList<>();
	private List<C4DocumentModel> referencedModels = new ArrayList<>();
	private List<C4Property> properties = new ArrayList<>();

	private List<DecoratorRange> decorations = new ArrayList<>();
	private List<C4SemanticToken> tokens = new ArrayList<>();

	private List<CodeLens> codeLenses = new ArrayList<CodeLens>();

	private URI uri;
	private boolean parsedInternally;
	private C4DocumentModel extendsBy;
	private String encodedWorkspace = "";

	public void clear() {
		scopeStack.clear();
		scopes.clear();
    	viewToLineNumber.clear();
    	elementsToLineNumber.clear();
		relationShipsToLineNumber.clear();
		elementsById.clear();
		decorations.clear();
		tokens.clear();
		codeLenses.clear();
		includesToLineNumber.clear();
		colorInformations.clear();
		referencedModels.clear();
		properties.clear();
		lines = Collections.emptyList();
		encodedWorkspace = "";
	}

	public C4DocumentModel getExtendsBy() {
		return extendsBy;
	}

	public void setExtendsBy(C4DocumentModel extendsBy) {
		this.extendsBy = extendsBy;
	}

	public C4DocumentModel(String rawText, String path) {
		this(rawText, path, false);
	}

	public C4DocumentModel(String rawText, String path, boolean parsedInternally) {		
		this.rawText = rawText;
		this.uri = new File(path).toURI();
		this.parsedInternally = parsedInternally;
	}

	public C4DocumentModel(String path, boolean parsedInternally) {
		this.uri = new File(path).toURI();
		this.parsedInternally = parsedInternally;
	}

	public String getRawText() {
		if(rawText.length() == 0) {
			try {
				rawText = new String(Files.readAllBytes(Paths.get(uri)));
			} catch (IOException e) {
			}		
		}		
		return rawText;
	}

	public Workspace getWorkspace() {		
		return workspace;
	}

	public String getUri() {
		return uri.toString();
	}

	public boolean isValid() {
		return valid;
	}
		
	public boolean isParsedInternally() {
		return parsedInternally;
	}

	public void setWorkspace(Workspace workspace) {
		logger.debug("setWorkspace {}", workspace.getName());
		this.workspace = workspace;
		referencedModels.forEach(e -> e.setWorkspace(workspace));
	}

	public void setValid(boolean valid) {
		logger.debug("setValid {} {}", uri.toString(), valid);
		this.valid = valid;
		referencedModels.forEach(e -> e.setValid(valid));
	}

	public List<DecoratorRange> calculateDecorations() {
		return decorations;
	}

	public View findViewByKey(String viewKey) throws Exception {
		return viewToLineNumber.entrySet().stream()
				.map(e -> e.getValue().getObject())
				.filter(entry -> entry.getKey().equals(viewKey))
				.findFirst()
				.orElseThrow(() -> new Exception("View not found in the model."));
	}

	public Set<Entry<Integer, C4ObjectWithContext<View>>> getAllViews() {
		return Set.copyOf(viewToLineNumber.entrySet());
	}

	public List<C4Property> getC4PropertiesByName(String name) {
		return properties.stream().filter(e -> e.name().equalsIgnoreCase(name)).collect(Collectors.toList());
	}

	public List<ColorInformation> getColorInformation() {
		return colorInformations;
	}

	private Color hexToColor(String hexColor) {
		java.awt.Color c = java.awt.Color.decode(hexColor);		
		return new Color( (double)c.getRed()/255, (double)c.getGreen()/255, (double)c.getBlue()/255, 1.0 );		
	}

	public Optional<View> getViewAtLineNumber(int lineNumber) {
		return Optional.ofNullable(viewToLineNumber.get(lineNumber)).map(e -> e.getObject());
	}

	public Optional<C4ObjectWithContext<Element>> getElementAtLineNumber(int lineNumber) {
		return Optional.ofNullable(elementsToLineNumber.get(lineNumber));
	}

	public Set<Entry<Integer, C4ObjectWithContext<Element>>> getAllElements() {
		return elementsToLineNumber.entrySet();
	}

	public Optional<C4ObjectWithContext<Relationship>> getRelationshipAtLineNumber(int lineNumber) {
		return Optional.ofNullable(relationShipsToLineNumber.get(lineNumber));
	}

	public Optional<String> getIncludeAtLineNumber(int lineNumber) {
		return Optional.ofNullable(includesToLineNumber.get(lineNumber));
	}

	public int getRelationshipsCount() {
		return relationShipsToLineNumber.size();
	}

	public List<Integer> calculateTokens() {
		List<C4SemanticToken> sorted = tokens.stream().sorted(Comparator.comparing(C4SemanticToken::lineNumber)).toList();

		List<Integer> result = new ArrayList<>();

		for (int index = 0; index < sorted.size(); index++) {
			C4SemanticToken token = sorted.get(index);
			if (index == 0) {
				result.add(token.lineNumber());
				result.add(token.startPos());
			} else {
				C4SemanticToken predecessor = sorted.get(index - 1);
				final int deltaLine = token.lineNumber() - predecessor.lineNumber();
				final int deltaChar = deltaLine == 0 ? token.startPos() - predecessor.startPos()
						: token.startPos();
				result.add(deltaLine);
				result.add(deltaChar);
			}
			result.add(token.length());
			result.add(token.tokenType());
			result.add(token.tokenModifier());
		}

		logger.debug("Semantik Tokens at {}", result);

		return result;
	}

	private static String getIdentifierOfView(View view) {

		if(view instanceof ContainerView || view instanceof SystemContextView || view instanceof DeploymentView) {
			return ((ModelView)view).getSoftwareSystemId();
		}
		else if(view instanceof ComponentView) {
			return ((ComponentView)view).getContainerId();
		}
		else if(view instanceof DynamicView) {
			return ((DynamicView)view).getElementId();
		}

		return null;

	}	

	public List<String> getIdentifiersWithFilter(Predicate<C4ObjectWithContext<Element>> func) {
		return elementsToLineNumber.entrySet().stream()
				.map(Entry::getValue)
				.filter(e -> func.test(e))
				.map(C4ObjectWithContext::getIdentifier).toList();
	}

	public List<String> getIdentifiers() {
		return elementsToLineNumber.entrySet().stream().map(e -> e.getValue().getIdentifier()).filter(Objects::nonNull)
				.toList();
	}

    // private C4SemanticToken createToken(String referenceId, int line) {
	// 	List<Entry<Integer, C4ObjectWithContext<Element>>> elements = findElementsById(referenceId);
    //     if(elements.size() == 1) {
    //         String identifier = elements.get(0).getValue().getIdentifier();
    //         if(identifier != null) {
    //             final int startPos = C4Utils.getStartPosition(getLineAt(line), identifier);
    //             return new C4SemanticToken(line, startPos, identifier.length(), C4SemanticTokenProvider.MODEL_ELEMENT, 0);
    //         }
    //     }
    //     return null;
    // }

    private Optional<C4SemanticToken> createToken(String referenceId, int line) {
		List<Entry<Integer, C4ObjectWithContext<Element>>> elements = findElementsById(referenceId);
        if(elements.size() == 1) {
            String identifier = elements.get(0).getValue().getIdentifier();
            if(identifier != null) {
                final int startPos = C4Utils.getStartPosition(getLineAt(line), identifier);
                return Optional.of(new C4SemanticToken(line, startPos, identifier.length(), C4SemanticTokenProvider.MODEL_ELEMENT, 0));
            }
        }
        return Optional.empty();
    }

	public List<Entry<Integer, C4ObjectWithContext<Element>>> findElementsById(String id) {
		Stream<Entry<Integer, C4ObjectWithContext<Element>>> s1 = elementsToLineNumber.entrySet().parallelStream().filter(e -> e.getValue().getObject().getId().equals(id));
		Stream<Entry<Integer, C4ObjectWithContext<Element>>> s2 = referencedModels.parallelStream().map(e -> e.elementsToLineNumber.entrySet()).flatMap(Collection::stream).filter(e -> e.getValue().getObject().getId().equals(id));
		return Stream.concat(s1, s2).toList();
	}

	public String getLineAt(int lineNumber) {
		getRawLines();
		return lineNumber < lines.size() ? lines.get(lineNumber) : null;
	}

	public void addProperty(C4Property c4Property) {
		properties.add(c4Property);
	}

	public void addRelationship(int lineNumber, C4ObjectWithContext<Relationship> c4ObjectWithContext) {
		createToken(c4ObjectWithContext.getObject().getSourceId(), lineNumber - 1).ifPresent(t -> tokens.add(t));
		createToken(c4ObjectWithContext.getObject().getDestinationId(), lineNumber - 1).ifPresent(t -> tokens.add(t));
		c4ObjectWithContext.getDecorations().forEach(decorations::add);
		relationShipsToLineNumber.put(lineNumber, c4ObjectWithContext);
	}

	public void addElement(int lineNumber, C4ObjectWithContext<Element> c4ObjectWithContext) {
		c4ObjectWithContext.getDecorations().forEach(decorations::add);

		Element element = c4ObjectWithContext.getObject();
		if (element instanceof ContainerInstance) {
			createToken(((ContainerInstance) element).getContainerId(), lineNumber - 1).ifPresent(t -> tokens.add(t));
		} else if (element instanceof SoftwareSystemInstance) {
			createToken(((SoftwareSystemInstance) element).getSoftwareSystemId(), lineNumber - 1).ifPresent(t -> tokens.add(t));
		}

		elementsToLineNumber.put(lineNumber, c4ObjectWithContext);
		elementsById.computeIfAbsent(c4ObjectWithContext.getObject().getId(), k -> new ArrayList<>()).add(c4ObjectWithContext);
	}

    public void addView(int lineNumber, C4ObjectWithContext<View> view) {
		view.getDecorations().forEach(decorations::add);
		createToken(getIdentifierOfView(view.getObject()), lineNumber - 1).ifPresent(t -> tokens.add(t));
		viewToLineNumber.put(lineNumber, view);
		Command commandStructurizr = new Command("$(link-external) Show as Structurizr Diagram",
				"c4.show.diagram");
		commandStructurizr.setArguments(Arrays.asList(view.getObject().getKey()));
		codeLenses.add(new CodeLens(view.getCodeLensRange(), commandStructurizr, null));
    }

    public void addColor(int lineNumber, String line) {
		int startPos = line.indexOf(COLOR_START_TOKEN);
		ColorInformation colorInformation = null;
		if(startPos > -1) {
			int endPos = startPos + COLOR_STR_LENGTH;
			Range range = new Range(new Position(lineNumber - 1, startPos), new Position(lineNumber - 1, endPos));
			colorInformation = new ColorInformation(range, hexToColor(line.substring(startPos, endPos)));
		} else {
			List<LineToken> tokens = LineTokenizer.tokenize(line);
			LineToken secondToken = tokens.get(1);
			Range range = new Range(new Position(lineNumber - 1, secondToken.start()), new Position(lineNumber - 1, secondToken.end()));
			colorInformation = new ColorInformation(range, hexToColor(fromColorNameToHexColorCode(secondToken.token())));
		}
		colorInformations.add(colorInformation);
    }

	public void addReferencedModel(C4DocumentModel referencedModel, int lineNumber, String path) {
		referencedModels.add(referencedModel);
		includesToLineNumber.put(lineNumber, path);
	}

	public void addCodeLens(CodeLens codeLens) {
		codeLenses.add(codeLens);
	}

	public C4DocumentModel getReferencedModelByPath(String path) {
		return referencedModels.stream().filter(r -> r.getUri().endsWith(path)).findFirst().get();
	}

	public List<CodeLens> calcCodeLenses() {

		if (!isValid() || getWorkspace() == null) {
			return Collections.emptyList();
		}

		try {

			if(encodedWorkspace.isEmpty()) {
				encodedWorkspace = C4Generator.generateEncodedWorkspace(getWorkspace());
				codeLenses.forEach(cl -> {
					Command command = cl.getCommand();
					List<Object> arguments = command.getArguments();
					command.setArguments(Stream.concat(Stream.of(encodedWorkspace), arguments.stream()).toList());
				});
			}

			return codeLenses;


/*			
			Stream<CodeLens> s0 = scopes
			.stream()
			.filter(s -> s.name().equals("DeploymentEnvironmentDslContext"))
			.map(s -> {
				int lineNumber = s.start();
				String line = getLineAt(lineNumber - 1);
				LineTokenizer tokenizer = new LineTokenizer();
				List<LineToken> tokens = tokenizer.tokenize(line);
				if(tokens.size() == 3) {
					Command commandStructurizr = new Command("$(link-external) Export Environment", "c4.export.deployment");
					String name = C4Utils.trimStringByString(tokens.get(1).token(), "\"");
					commandStructurizr.setArguments(Arrays.asList(workspace, name));
					int pos = C4Utils.findFirstNonWhitespace(line, 0, true);
        			Range range = new Range(new Position(lineNumber - 1, pos), new Position(lineNumber - 1, pos));
					return new CodeLens(range, commandStructurizr, null);
				} else {
					return null;
				}
			}).filter(Objects::nonNull);

			//return s0.toList();

			Stream<CodeLens> s1 = viewToLineNumber.entrySet().stream().map(e -> {
				Command commandStructurizr = new Command("$(link-external) Show as Structurizr Diagram",
						"c4.show.diagram");
				commandStructurizr.setArguments(Arrays.asList(workspace, e.getValue().getObject().getKey()));
				CodeLens cl0 = new CodeLens(e.getValue().getCodeLensRange(), commandStructurizr, null);
				return Arrays.asList(cl0);
				//CodeLens cl1 = (custom == null) ? null : custom.getSequenceCodeLens(e.getValue());
				//return (cl1 != null) ? Arrays.asList(cl0, cl1) : Arrays.asList(cl0);
			}).flatMap(Collection::stream);

			return Stream.concat(s0, s1).toList();


			// return viewToLineNumber.entrySet().parallelStream().map(e -> {
			// 	Command commandStructurizr = new Command("$(link-external) Show as Structurizr Diagram", "c4.show.diagram");
			// 	commandStructurizr.setArguments(Arrays.asList(workspace, e.getValue().getObject().getKey()));
			// 	CodeLens cl0 = new CodeLens(e.getValue().getCodeLensRange(), commandStructurizr, null);
			// 	CodeLens cl1 = (custom == null) ? null : custom.getSequenceCodeLens(e.getValue());
			// 	return (cl1 != null) ? Arrays.asList(cl0, cl1) : Arrays.asList(cl0);
			// }).flatMap(Collection::stream).toList();
*/			
		} catch (Exception e) {
			return Collections.emptyList();
		}

	}

	public String getSurroundingScope(int lineNumber) {
		final int adjustedLineNumber = lineNumber + 1;
		Optional<C4CompletionScope> nearestScope = scopes.parallelStream()
				.filter(scope -> scope.start() < adjustedLineNumber && (scope.end() > adjustedLineNumber
						|| scope.end() == C4CompletionScope.SCOPE_NOT_CLOSED))
				.sorted(Comparator.comparingInt(C4CompletionScope::start).reversed())
				.findFirst();

		return nearestScope.map(C4CompletionScope::name).orElse(NO_SCOPE);
	}

	public void openScope(int lineNumber, int contextId, String contextName) {
		C4CompletionScope scope = new C4CompletionScope(contextId, contextName, lineNumber, C4CompletionScope.SCOPE_NOT_CLOSED, scopeStack.size());
		scopeStack.push(scope);
	}

	public void closeScope(int lineNumber, int contextId, String contextName) {

		if (!scopeStack.empty()) {
			C4CompletionScope scope = scopeStack.pop();
			if (scope.id() != contextId) {
				logger.error("Closed scope Id should be {} but got {}", scope.id(), contextId);
			} else {
				scope = new C4CompletionScope(scope.id(), scope.name(), scope.start(), lineNumber, scope.depth());
				scopes.add(scope);
				Custom.getInstance().closeScope(scope, this);
			}
		} else {
			logger.error("Scope stack is empty");
		}
	}

	public Optional<C4CompletionScope> getLastScope() {
		return (scopes.isEmpty()) ? Optional.empty() : Optional.of(scopes.get(scopes.size() - 1));
	}
	
	public Optional<C4CompletionScope> getNearestScope(int lineNumber) {
		final int adjustedLineNumber = lineNumber + 1;

		return scopes.stream()
				.filter(scope -> !scope.name().equals("CommentDslContext"))
				.filter(scope -> scope.start() <= adjustedLineNumber
						&& (scope.end() >= adjustedLineNumber
								|| scope.end() == C4CompletionScope.SCOPE_NOT_CLOSED))
				.sorted(Comparator.comparingInt(C4CompletionScope::start).reversed())
				.findFirst();
	}

	public List<String> getRawLines() {
		if(lines.isEmpty()) {
			lines = Arrays.asList(getRawText().split(NEW_LINE));
		}
		return lines;
	}

}