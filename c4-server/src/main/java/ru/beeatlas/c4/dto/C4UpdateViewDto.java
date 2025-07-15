package ru.beeatlas.c4.dto;

import com.google.gson.Gson;
import com.google.gson.JsonObject;

public record C4UpdateViewDto (String document, String viewKey, String renderer) {
    private static final Gson GSON = new Gson();
    public static C4UpdateViewDto fromJson(JsonObject jsonObject) {
        return GSON.fromJson(jsonObject, C4UpdateViewDto.class);
    }
}