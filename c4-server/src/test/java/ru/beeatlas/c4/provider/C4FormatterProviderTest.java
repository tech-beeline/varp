package ru.beeatlas.c4.provider;

import java.io.IOException;
import java.net.URISyntaxException;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

import ru.beeatlas.c4.model.C4DocumentModel.C4CompletionScope;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assertions.assertAll;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

public class C4FormatterProviderTest {

    private final static int SPACES_PER_INDENT = 3;
    private C4FormatterProvider formatter;

    @BeforeEach
    public void initialize() throws IOException, URISyntaxException {
        formatter = new C4FormatterProvider(SPACES_PER_INDENT);
    }

    @Test
    public void hasWhitespacesBetweenTokens() {
        assertThat(formatter.hasWhitespacesBetweenTokens("workspace my_workspace \"My Description\"")).isFalse();
        assertThat(formatter.hasWhitespacesBetweenTokens("workspace  my_workspace \"My Description\"")).isTrue();
    }

    @Test
    public void removeWhiteSpacesBetweenTokens() {
        String text = "workspace      my_workspace             \"Description\"        {";
        String expected  = "workspace my_workspace \"Description\" {";
        assertThat(formatter.removeWhiteSpacesBetweenTokens(text)).isEqualTo(expected);
    }

    @Test
    public void doNotremoveWhiteSpacesBetweenTokens() {
        String text = "# This is a comment with    many       whitespaces";
        String expected = "# This is a comment with    many       whitespaces";
        assertThat(formatter.removeWhiteSpacesBetweenTokens(text)).isEqualTo(expected);
    }

    @ParameterizedTest
    @ValueSource(ints = {1, 2, 3, 4, 5, 6})
    public void getExpectedIndentDepth(int newIndent) {

        formatter.updateIndent(newIndent);

        var currentDepth = 4;

        var scope = mock(C4CompletionScope.class);
        when(scope.start()).thenReturn(0);
        when(scope.end()).thenReturn(2);
        when(scope.depth()).thenReturn(currentDepth);

        assertAll(
            () -> assertThat(formatter.getExpectedIndentDepth(scope, 0)).isEqualTo(currentDepth * newIndent),
            () -> assertThat(formatter.getExpectedIndentDepth(scope, 1)).isEqualTo( (currentDepth+1) * newIndent),
            () -> assertThat(formatter.getExpectedIndentDepth(scope, 2)).isEqualTo(currentDepth * newIndent)
        );
    }

    @Test
    public void createNewText() {
        String oldText1 = "   text";
        String oldText2 = "text";
        String expectedNewText = "      text";
        assertAll(
            () -> assertThat(formatter.createNewText(oldText1, 6)).isEqualTo(expectedNewText),
            () -> assertThat(formatter.createNewText(oldText2, 6)).isEqualTo(expectedNewText)
        );
    }

    @Test
    public void isSingleLineComment() {
        assertAll(
            () -> assertThat(formatter.isSingleLineComment("# This is a comment")).isTrue(),
            () -> assertThat(formatter.isSingleLineComment("// This is a comment")).isTrue(),
            () -> assertThat(formatter.isSingleLineComment("/ This is not a comment")).isFalse(),
            () -> assertThat(formatter.isSingleLineComment("This is // not  a comment")).isFalse()
        );
    }

}
