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

import { ValueConverter, CstNode, ValueType, GrammarAST } from "langium";

/**
 * Custom value converter for C4 DSL.
 * Strips the trailing '=' from ASSIGNMENT tokens used in element ID assignments
 * (e.g., `mySystem = person "Name"` → `mySystem`), while preserving '=' in
 * property key/value assignments where it's part of the syntax.
 */
export class C4ValueConverter implements ValueConverter {
    convert(input: string, cstNode: CstNode): ValueType {
        const tokenName = (cstNode as any).tokenType?.name;

        if (tokenName === 'ASSIGNMENT') {
            let current: CstNode | undefined = cstNode.container;
            while (current) {
                const source = current.grammarSource;
                if (GrammarAST.isAssignment(source)) {
                    // Preserve '=' for property key/value assignments (name=value syntax)
                    const preserve = ['name', 'value', 'items', 'propertyKey', 'propertyValue'];
                    if (preserve.includes(source.feature)) {
                        return input;
                    }
                    // For element ID assignments (feature 'id'), strip the trailing '=' only
                    if (source.feature === 'id') {
                        return input.substring(0, input.length - 1).trim();
                    }
                }
                current = current.container;
            }
            return input.substring(0, input.length - 1).trim();
        }
        return input;
    }
}