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