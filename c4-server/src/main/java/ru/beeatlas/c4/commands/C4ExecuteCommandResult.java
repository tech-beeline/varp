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

package ru.beeatlas.c4.commands;

import java.util.Objects;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;

public enum C4ExecuteCommandResult {
    
    UNKNOWN_COMMAND (0),
    ILLEGAL_ARGUMENTS (1),
    STRUCTURIZR_PARSER_EXCEPTION (2),
    IO_EXCEPTION (3),
    TEXT_DECORATIONS (4),
    UNKNOWN_FAILURE (99, "Unknown Failure"),
    OK (100);

    private int resultCode;

    private String message;

    private JsonElement resultData;

    C4ExecuteCommandResult(int resultCode) {
        this(resultCode, "", null);
    }

    C4ExecuteCommandResult(int resultCode, String message) {
        this(resultCode, message, null);
    }

    C4ExecuteCommandResult(int resultCode, String message, JsonElement resultdata) {
        this.resultCode = resultCode;
        this.message = message;
        this.resultData = resultdata;
    }

    public int getResultCode() {
        return resultCode;
    }

    public String getMessage() {
        return message;
    }

    public JsonElement getResultData() {
        return resultData;
    }

    public C4ExecuteCommandResult setMessage(String message) {
        this.message = message;
        return this;
    }
    
    public C4ExecuteCommandResult setResultData(JsonElement resultData) {
        this.resultData = resultData;
        return this;
    }

    public JsonObject toJson() {
        JsonObject jObj = new JsonObject();
        jObj.addProperty("resultcode", this.resultCode);
        jObj.addProperty("message", this.getMessage());
        if(Objects.nonNull(resultData)) {
            jObj.add("resultdata", resultData);
        }
        return jObj;
    }

}

