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
import { C4JsonGenerator } from './c4-json-generator';
import { isWorkspace } from '../generated/ast';

async function generate(dsl: string): Promise<any> {
    const services = createC4Services({ connection: undefined as any, ...EmptyFileSystem }).C4;
    const doc = services.shared.workspace.LangiumDocumentFactory.fromString(dsl, URI.parse('file:///substitution.dsl'));
    services.shared.workspace.LangiumDocuments.addDocument(doc);
    await services.shared.workspace.DocumentBuilder.build([doc]);
    const root = doc.parseResult.value;
    if (isWorkspace(root)) {
        return new C4JsonGenerator(services).generate(root);
    }
    const anyRoot = root as any;
    if (anyRoot.$type === 'C4Document' && anyRoot.workspaces?.length > 0) {
        return new C4JsonGenerator(services).generate(anyRoot.workspaces[0]);
    }
    throw new Error('No workspace found');
}

describe('constant substitution', () => {
    it('substitutes constants in group names', async () => {
        const json = await generate(`!const ORGANISATION_NAME "Organisation"
!const GROUP_NAME "Group"

workspace {
    model {
        group "\${ORGANISATION_NAME} - \${GROUP_NAME}" {
            u = person "User"
        }
    }
}
`);

        expect(json.model.people[0].group).toBe('Organisation - Group');
    });

    it('substitutes constants in nested group paths', async () => {
        const json = await generate(`!const OUTER "Outer"
!const INNER "Inner"

workspace {
    model {
        group "\${OUTER}" {
            group "\${INNER}" {
                u = person "User"
            }
        }
    }
}
`);

        expect(json.model.people[0].group).toBe('Outer/Inner');
    });
});
