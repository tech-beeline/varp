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

import { DefaultNameProvider, AstNode, AstUtils } from 'langium';
import { isIdentifiersProperty, isWorkspace } from '../generated/ast';
import { C4Utils } from './c4-utils';

/**
 * Custom name provider for C4 DSL.
 * Ensures that !identifiers directives and unnamed workspaces
 * have valid names for the Langium index and scope system.
 */
export class C4NameProvider extends DefaultNameProvider {
    override getName(node: AstNode): string | undefined {
        if (isIdentifiersProperty(node)) {
            // Assign a fixed name so !identifiers directives are indexed
            return 'identifiers-settings'; 
        }
        if (isWorkspace(node) && !node.name) {
            // Stable technical name for unnamed workspaces: derived from the
            // document URI plus the CST offset (so several unnamed workspaces in
            // one file stay distinct). Deterministic across rebuilds - unlike a
            // random UUID - and independent of the browser secure-context crypto API.
            const docUri = AstUtils.getDocument(node)?.uri.toString() ?? 'workspace';
            const offset = node.$cstNode?.offset ?? 0;
            return `ws-${C4Utils.stringHash(`${docUri}#${offset}`)}`;
        }
        return super.getName(node);
    }
}
