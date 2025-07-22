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

import java.util.List;

public record C4TokensConfig(List<C4TokenScope> scopes, List<C4TokenDetail> details) {

        public record C4TokenSnippet(
                        String label,
                        String detail,
                        String insertText) {
        }

        public record C4TokenScope(String name,
                        List<String> keywords,
                        boolean hasRelations,
                        List<C4TokenSnippet> snippets) {
        }

        public record C4TokenDetail(
                        String keyword,
                        List<String> choice) {
        }
}