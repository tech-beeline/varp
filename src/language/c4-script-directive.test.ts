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

const ERROR_SEVERITY = 1;

async function build(content: string) {
    const services = createC4Services({ connection: undefined as any, ...EmptyFileSystem }).C4;
    const doc = services.shared.workspace.LangiumDocumentFactory.fromString(content, URI.parse('file:///script.dsl'));
    services.shared.workspace.LangiumDocuments.addDocument(doc);
    await services.shared.workspace.DocumentBuilder.build([doc], { validation: true });
    return doc;
}

/**
 * Script bodies are opaque: the grammar must accept any token the language can contain,
 * so operators such as `!=`, `==`, `&&`, `||`, `?`, `~`, `|`, `^`, `<` and multi-line
 * text blocks do not break the surrounding workspace. Covers every inline language form,
 * all directive contexts, nested braces and closures.
 */
const SCRIPT_BODIES = `workspace {
    model {
        !script groovy {
            // line comment
            /* block comment */
            def thresholds = [low: 1, high: 2]
            def flag = (thresholds != null && thresholds == [low: 1, high: 2]) || !done
            def pick = flag ? "yes" : "no"
            def bits = (1 | 2) ^ ~3
            def cmp = 1 < 2 && 2 > 1
            def sum = 1 + 2 - 3 * 4 / 5
            def inc = 0; inc++; inc--; inc += 1; inc -= 1
            def braces = "a { b } c"
            def text = """multi
line \${pick}"""
            workspace.model.relationships.forEach { it ->
                it.description = "\${it.id} -- \${it.description}"
            }
            if (pick) { println "done" }
        }

        a = softwareSystem "A" {
            !script groovy {
                def owner = a != null ? a.name : "unknown"
            }
        }
        b = softwareSystem "B"
        a -> b "Uses"

        group "Group" {
            !script ruby {
                items.each do |item|
                    puts item unless item.nil?
                end
            }
        }
    }

    views {
        systemLandscape {
            include *
            !script javascript {
                const systems = workspace.model.softwareSystems;
                systems.forEach(s => { s.description = s.name + " (id)"; });
                if (systems.length !== 0 && systems.length >= 1) { console.log("ok"); }
                if (systems.length === 1 || systems.length <= 1) { console.log("edge"); }
            }
        }
    }

    !script kotlin {
        val n = 1
        val m = if (n > 0) n else -n
        val names = listOf("a", "b").map { it * 2 }
        val safe = names?.size ?: 0
    }

    !script scripts/example.groovy
}
`;

describe('!script bodies', () => {
    it('parses comprehensive script bodies in every context without errors', async () => {
        const doc = await build(SCRIPT_BODIES);
        const parserErrors = doc.parseResult.parserErrors.map(e => e.message.split('\n')[0]);
        expect(parserErrors).toEqual([]);
        const diagnostics = (doc.diagnostics ?? [])
            .filter(d => d.severity === ERROR_SEVERITY)
            .map(d => (typeof d.message === 'string' ? d.message : d.message.value));
        expect(diagnostics).toEqual([]);
    });
});
