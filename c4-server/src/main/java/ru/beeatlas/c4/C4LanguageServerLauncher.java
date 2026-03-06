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

package ru.beeatlas.c4;

import java.io.InputStream;
import java.io.OutputStream;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.Future;
import org.eclipse.lsp4j.jsonrpc.Launcher;
import org.eclipse.lsp4j.launch.LSPLauncher;
import org.eclipse.lsp4j.services.LanguageClient;
import ru.beeatlas.c4.custom.Custom;
import ru.beeatlas.c4.service.C4LanguageServer;

public class C4LanguageServerLauncher {

	public static void main(String[] args) {
        InputStream in = System.in;
        OutputStream out = System.out;
        System.setOut(System.err);
        C4LanguageServer c4LanguageServer = new C4LanguageServer();
        Launcher<LanguageClient> launcher = LSPLauncher.createServerLauncher(c4LanguageServer, in, out);
        // Get the client that request to launch the LS.
        LanguageClient client = launcher.getRemoteProxy();
        // Set the client to language server
        c4LanguageServer.connect(client);
        Custom.getInstance().setClient(client);
        // Start the listener for JsonRPC
        Future<?> startListening = launcher.startListening();
        // Get the computed result from LS.
        try {
            startListening.get();
        } catch (InterruptedException | ExecutionException e) {
            System.exit(1);
        }
        System.exit(0);
    }
	
}
