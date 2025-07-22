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

package ru.beeatlas.c4.utils;

import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class LineTokenizer {
    
    public static final String TOKEN_EXPR_RELATIONSHIP = "->";
    public static final String TOKEN_EXPR_ASSIGNMENT = "=";

    private final static String TOKENIZE_PATTERN = "(#?[\\w\\!\\.+#->]+(\\.\\w+)*)|\"([^\"]*)\"|->|=|\\{";
    private final static Pattern pattern = Pattern.compile(TOKENIZE_PATTERN);

    public static List<LineToken> tokenize(String line) {

        List<LineToken> result = new ArrayList<>();
        if(C4Utils.isBlank(line)) {
            return result;
        }

        Matcher matcher = pattern.matcher(line);

        while(matcher.find()) {
            result.add(new LineToken(matcher.group(0), matcher.start(), matcher.end()));
        }

        return result;
    }

    public static CursorLocation cursorLocation(List<LineToken> tokens, int charAt) {

        if(tokens == null || tokens.size() == 0) {
            return new CursorLocation(-1, TokenPosition.NOT_APPLICABLE);
        }

        for(int i=0; i<tokens.size(); i++) {
            LineToken t = tokens.get(i);
            if(cursorBeforeToken(t, charAt)) {
                return new CursorLocation(i, TokenPosition.BEFORE);
            }
            if(cursorInsideToken(t, charAt)) {
                return new CursorLocation(i, TokenPosition.INSIDE);
            }
        }

        return new CursorLocation(tokens.size()-1, TokenPosition.AFTER);

    }

    private static boolean cursorInsideToken(LineToken token, int charAt) {
        return (charAt > token.start() && charAt <= token.end());
    }

    private static boolean cursorAfterToken(LineToken token, int charAt) {
        return charAt > token.end();
    }

    private static boolean cursorBeforeToken(LineToken token, int charAt) {
        return charAt <= token.start();
    }

    public static boolean isBetweenTokens(CursorLocation cursor, int indexFrom, int indexTo) {
        return (cursor.tokenIndex() == indexFrom && cursor.tokenPosition().equals(TokenPosition.AFTER)) || 
               (cursor.tokenIndex() == indexTo && cursor.tokenPosition().equals(TokenPosition.BEFORE)) ;
    }

    public static boolean isInsideToken(CursorLocation cursor, int index) {
        return cursor.tokenIndex() == index && cursor.tokenPosition().equals(TokenPosition.INSIDE);  
    }

    public static boolean isBeforeToken(CursorLocation cursor, int index) {
        return cursor.tokenIndex() == index && cursor.tokenPosition().equals(TokenPosition.BEFORE);
    }

    public enum TokenPosition { BEFORE, INSIDE, AFTER, NOT_APPLICABLE };

    public record CursorLocation(int tokenIndex, TokenPosition tokenPosition) {
    }
}
