package ru.beeatlas.c4.provider;

import java.util.ArrayList;
import java.util.List;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

import org.eclipse.lsp4j.Position;
import org.eclipse.lsp4j.Range;
import org.eclipse.lsp4j.TextEdit;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import ru.beeatlas.c4.model.C4DocumentModel;
import ru.beeatlas.c4.model.C4DocumentModel.C4CompletionScope;
import ru.beeatlas.c4.utils.LineToken;
import ru.beeatlas.c4.utils.LineTokenizer;
import ru.beeatlas.c4.utils.C4Utils;

public class C4FormatterProvider {

    private static final Logger logger = LoggerFactory.getLogger(C4FormatterProvider.class);
    private static final Pattern COMMENT_PATTERN = Pattern.compile("^\\s*?(//|#).*$");

    private int indentPerScope;

    public C4FormatterProvider(int indentPerScope) {
        this.indentPerScope = indentPerScope;
    }

    public void updateIndent(int newIndent) {
        this.indentPerScope = newIndent;
    }

    public List<TextEdit> calculateFormattedTextEdits(C4DocumentModel model) {

        List<TextEdit> result = new ArrayList<>();
        List<String> rawLines = model.getRawLines();

        for(int lineIdx=0; lineIdx<rawLines.size(); lineIdx++) {
            var currentIdx = lineIdx;
            model.getNearestScope(currentIdx).ifPresent( scope -> {
                String originText = rawLines.get(currentIdx);
                int expectedIndentDepth = getExpectedIndentDepth(scope, currentIdx+1);
                int firstNonWhiteSpace = C4Utils.findFirstNonWhitespace(originText, 0, true);
                if(!originText.isBlank() && (expectedIndentDepth != firstNonWhiteSpace || hasWhitespacesBetweenTokens(originText))) {
                    String newText = createNewText(originText, expectedIndentDepth);
                    result.add( createTextEdit(newText, originText, currentIdx));
                }    
            });
        }

        return result;
    }
   
    int getExpectedIndentDepth(C4CompletionScope scope, int currentIdx) {
        return (scope.start() == currentIdx || scope.end() == currentIdx ? scope.depth() : scope.depth()+1) * indentPerScope;
    }
    
    String createNewText(String oldText, int leadingWhiteSpaces) {
        return (new String(" ")).repeat(leadingWhiteSpaces) + removeWhiteSpacesBetweenTokens(oldText.trim());
    }

    TextEdit createTextEdit(String newText, String oldText, int line) {
        var range = new Range( new Position(line, 0), new Position(line, oldText.length()));
        return new TextEdit(range, newText);
    }

    boolean hasWhitespacesBetweenTokens(String text) {
        List<LineToken> tokens = LineTokenizer.tokenize(text);
        if(tokens.size() > 1) {
            int index = 0;
            while(index < tokens.size()-1) {
                if(tokens.get(index+1).start() - tokens.get(index).end() > 1) {
                    return true;
                }
                index++;
            }
        }
        return false;
    }

    String removeWhiteSpacesBetweenTokens(String text) {

        if(isSingleLineComment(text)) {
            return text;
        }

        List<LineToken> tokens = LineTokenizer.tokenize(text);
        if(tokens.size() < 2) {
            return text;
        }

        return tokens.stream().map(LineToken::token).collect(Collectors.joining(" "));
    }

    boolean isSingleLineComment(String text) {
        return COMMENT_PATTERN.matcher(text).matches();
    }
}
