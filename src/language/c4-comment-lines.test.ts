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
import { EmptyFileSystem, type LangiumDocument } from 'langium';
import { URI } from 'vscode-uri';
import { createC4Services } from './c4-module';

/** Parses a DSL string with validation enabled. */
async function build(content: string): Promise<LangiumDocument> {
    const services = createC4Services({ connection: undefined as any, ...EmptyFileSystem }).C4;
    const doc = services.shared.workspace.LangiumDocumentFactory.fromString(
        content,
        URI.parse('file:///comment-lines.dsl')
    );
    services.shared.workspace.LangiumDocuments.addDocument(doc);
    await services.shared.workspace.DocumentBuilder.build([doc], { validation: true });
    return doc;
}

/**
 * A comment-only line is a hidden token, but its newline is not absorbed by the
 * multi-line NL terminal, so it adds an extra NL to the token stream. Blocks must
 * tolerate that before their closing brace.
 */
const cases: Record<string, string> = {
    'properties': `workspace {
    properties {
        "structurizr.dslEditor" "false"
        // comment
    }
}
`,
    'properties in views': `workspace {
    views {
        properties {
            "a" "b"
            // comment
        }
    }
}
`,
    'properties with a leading comment': `workspace {
    properties {
        // comment
        "a" "b"
    }
}
`,
    'properties with a blank line': `workspace {
    properties {
        "a" "b"

    }
}
`,
    'model': `workspace {
    model {
        person "A"
        // comment
    }
}
`,
    'views': `workspace {
    views {
        systemLandscape "land" {
            include *
        }
        // comment
    }
}
`,
    'view body': `workspace {
    views {
        systemLandscape "land" {
            include *
            // comment
        }
    }
}
`,
    'styles': `workspace {
    views {
        styles {
            element "x" {
                shape Box
            }
            // comment
        }
    }
}
`,
    'configuration': `workspace {
    configuration {
        scope softwaresystem
        // comment
    }
}
`,
    'element body': `workspace {
    model {
        person "A" {
            tags "x"
            // comment
        }
    }
}
`,
    'relationship body': `workspace {
    model {
        a = person "A"
        b = person "B"
        a -> b "uses" {
            tags "x"
            // comment
        }
    }
}
`,
    'archetypes': `workspace {
    model {
        archetypes {
            dev = person
            // comment
        }
    }
}
`,
    'terminology': `workspace {
    views {
        terminology {
            person "User"
            // comment
        }
    }
}
`,
    'perspectives': `workspace {
    model {
        person "A" {
            perspectives {
                perspective "x" {
                    value "y"
                }
            }
            // comment
        }
    }
}
`,
    'script body': `workspace {
    !script javascript {
        // comment
    }
}
`,
    'script body with a blank line': `workspace {
    !script javascript {
        // comment

    }
}
`,
    'plugin body': `workspace {
    !plugin "com.example" {
        // comment
    }
}
`,
    'plugin body with a blank line': `workspace {
    !plugin "com.example" {
        // comment

    }
}
`,
    'components body': `workspace {
    model {
        sys = softwareSystem "Sys" {
            c = container "C" {
                !components {
                    // comment
                }
            }
        }
    }
}
`,
};

describe('comment-only lines inside blocks', () => {
    for (const [name, dsl] of Object.entries(cases)) {
        it(`parses ${name}`, async () => {
            const doc = await build(dsl);
            expect(doc.parseResult.parserErrors.length).toBe(0);
        });
    }
});
