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

package ru.beeatlas.c4.intercept;

import java.io.File;
import java.util.List;

import com.structurizr.model.Element;
import com.structurizr.model.Relationship;
import com.structurizr.view.View;
import com.structurizr.dsl.DslPackage.Line;
import com.structurizr.dsl.StructurizrDslParserException;

public interface StructurizrDslParserListener {

	default void onLines(List<Line> lines) { }

	default void onNewLine() { }

	default void onParsedView(View view) { }

	default void onParsedRelationShip(Relationship relationship) { }
	
	default void onParsedModelElement(Element item) { }
	
	default void onParsedColor() { }
	
	default void onInclude(File referencedFile) { }

    default void onStartContext(int contextId, String contextName) { }

    default void onEndContext(int contextId, String contextName) { }

	default void onRunScript(List<String> lines) { }

	default void onException(StructurizrDslParserException e) throws StructurizrDslParserException { } 

	default void onParsedProperty(String name, String value) { }

	default void onIdentifier(String identifier) { }

	default void onStartFile(File file)	{ }

	default void onEndFile() { }

	default void onExtendsBy(File file) { }	

	default void onLeadingSpace(int leadingSpace) { }	
}
