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