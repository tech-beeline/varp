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

import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.Reader;

import com.google.gson.Gson;

public class C4TokensLoader {

    private final static String TOKEN_CONFIG = "config/c4tokens.json";

    public C4TokensConfig readConfiguration() {
        InputStream configIs = this.getClass().getClassLoader().getResourceAsStream(TOKEN_CONFIG);
        Reader reader = new InputStreamReader(configIs);
        return (new Gson()).fromJson(reader, C4TokensConfig.class);
    }

}
