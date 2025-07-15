package ru.beeatlas.c4.generator;

import java.util.Base64;
import com.structurizr.Workspace;
import com.structurizr.util.WorkspaceUtils;

public class C4Generator {
    public static String generateEncodedWorkspace(Workspace workspace) throws Exception {
        return Base64.getEncoder().encodeToString(WorkspaceUtils.toJson(workspace, false).getBytes());
    }
}
