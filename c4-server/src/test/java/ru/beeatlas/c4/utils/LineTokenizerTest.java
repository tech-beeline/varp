package ru.beeatlas.c4.utils;

import java.util.List;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import ru.beeatlas.c4.utils.LineTokenizer.CursorLocation;
import ru.beeatlas.c4.utils.LineTokenizer.TokenPosition;

import static org.assertj.core.api.Assertions.assertThat;

public class LineTokenizerTest {
    
    private LineTokenizer tokenizer;

    @BeforeEach
    void setup() {
        tokenizer = new LineTokenizer();
    }

    @Test
    void tokenizeSimpleStrings() {
        List<LineToken> tokens = LineTokenizer.tokenize("A simple list of strings");
        assertThat(tokens.stream().map(LineToken::token)).containsExactly("A", "simple", "list", "of", "strings");
    }

    @Test
    void tokenizeStringsWithQuotes() {
        List<LineToken> tokens = LineTokenizer.tokenize("A \"list\" with \"some\" quotes");
        assertThat(tokens.stream().map(LineToken::token)).containsExactly("A", "\"list\"", "with", "\"some\"", "quotes");
    }

    @Test
    public void tokenizeRelationShip() {
        List<LineToken> tokens = LineTokenizer.tokenize("abc -> def \"My Description\"") ;
        assertThat(tokens.stream().map(LineToken::token)).containsExactly("abc", "->", "def", "\"My Description\"");
    }

    @Test
    public void tokenizeAssignment() {
        List<LineToken> tokens = LineTokenizer.tokenize("user = person \"A User\" {") ;
        assertThat(tokens.stream().map(LineToken::token)).containsExactly("user", "=", "person", "\"A User\"", "{");
    }

    @Test
    void beforeFirstToken() {
        List<LineToken> tokens = LineTokenizer.tokenize(" A simple list of strings");
        CursorLocation location = LineTokenizer.cursorLocation(tokens, 0);
        assertThat(location.tokenIndex()).isEqualTo(0);
        assertThat(location.tokenPosition()).isEqualTo(TokenPosition.BEFORE);
    }

    @Test
    void beforeTypingA() {
        List<LineToken> tokens = LineTokenizer.tokenize(" A simple list of strings");
        CursorLocation location = LineTokenizer.cursorLocation(tokens, 1);
        assertThat(location.tokenIndex()).isEqualTo(0);
        assertThat(location.tokenPosition()).isEqualTo(TokenPosition.BEFORE);
    }

    @Test
    void justTypedA() {
        List<LineToken> tokens = LineTokenizer.tokenize(" A simple list of strings");
        CursorLocation location = LineTokenizer.cursorLocation(tokens, 2);
        assertThat(location.tokenIndex()).isEqualTo(0);
        assertThat(location.tokenPosition()).isEqualTo(TokenPosition.INSIDE);
    }

    @Test
    void withinStrings() {
        List<LineToken> tokens = LineTokenizer.tokenize(" A simple list of strings");
        CursorLocation location = LineTokenizer.cursorLocation(tokens, 21);
        assertThat(location.tokenIndex()).isEqualTo(4);
        assertThat(location.tokenPosition()).isEqualTo(TokenPosition.INSIDE);
    }

    @Test
    void someWhereAfterLastToken() {
        List<LineToken> tokens = LineTokenizer.tokenize(" A simple list of strings          ");
        CursorLocation location = LineTokenizer.cursorLocation(tokens, 31);
        assertThat(location.tokenIndex()).isEqualTo(4);
        assertThat(location.tokenPosition()).isEqualTo(TokenPosition.AFTER);
    }

    @Test
    void isInBetweenTokens() {
        List<LineToken> tokens = LineTokenizer.tokenize("Two Tokens ");
        CursorLocation location = LineTokenizer.cursorLocation(tokens, 4);
        assertThat(LineTokenizer.isBetweenTokens(location, 0, 1)).isTrue();
    }

    @Test
    void isNotInBetweenTokens() {
        List<LineToken> tokens = LineTokenizer.tokenize("Two Tokens ");
        CursorLocation location = LineTokenizer.cursorLocation(tokens, 5);
        assertThat(LineTokenizer.isBetweenTokens(location, 0, 1)).isFalse();
    }

    @Test
    void isInsideToken() {
        List<LineToken> tokens = LineTokenizer.tokenize("Two Tokens ");
        CursorLocation location = LineTokenizer.cursorLocation(tokens, 5);
        assertThat(LineTokenizer.isInsideToken(location, 1)).isTrue();
    }

    @Test
    void isNotInsideToken() {
        List<LineToken> tokens = LineTokenizer.tokenize("Two Tokens ");
        CursorLocation location = LineTokenizer.cursorLocation(tokens, 4);
        assertThat(LineTokenizer.isInsideToken(location, 1)).isFalse();
    }

    @Test
    void isBeforeToken() {
        List<LineToken> tokens = LineTokenizer.tokenize("Two Tokens ");
        CursorLocation location = LineTokenizer.cursorLocation(tokens, 0);
        assertThat(LineTokenizer.isBeforeToken(location, 0)).isTrue();
    }

    @Test
    void isNotBeforeToken() {
        List<LineToken> tokens = LineTokenizer.tokenize("Two Tokens ");
        CursorLocation location = LineTokenizer.cursorLocation(tokens, 1);
        assertThat(LineTokenizer.isBeforeToken(location, 0)).isFalse();
    }

}
