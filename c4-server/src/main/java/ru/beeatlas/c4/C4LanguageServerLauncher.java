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

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.StandardSocketOptions;
import java.nio.channels.Channels;
import java.nio.channels.AsynchronousServerSocketChannel;
import java.nio.channels.AsynchronousSocketChannel;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.Future;
import org.eclipse.lsp4j.jsonrpc.Launcher;
import org.eclipse.lsp4j.launch.LSPLauncher;
import org.eclipse.lsp4j.services.LanguageClient;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import ru.beeatlas.c4.service.C4LanguageServer;
import picocli.CommandLine;
import picocli.CommandLine.Option;

public class C4LanguageServerLauncher implements Callable<Integer> {

    private static final Logger logger = LoggerFactory.getLogger(C4LanguageServerLauncher.class);

    @Option(names = {"-e", "--echo"}, description = "Echo to the client, to inform that socket can now accept incoming connections")
    private String echo = "READY_TO_CONNECT";

    @Override
    public Integer call() throws Exception {

		try {

            final AsynchronousServerSocketChannel serverSocket = AsynchronousServerSocketChannel.open();
            if (serverSocket.isOpen()) {

                serverSocket.setOption(StandardSocketOptions.SO_RCVBUF, 1024);
                serverSocket.setOption(StandardSocketOptions.SO_REUSEADDR, true);
                serverSocket.bind(new InetSocketAddress("127.0.0.1", 5008));
                Future<AsynchronousSocketChannel> acceptFuture = serverSocket.accept();
                // echo to the client, that server is ready to receive incoming connections
                System.out.println(echo);
                final AsynchronousSocketChannel socketChannel = acceptFuture.get();
                serverSocket.close();
                InputStream in = Channels.newInputStream(socketChannel);
                OutputStream out = Channels.newOutputStream(socketChannel);
                C4LanguageServer c4LanguageServer = new C4LanguageServer();
                Launcher<LanguageClient> launcher = LSPLauncher.createServerLauncher(c4LanguageServer, in, out);
                // Get the client that request to launch the LS.
                LanguageClient client = launcher.getRemoteProxy();
                // Set the client to language server
                c4LanguageServer.connect(client);
                // Start the listener for JsonRPC
                Future<?> startListening = launcher.startListening();
                // Get the computed result from LS.
                startListening.get();
            }

		} 
        catch (ExecutionException e) {
			logger.error(e.getMessage());
		} 
        catch (InterruptedException e) {
			logger.error(e.getMessage());
		} 
        catch (IOException e) {
			logger.error(e.getMessage());
        }
		
        return 1;
	}

	public static void main(String[] args) {
        int exitCode = new CommandLine( new C4LanguageServerLauncher()).execute(args);
        System.exit(exitCode);
    }
	
}
