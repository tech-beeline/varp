package ru.beeatlas.c4.commands;

import java.util.Arrays;
import java.util.List;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import ru.beeatlas.c4.model.C4DocumentManager;

public class C4ExecuteCommandProvider {

    public static final String UPDATE_CONFIGURATION = "c4-server.configuration";
    public static final String CALCULATE_TEXT_DECORATIONS = "c4-server.text-decorations";
    public static final String AUTO_FORMAT_INDENT = "c4-server.autoformat.indent";
    public static final String REFRESH_PREVIEW = "c4.refresh";
    public static final String SEND_SNIPPET_TELEMETRY = "c4-server.send-snippet-telemetry";
    public static final String SEND_DEPLOYMENT_TELEMETRY = "c4-server.send-deployment-telemetry";

    private static final Logger logger = LoggerFactory.getLogger(C4ExecuteCommandProvider.class);

    public static final List<String> SERVER_COMMANDS = Arrays.asList(UPDATE_CONFIGURATION, 
        CALCULATE_TEXT_DECORATIONS, AUTO_FORMAT_INDENT, REFRESH_PREVIEW, SEND_SNIPPET_TELEMETRY, SEND_DEPLOYMENT_TELEMETRY);

    public static C4ExecuteCommandResult execute(String command, List<Object> arguments, C4DocumentManager documentManager) {

        switch (command) {
           
            case UPDATE_CONFIGURATION:
                logger.info("Update configuration {}", arguments.get(0).toString());
                return C4ExecuteCommandResult.OK;

            case CALCULATE_TEXT_DECORATIONS:
                logger.error("CALCULATE_TEXT_DECORATIONS should not be handled here");
                return C4ExecuteCommandResult.UNKNOWN_FAILURE;

            case REFRESH_PREVIEW:
                logger.error("REFRESH_PREVIEW should not be handled here");
                return C4ExecuteCommandResult.UNKNOWN_FAILURE;

            default:
                logger.error("Unknown command {}", command);
                return C4ExecuteCommandResult.UNKNOWN_COMMAND.setMessage(command);
        }
    }
    
}
