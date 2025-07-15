package ru.beeatlas.c4.intercept;

import java.io.File;
import java.util.LinkedList;
import java.util.List;

import com.structurizr.model.Element;
import com.structurizr.model.Relationship;
import com.structurizr.view.View;
import com.structurizr.dsl.DslPackage.Line;
import com.structurizr.dsl.StructurizrDslParserException;

public interface StructurizrDslParserListener {

	default void onLines(LinkedList<Line> lines) { }

	default void onNewLine() { }

	default void onParsedView(View view) { }

	default void onParsedRelationShip(Relationship relationship) { }
	
	default void onParsedModelElement(Element item) { }
	
	default void onParsedColor() { }
	
	default void onInclude(File referencedFile, String path) { }

    default void onStartContext(int contextId, String contextName) { }

    default void onEndContext(int contextId, String contextName) { }

	default void onRunScript(List<String> lines) { }

	default void onException(StructurizrDslParserException e) throws StructurizrDslParserException { } 

	default void onParsedProperty(String name, String value) { }

	default void onIdentifier(String identifier) { }

	default void onStartFile(File file)	{ }

	default void onEndFile() { }

	default void onExtendsBy(File file) { }	

	default String findContent(File file) { return null; }
}
