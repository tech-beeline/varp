package ru.beeatlas.c4.utils;

import static org.junit.jupiter.api.Assertions.assertAll;
import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.File;
import java.nio.file.Files;
import java.nio.file.Paths;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import static org.assertj.core.api.Assertions.assertThat;

public class C4UtilsTest {
    
    @Test
    public void getStartPositionOK() {

        assertEquals(0, C4Utils.getStartPosition("My Text", "My"));
        assertEquals(3, C4Utils.getStartPosition("My Text", "Text"));
        assertEquals(C4Utils.NOT_FOUND_WITHIN_STRING, C4Utils.getStartPosition("My Text", "Not there"));

    }

    @Test
    public void getStartPositionInvalidParameters() {
        assertEquals(C4Utils.NOT_FOUND_WITHIN_STRING, C4Utils.getStartPosition(null, null));
        assertEquals(C4Utils.NOT_FOUND_WITHIN_STRING, C4Utils.getStartPosition("Line", null));
        assertEquals(C4Utils.NOT_FOUND_WITHIN_STRING, C4Utils.getStartPosition(null, "key"));
        assertEquals(C4Utils.NOT_FOUND_WITHIN_STRING, C4Utils.getStartPosition("", ""));
    }

    @ParameterizedTest
    @CsvSource({"0,3", "1,3", "2,3", "3,3", "4,4", "5,6", "6,6"})
    public void findFirstNonWhitespace(int input, int expected) {
       assertEquals(expected, C4Utils.findFirstNonWhitespace("   My Line", input, true));
    }

    @Test
    public void findFirstNonWhitespaceInvalidParameters() {
        assertEquals(C4Utils.NOT_FOUND_WITHIN_STRING, C4Utils.findFirstNonWhitespace(null, 0, true));
        assertEquals(C4Utils.NOT_FOUND_WITHIN_STRING, C4Utils.findFirstNonWhitespace("", 0, true));
        assertEquals(C4Utils.NOT_FOUND_WITHIN_STRING, C4Utils.findFirstNonWhitespace("My Line", -1, true));
        assertEquals(C4Utils.NOT_FOUND_WITHIN_STRING, C4Utils.findFirstNonWhitespace("My Line", 10, true));
    }

    @Test
    public void writeContentToFile(@TempDir File tmpDir) {
        
        File out = new File(tmpDir, "test.out");

        assertDoesNotThrow( () -> C4Utils.writeContentToFile(out, "something"));

        assertEquals(1, tmpDir.listFiles().length);

        assertEquals("test.out", tmpDir.listFiles()[0].getName());

        assertDoesNotThrow( () -> {
            String content = new String(Files.readAllBytes(Paths.get(tmpDir.listFiles()[0].getAbsolutePath())));
            assertEquals("something", content);
        });
    }

    @Test
    public void isBlank() {
        assertAll( "String is identified as blank" ,
            () -> assertTrue(C4Utils.isBlank(null)),
            () -> assertTrue(C4Utils.isBlank(null)),
            () -> assertTrue(C4Utils.isBlank("")),
            () -> assertTrue(C4Utils.isBlank("       ")),
            () -> assertTrue(C4Utils.isBlank("\t\t "))
        );
    }

    @Test
    public void leftFromCursorEmpty() {
        assertAll( "No String found left from cursor" ,
            () -> assertThat( C4Utils.leftFromCursor(null, 0)).isEmpty(),
            () -> assertThat( C4Utils.leftFromCursor("Foo", -1)).isEmpty()
        );
    }

    @Test
    public void leftFromCursorHasRightValue() {
        assertAll( "String found left from cursor" ,
            () -> assertThat(C4Utils.leftFromCursor("   My   Test", 6)).hasValue("My"),
            () -> assertThat(C4Utils.leftFromCursor("   My   Test", 8)).hasValue("My"),
            () -> assertThat(C4Utils.leftFromCursor("   My   Test", 10)).hasValue("My   Te")
        );
    }

}
