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

import { describe, it, expect } from 'vitest';
import { EmptyFileSystem } from 'langium';
import { URI } from 'vscode-uri';
import { createC4Services } from './c4-module';

// Positive !elements / !element output is covered by the vendor-verified
// fixtures elements-directive-bulk, elements-directive-implicit-relationship,
// elements-directive-this-target, element-extension-repeated-fields, and
// element-extension-props-merge. Only the parser diagnostic that has no
// vendor JSON output is asserted here.
describe('!elements directive', () => {
    it('rejects an !include inside !elements', async () => {
        const services = createC4Services({ connection: undefined as any, ...EmptyFileSystem }).C4;
        const doc = services.shared.workspace.LangiumDocumentFactory.fromString(`workspace {
    model {
        !elements element.type==Container {
            !include "frag.dsl"
        }
    }
}
`, URI.parse('file:///elements-include.dsl'));
        services.shared.workspace.LangiumDocuments.addDocument(doc);
        await services.shared.workspace.DocumentBuilder.build([doc]);

        expect(doc.parseResult.parserErrors.length).toBeGreaterThan(0);
    });
});
