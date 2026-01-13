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

		List<Location> locations = new ArrayList<>();
		logger.debug("calcDefinitions for line {}", currentLineNumner);

		// search for references in views
		c4Model.getViewAtLineNumber(currentLineNumner).ifPresent( v -> {
			findModelElementById(c4Model, C4Utils.getIdentifierOfView(v), params).ifPresent( locations::add);
		});

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

		c4Model.getIncludeAtLineNumber(currentLineNumner).ifPresent( path -> {
			final int startPos = C4Utils.getStartPosition(c4Model.getLineAt(params.getPosition().getLine()), path);
			final int endPos = startPos + path.length();
			if(params.getPosition().getCharacter() >= startPos && params.getPosition().getCharacter() <= endPos) {
				C4DocumentModel ref = c4Model.getReferencedModelByPath(path);
				final Location location = new Location();
				location.setRange(new Range(new Position(0,0), new Position(0,0)));
				location.setUri(ref.getUri());
				locations.add(location);
			}
			logger.debug("**** START_POS INCLUDE "+startPos);
		});

		return Either.forLeft(locations);
	}

	private Optional<Location> findModelElementById(C4DocumentModel hostModel, String id, DefinitionParams params) {

		if(id == null || id.equals(IDENTIFIER_WILDCARD)) {
			return Optional.empty();
		}

		Optional<Location> result = Optional.empty();
		List<Entry<Integer, C4ObjectWithContext<Element>>> refs = hostModel.findElementsById(id);
		if(refs.isEmpty()) {
			C4DocumentModel extendsBy = hostModel.getExtendsBy();
			if(extendsBy != null) {
				refs = extendsBy.findElementsById(id);
			}
		}
		logger.info(id + " -> " + refs.size());
		if(refs.size() == 1) {
			C4DocumentModel refModel = refs.get(0).getValue().getContainer();
			int refLineNumber = refs.get(0).getKey();
			Optional<C4ObjectWithContext<Element>> optionalElement = refModel.getElementAtLineNumber(refLineNumber);
			if(optionalElement.isPresent()) {
				C4ObjectWithContext<Element> element = optionalElement.get();
				logger.debug("Found referenced element in line {} for usage in line {}", refLineNumber, params.getPosition().getLine());
				logger.debug("    Details: {}",element.getIdentifier());
				int startPos = C4Utils.getStartPosition(hostModel.getLineAt(params.getPosition().getLine()), element.getIdentifier());
				if(startPos == C4Utils.NOT_FOUND_WITHIN_STRING) {
					logger.error("Identifier {} not found in line {} ", element.getIdentifier(), params.getPosition().getLine());
				} else {
					int endPos = startPos + element.getIdentifier().length();
					if(params.getPosition().getCharacter() >= startPos && params.getPosition().getCharacter() <= endPos) {
						logger.debug("    Cursor {} within range [{}, {}]", params.getPosition().getCharacter(), startPos, endPos);
						result = Optional.of(createLocation(refModel, refLineNumber-1, element.getIdentifier()));
					} else {
						String fullIdentifier = element.getIdentifier();
						Element parent = element.getObject().getParent();
						while(parent != null) {
							refs = hostModel.findElementsById(parent.getId());
							if(refs.isEmpty()) {
								C4DocumentModel extendsBy = hostModel.getExtendsBy();
								if(extendsBy != null) {
									refs = extendsBy.findElementsById(parent.getId());
								}
							}
							if(refs.size() == 1) {
								fullIdentifier = refs.get(0).getValue().getIdentifier() + "." + fullIdentifier;
							}
							parent = parent.getParent();
						}
						startPos = C4Utils.getStartPosition(hostModel.getLineAt(params.getPosition().getLine()), fullIdentifier);
						if(startPos == C4Utils.NOT_FOUND_WITHIN_STRING) {
							logger.error("Identifier {} not found in line {} ", element.getIdentifier(), params.getPosition().getLine());
						} else {
							endPos = startPos + fullIdentifier.length();
							if(params.getPosition().getCharacter() >= startPos && params.getPosition().getCharacter() <= endPos) {
								logger.debug("    Cursor {} within range [{}, {}]", params.getPosition().getCharacter(), startPos, endPos);
								result = Optional.of(createLocation(refModel, refLineNumber - 1, element.getIdentifier()));
							} else {
								logger.debug("    Cursor {} out of range [{}, {}]", params.getPosition().getCharacter(), startPos, endPos);
							}
						}
					}
				}
			}
		}

		return result;
	}

	private Location createLocation(C4DocumentModel c4Model, int lineNumber, String referencedId) {
		final int refStartPos = c4Model.getLineAt(lineNumber).indexOf(referencedId);
		final int refEndPos = refStartPos + referencedId.length();
		logger.debug("    Reference Found at linenumber {}, in range [{}, {}]", lineNumber, refStartPos, refEndPos);
		return new Location(c4Model.getUri(),
				new Range(new Position(lineNumber, refStartPos), new Position(lineNumber, refEndPos)));
	}

}
