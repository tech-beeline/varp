package ru.beeatlas.c4.utils;

import com.structurizr.export.Diagram;
import com.structurizr.view.ModelView;

public class MxDiagram  extends Diagram {
    public MxDiagram(ModelView view, String definition) {
        super(view, definition);
    }

    @Override
    public String getFileExtension() {
        return "drawio";
    }    
}
