package ru.beeatlas.c4.commands;

import java.util.List;

public interface C4CommandHandler {
    
    public C4ExecuteCommandResult handleRequest(List<Object> arguments);

}
