package ru.beeatlas.c4.provider;

import java.util.Arrays;
import java.util.List;

public class C4SemanticTokenProvider {

    public static final List<String> TOKEN_TYPES = Arrays.asList(
        "comment", "string", "keyword", "number", "regexp", "operator", "namespace",
        "type", "struct", "class", "interface", "enum", "typeParameter", "function",
        "member", "macro", "variable", "parameter", "property", "label", "event");
    
    public static final List<String> TOKEN_MODIFIERS = Arrays.asList(
        "declaration", "definition", "readonly", "static", "deprecated",
        "abstract", "async", "modification", "documentation", "defaultLibrary");
    
    public final static int MODEL_ELEMENT = TOKEN_TYPES.indexOf("member");
}