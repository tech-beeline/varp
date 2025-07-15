package ru.beeatlas.c4.provider;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Predicate;
import java.util.stream.Collectors;

import org.eclipse.lsp4j.CompletionItem;
import org.eclipse.lsp4j.Position;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import com.structurizr.model.Container;
import com.structurizr.model.Element;
import com.structurizr.model.SoftwareSystem;

import ru.beeatlas.c4.utils.C4Utils;
import ru.beeatlas.c4.custom.Custom;
import ru.beeatlas.c4.model.C4DocumentModel;
import ru.beeatlas.c4.model.C4ObjectWithContext;
import ru.beeatlas.c4.model.C4TokensConfig;
import ru.beeatlas.c4.model.C4TokensLoader;
import ru.beeatlas.c4.model.C4TokensConfig.C4TokenScope;
import ru.beeatlas.c4.utils.LineToken;
import ru.beeatlas.c4.utils.LineTokenizer;
import ru.beeatlas.c4.utils.LineTokenizer.CursorLocation;

public class C4CompletionProvider {

    private static final Logger logger = LoggerFactory.getLogger(C4CompletionProvider.class);    
    private final static List<CompletionItem> NO_COMPLETIONS = Collections.emptyList();
    private Map<String, List<CompletionItem>> keywordCompletions;
    private Map<String, List<CompletionItem>> snippetCompletions;
    private Map<String, List<CompletionItem>> detailCompletions;
    private List<String> relationRelevantScopes;
    private C4CompletionItemCreator completionCreator = new C4CompletionItemCreator();

    public C4CompletionProvider(C4TokensLoader configLoader) {
        init(configLoader);
    }    

    void init(C4TokensLoader configLoader) {
        C4TokensConfig config = configLoader.readConfiguration();
        if(config != null) {
            keywordCompletions = new HashMap<>();
            snippetCompletions = new HashMap<>();
            detailCompletions = new HashMap<>();
            config.scopes().forEach( scope -> {
                keywordCompletions.put(scope.name(), completionCreator.keyWordCompletion(scope.keywords()));                    
                if(scope.snippets() != null) {
                    snippetCompletions.put(scope.name(), completionCreator.snippetCompletion(scope.snippets()));
                }                
            });
            config.details().forEach( detail -> {
                detailCompletions.put(detail.keyword(), completionCreator.propertyCompletion(detail.choice()));
            });
            relationRelevantScopes = config.scopes().stream()
                                        .filter(C4TokenScope::hasRelations)
                                        .map(C4TokenScope::name)
                                        .collect(Collectors.toList());
        }
    }

    public List<CompletionItem> calcCompletions(C4DocumentModel model, Position position, Set<C4ObjectWithContext<Element>> elements) {

        int lineNumber = position.getLine();
        String line = model.getLineAt(lineNumber);
        String scope = model.getSurroundingScope(lineNumber);

        List<CompletionItem> result;

        logger.debug("-> calcCompletions in scope {} at Position ({},{})", scope, position.getLine(), position.getCharacter());

        // if model is empy, i.e. just created
        if(C4Utils.isBlank(model.getRawText())) {
            result = C4Utils.merge(completeAsPerConfiguration("DocumentRootContext", model), snippetCompletions.getOrDefault("DocumentRootContext", NO_COMPLETIONS));
        }

        else if(scope.equals(C4DocumentModel.NO_SCOPE)) {
            logger.warn("Cannot calculate code completion. No scope detected");
            result = NO_COMPLETIONS;
        }

        else {
            List<LineToken> tokens = LineTokenizer.tokenize(line);
            CursorLocation cursorAt = LineTokenizer.cursorLocation(tokens, position.getCharacter());

            // Line is empty or cursor is located before first token. 
            // Determine all keywords in the given scope and potential identifer references (if applicable)
            if(tokens.isEmpty() || LineTokenizer.isBeforeToken(cursorAt, 0) ) {
                result = C4Utils.merge(completeAsPerConfiguration(scope, model), snippetCompletions.getOrDefault(scope, NO_COMPLETIONS));
            }

            else if(LineTokenizer.isInsideToken(cursorAt, 0)) {
                result = completeAsPerConfiguration(scope, model).stream()
                        .filter( item -> item.getLabel().startsWith(tokens.get(0).token()))
                        .collect(Collectors.toList());
            }

            else {

                switch(scope) {
                    case "ModelDslContext":
                    case "PersonDslContext":
                    case "SoftwareSystemDslContext":
                    case "DeploymentEnvironmentDslContext":
                    case "DeploymentNodeDslContext":
                    case "InfrastructureNodeDslContext":
                    case "SoftwareSystemInstanceDslContext":
                    case "ContainerInstanceDslContext":
                        result = completeModel(scope, tokens, cursorAt, model);
                        break;
                    case "ViewsDslContext":
                        result = completeViews(tokens, cursorAt, model);
                        break;
                    case "PropertiesDslContext":
                        result = Custom.getInstance().comleteProperties(tokens, cursorAt, model, position);
                        break;
                    case "ContainerDslContext":
                    case "ComponentDslContext":
                        result = Custom.getInstance().completeContainer(tokens, cursorAt, model);
                        break;
                    case "DynamicViewParallelSequenceDslContext" :
                    case "DynamicViewDslContext": {
                        result = completeDynamicView(tokens, cursorAt, model, elements);
                        break;  
                    }
                    default:  {
                        result = completeDetails(tokens, cursorAt, model);
                    }
                }         
            }
        }

        if (!result.isEmpty()) {
            Custom.getInstance().completionTelemety();
        }
        
        logger.debug("<- calcCompletions size = {}", result.size());

        return result;
    }

    private List<CompletionItem> completeAsPerConfiguration(String scope, C4DocumentModel model) {

        return C4Utils.merge(
                    keywordCompletions.getOrDefault(scope, NO_COMPLETIONS), 
                    relationRelevantScopes.contains(scope) ? C4CompletionItemCreator.identifierCompletion(getIdentifiers(model)) : NO_COMPLETIONS);
    }

    private List<CompletionItem> completeDynamicView(List<LineToken> tokens, CursorLocation cursor, C4DocumentModel model, Set<C4ObjectWithContext<Element>> elements) {
        List<CompletionItem> completionIds = new ArrayList<>();
        if(tokens.size() != 4) {
            return completionIds;
        }
        if(!tokens.get(1).token().equals(LineTokenizer.TOKEN_EXPR_RELATIONSHIP)) {
            return completionIds;
        }
        if(!LineTokenizer.isInsideToken(cursor, 3)) {
            return completionIds;
        }
        String[] destination = tokens.get(2).token().split("\\.");
        if(destination.length != 2) {
            return completionIds;
        }
        return Custom.getInstance().dynamicViewCompletion(destination[1], model, elements);
    }

    private List<CompletionItem> completeModel(String scope, List<LineToken> tokens, CursorLocation cursor, C4DocumentModel model) {
        logger.info("completeModel");
        if(tokens.size() >= 2) {
            if(tokens.get(1).token().equals(LineTokenizer.TOKEN_EXPR_ASSIGNMENT)) {
                if(LineTokenizer.isBetweenTokens(cursor, 1, 2)) {
                    return completeAsPerConfiguration(scope, model).stream().collect(Collectors.toList());
                }
                if(LineTokenizer.isInsideToken(cursor, 2)) {
                    return completeAsPerConfiguration(scope, model).stream()
                            .filter( item -> item.getLabel().startsWith(tokens.get(2).token()))
                            .collect(Collectors.toList());
                }
            }

            if(tokens.get(1).token().equals(LineTokenizer.TOKEN_EXPR_RELATIONSHIP)) {
                if(LineTokenizer.isBetweenTokens(cursor, 1, 2)) {
                    return C4CompletionItemCreator.identifierCompletion(getIdentifiers(model));
                }
                if(LineTokenizer.isInsideToken(cursor, 2)) {
                    return C4CompletionItemCreator.identifierCompletion(getIdentifiers(model)).stream()
                            .filter( item -> item.getLabel().startsWith(tokens.get(2).token()))
                            .collect(Collectors.toList());
                }
            }
        }

        return NO_COMPLETIONS;
    }

    private List<CompletionItem> completeDetails(List<LineToken> tokens, CursorLocation cursor, C4DocumentModel docModel) {
        logger.info("completeDetails");
        LineToken firstToken = tokens.get(0);

        if(LineTokenizer.isBetweenTokens(cursor, 0, 1)) {
            return detailCompletions.getOrDefault(firstToken.token(), NO_COMPLETIONS);
        }

        if(LineTokenizer.isInsideToken(cursor, 1)) {
            return detailCompletions.getOrDefault(firstToken.token(), NO_COMPLETIONS).stream()
                    .filter( item -> item.getLabel().startsWith(tokens.get(1).token()))
                    .collect(Collectors.toList());
        }    

        return NO_COMPLETIONS;
    }

    private List<CompletionItem> completeViews(List<LineToken> tokens, CursorLocation cursor, C4DocumentModel docModel) {
        logger.info("completeProperties");
        List<CompletionItem> completionIds = NO_COMPLETIONS;

        LineToken firstToken = tokens.get(0);

        if(firstToken.token().equals("systemContext")) {
            completionIds = completionInViewIdentifiers(docModel, element -> element.getObject() instanceof SoftwareSystem);
        }
        else if(firstToken.token().equals("container")) {
            completionIds = completionInViewIdentifiers(docModel, element -> element.getObject() instanceof SoftwareSystem);
        }
        else if(firstToken.token().equals("component")) {
            completionIds = completionInViewIdentifiers(docModel, element -> element.getObject() instanceof Container);
        }
        else if(firstToken.token().equals("dynamic")) {
            completionIds = completionInViewIdentifiers(docModel, element -> element.getObject() instanceof Container || element.getObject() instanceof SoftwareSystem).stream().collect(Collectors.toCollection(ArrayList::new));
            completionIds.add(new CompletionItem("*"));
        }
        else if(firstToken.token().equals("deployment")) {
            completionIds = completionInViewIdentifiers(docModel, element -> element.getObject() instanceof SoftwareSystem).stream().collect(Collectors.toCollection(ArrayList::new));
            completionIds.add(new CompletionItem("*"));
        }

        if(LineTokenizer.isBetweenTokens(cursor, 0, 1)) {
            return completionIds;
        }

        if(LineTokenizer.isInsideToken(cursor, 1)) {
            return completionIds.stream()
                    .filter( item -> item.getLabel().startsWith(tokens.get(1).token()))
                    .collect(Collectors.toList());
        }

        return NO_COMPLETIONS;
    }

    private List<CompletionItem> completionInViewIdentifiers(C4DocumentModel model, Predicate<C4ObjectWithContext<Element>> func) {
        return C4CompletionItemCreator.identifierCompletion(model.getIdentifiersWithFilter(func));
    }

    List<String> getIdentifiers(C4DocumentModel model) {
        return model.getIdentifiers();
    }

}
