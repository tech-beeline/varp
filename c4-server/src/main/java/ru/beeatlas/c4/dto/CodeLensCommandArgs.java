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

package ru.beeatlas.c4.dto;

import com.google.gson.Gson;
import com.google.gson.JsonObject;

public record CodeLensCommandArgs(String encodedWorkspace, String diagramKey, String diagramAsDot, String deploymentEnvironment, String apiUrl, Integer lastLine, Integer padding) {
    private static final Gson GSON = new Gson();
    public static CodeLensCommandArgs fromJson(JsonObject jsonObject) {
        return GSON.fromJson(jsonObject, CodeLensCommandArgs.class);
    }    
}
