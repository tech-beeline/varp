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

package ru.beeatlas.c4.provider;

import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.Map.Entry;

import org.eclipse.lsp4j.DefinitionParams;
import org.eclipse.lsp4j.Location;
import org.eclipse.lsp4j.LocationLink;
import org.eclipse.lsp4j.Position;
import org.eclipse.lsp4j.Range;
import org.eclipse.lsp4j.jsonrpc.messages.Either;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import com.structurizr.model.ContainerInstance;
import com.structurizr.model.Element;
import com.structurizr.model.SoftwareSystemInstance;

import ru.beeatlas.c4.utils.C4Utils;
import ru.beeatlas.c4.model.C4DocumentModel;
import ru.beeatlas.c4.model.C4ObjectWithContext;

public class C4DefinitionProvider {

    private static final Logger logger = LoggerFactory.getLogger(C4DefinitionProvider.class);
	private static final String IDENTIFIER_WILDCARD = "*";

	public Either<List<? extends Location>, List<? extends LocationLink>> calcDefinitions(C4DocumentModel c4Model, DefinitionParams params) {

		int currentLineNumner = params.getPosition().getLine() + 1;

		List<LocationLink> locations = new ArrayList<>();
		logger.debug("calcDefinitions for line {}", currentLineNumner);

		// search for references in views
		c4Model.getViewAtLineNumber(currentLineNumner).ifPresent( v -> 
			findModelElementById(c4Model, C4Utils.getIdentifierOfView(v), params).ifPresent( locations::add)
		);

		c4Model.getRelationshipAtLineNumber(currentLineNumner).ifPresent( r -> {
			findModelElementById(c4Model, r.getObject().getSourceId(), params).ifPresent( locations::add);
			findModelElementById(c4Model, r.getObject().getDestinationId(), params).ifPresent( locations::add);
		});

		c4Model.getElementAtLineNumber(currentLineNumner).ifPresent(e -> {
			if (e.getObject() instanceof ContainerInstance containerInstance) {
				findModelElementById(c4Model, containerInstance.getContainerId(), params).ifPresent(locations::add);
			} else if (e.getObject() instanceof SoftwareSystemInstance softwareSystemInstance) {
				findModelElementById(c4Model, softwareSystemInstance.getSoftwareSystemId(), params).ifPresent(locations::add);
			}
		});

		c4Model.getIncludeAtLineNumber(currentLineNumner).ifPresent(path -> {
			final String lineText = c4Model.getLineAt(params.getPosition().getLine());
			Path fullPath = Paths.get(path);
			Path fileNamePath = fullPath.getFileName();
			final int startPos = C4Utils.getStartPosition(lineText, fileNamePath.toString());
			path = fileNamePath.toString();
			if (startPos != C4Utils.NOT_FOUND_WITHIN_STRING) {
				final int endPos = startPos + path.length();
				int cursorChar = params.getPosition().getCharacter();
				if (cursorChar >= startPos && cursorChar <= endPos) {
					C4DocumentModel ref = c4Model.getReferencedModelByPath(path);
					if (ref != null) {
						LocationLink link = new LocationLink();
						link.setOriginSelectionRange(new Range(
							new Position(params.getPosition().getLine(), startPos),
							new Position(params.getPosition().getLine(), endPos)
						));
						link.setTargetUri(ref.getUri());
						Range fullFileRange = new Range(new Position(0, 0), new Position(0, 0));
						link.setTargetRange(fullFileRange);
						link.setTargetSelectionRange(fullFileRange);
						locations.add(link);
					}
				}
			}
			logger.debug("**** START_POS INCLUDE " + startPos);
		});

		return Either.forRight(locations);
	}

	private Optional<LocationLink> findModelElementById(C4DocumentModel hostModel, String id, DefinitionParams params) {
		if (id == null || id.equals(IDENTIFIER_WILDCARD)) {
			return Optional.empty();
		}

		List<Entry<Integer, C4ObjectWithContext<Element>>> refs = hostModel.findElementsById(id);
		if (refs.isEmpty() && hostModel.getExtendsBy() != null) {
			refs = hostModel.getExtendsBy().findElementsById(id);
		}

		if (refs.size() == 1) {
			int refLineNumber = refs.get(0).getKey();
			C4DocumentModel refModel = refs.get(0).getValue().getContainer();
			Optional<C4ObjectWithContext<Element>> optionalElement = refModel.getElementAtLineNumber(refLineNumber);

			if (optionalElement.isPresent()) {
				C4ObjectWithContext<Element> element = optionalElement.get();
				String currentLineText = hostModel.getLineAt(params.getPosition().getLine());
				String fullIdentifier = element.getIdentifier(); 
				int startPos = C4Utils.getStartPosition(currentLineText, fullIdentifier);
				if (startPos != C4Utils.NOT_FOUND_WITHIN_STRING) {
					int endPos = startPos + fullIdentifier.length();
					int cursorChar = params.getPosition().getCharacter();
					if (cursorChar >= startPos && cursorChar <= endPos) {
						Range originRange = new Range(
							new Position(params.getPosition().getLine(), startPos),
							new Position(params.getPosition().getLine(), endPos)
						);
						return Optional.of(createLocationLink(refModel, refLineNumber - 1, element.getIdentifier(), originRange));
					}
				}
			}
		}
		return Optional.empty();
	}

	private LocationLink createLocationLink(C4DocumentModel targetModel, int targetLine, String targetId, Range originRange) {
		String lineText = targetModel.getLineAt(targetLine);
		int startPos = lineText.indexOf(targetId);
		if (startPos == -1) startPos = 0;
		int endPos = startPos + targetId.length();
		Range selectionRange = new Range(new Position(targetLine, startPos), new Position(targetLine, endPos));
		Range targetRange = new Range(new Position(targetLine, 0), new Position(targetLine, lineText.length()));
		LocationLink link = new LocationLink();
		link.setOriginSelectionRange(originRange);
		link.setTargetUri(targetModel.getUri());
		link.setTargetRange(targetRange);
		link.setTargetSelectionRange(selectionRange);
		return link;
	}	

}