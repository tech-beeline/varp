/*
	Copyright 2026 VimpelCom PJSC

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

import { DefaultLinker, type AstNodeDescription, type LinkingError, type ReferenceInfo } from 'langium';
import {
    isArchetypeInstance,
    isElementExtension,
    isImplicitRelationship,
    isRelationship,
    isSingleElementExpression,
} from '../generated/ast';
import { getBlockTokens } from './c4-tokens';

/**
 * Linker whose messages name what the document is missing.
 *
 * The default message prints the AST type of the reference target ("RelationshipMember",
 * "NamedElement"), which says nothing about the mistake. The cases below use the wording
 * of the reference implementation, and an unresolved archetype name is reported as an
 * unexpected token: an archetype instance starts with the archetype name, so in any block
 * that accepts instances a misspelled keyword parses as one.
 */
export class C4Linker extends DefaultLinker {
    protected override createLinkingError(refInfo: ReferenceInfo, targetDescription?: AstNodeDescription): LinkingError {
        const error = super.createLinkingError(refInfo, targetDescription);
        const message = this.describeMissingTarget(refInfo);
        return message === undefined ? error : { ...error, message };
    }

    private describeMissingTarget(refInfo: ReferenceInfo): string | undefined {
        const container = refInfo.container;
        const name = refInfo.reference.$refText;
        if (isRelationship(container) || isImplicitRelationship(container)) {
            if (refInfo.property === 'source') {
                return `The source element "${name}" does not exist`;
            }
            if (refInfo.property === 'target') {
                return `The destination element "${name}" does not exist`;
            }
        }
        if (isElementExtension(container) && refInfo.property === 'target') {
            return `An element identified by "${name}" could not be found`;
        }
        if (isSingleElementExpression(container) && refInfo.property === 'element') {
            return `The element/relationship "${name}" does not exist`;
        }
        if (isArchetypeInstance(container) && refInfo.property === 'archetype') {
            const block = container.$container;
            const tokens = block === undefined ? undefined : getBlockTokens(block.$type);
            if (tokens !== undefined) {
                return `Unexpected token '${name}' (expected: ${tokens.join(', ')}). `
                    + `No archetype named '${name}' is defined.`;
            }
        }
        return undefined;
    }
}
