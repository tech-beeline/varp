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

import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

import org.eclipse.lsp4j.MessageParams;
import org.eclipse.lsp4j.MessageType;
import org.eclipse.lsp4j.services.LanguageClient;

public class ClientOutputStream extends OutputStream {

    protected final LanguageClient client;

    public ClientOutputStream(LanguageClient client) {
        this.client = client;
    }

    @Override
    public void write(byte b[]) throws IOException {
        String message = new String(b, StandardCharsets.UTF_8);
        MessageParams params = new MessageParams(MessageType.Log, message);
        client.logMessage(params);
    }

    @Override
    public void write(int b) throws IOException {
        throw new UnsupportedOperationException("Unimplemented method 'write'");
    }

}