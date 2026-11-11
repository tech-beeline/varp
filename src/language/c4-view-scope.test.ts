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

async function buildDocument(content: string): Promise<LangiumDocument> {
    const services = createC4Services({ connection: undefined as any, ...EmptyFileSystem }).C4;
    const doc = services.shared.workspace.LangiumDocumentFactory.fromString(content, URI.parse('file:///view-scope.dsl'));
    services.shared.workspace.LangiumDocuments.addDocument(doc);
    await services.shared.workspace.DocumentBuilder.build([doc], { validation: true });
    return doc;
}

function diagnostics(doc: LangiumDocument): string[] {
    return (doc.diagnostics ?? []).map(d => (typeof d.message === 'string' ? d.message : d.message.value));
}

describe('view scope references', () => {
    it('reports an unknown system context scope as a missing software system', async () => {
        const doc = await buildDocument(`workspace {
    model {
        a = softwareSystem "A"
    }
    views {
        systemContext missing {
            include *
        }
    }
}
`);

        expect(diagnostics(doc)).toEqual(['The software system "missing" does not exist']);
    });

    it('reports a container used as a system context scope as the wrong element kind', async () => {
        const doc = await buildDocument(`workspace {
    model {
        a = softwareSystem "A" {
            s = container "S"
        }
    }
    views {
        systemContext s {
            include *
        }
    }
}
`);

        expect(diagnostics(doc)).toEqual(['The element "s" is not a software system']);
    });

    it('reports a software system used as a component view scope as the wrong element kind', async () => {
        const doc = await buildDocument(`workspace {
    model {
        a = softwareSystem "A"
    }
    views {
        component a {
            include *
        }
    }
}
`);

        expect(diagnostics(doc)).toEqual(['The element "a" is not a container']);
    });

    it('reports an unknown component view scope as a missing container', async () => {
        const doc = await buildDocument(`workspace {
    model {
        a = softwareSystem "A"
    }
    views {
        component missing {
            include *
        }
    }
}
`);

        expect(diagnostics(doc)).toEqual(['The container "missing" does not exist']);
    });

    it('reports an unknown deployment environment', async () => {
        const doc = await buildDocument(`workspace {
    model {
        a = softwareSystem "A"
        live = deploymentEnvironment "Live" {
            deploymentNode "Node" {
            }
        }
    }
    views {
        deployment a "Nope" {
            include *
        }
    }
}
`);

        expect(diagnostics(doc)).toEqual(['The environment "Nope" does not exist']);
    });

    it('reports a component used as a dynamic view scope as the wrong element kind', async () => {
        const doc = await buildDocument(`workspace {
    model {
        a = softwareSystem "A" {
            s = container "S" {
                c = component "C"
            }
        }
    }
    views {
        dynamic c {
            c -> c "calls"
        }
    }
}
`);

        expect(diagnostics(doc)).toEqual(['The element "c" is not a software system or container']);
    });

    it('reports an unknown dynamic view scope', async () => {
        const doc = await buildDocument(`workspace {
    model {
        a = softwareSystem "A"
    }
    views {
        dynamic missing {
            a -> a "calls"
        }
    }
}
`);

        expect(diagnostics(doc)).toEqual(['The software system or container "missing" does not exist']);
    });

    it('reports an unknown image view scope as a missing element', async () => {
        const doc = await buildDocument(`workspace {
    model {
        a = softwareSystem "A"
    }
    views {
        image missing {
            plantuml "x"
        }
    }
}
`);

        expect(diagnostics(doc)).toEqual(['The element "missing" does not exist']);
    });

    it('reports a relationship used as a system context scope as missing', async () => {
        const doc = await buildDocument(`workspace {
    model {
        a = softwareSystem "A"
        b = softwareSystem "B"
        r = a -> b "calls"
    }
    views {
        systemContext r {
            include *
        }
    }
}
`);

        expect(diagnostics(doc)).toEqual(['The software system "r" does not exist']);
    });

    it('reports a relationship used as a dynamic view scope as missing', async () => {
        const doc = await buildDocument(`workspace {
    model {
        a = softwareSystem "A"
        b = softwareSystem "B"
        r = a -> b "calls"
    }
    views {
        dynamic r {
            a -> b "calls"
        }
    }
}
`);

        expect(diagnostics(doc)).toEqual(['The software system or container "r" does not exist']);
    });

    it('reports a relationship used as an image view scope as missing', async () => {
        const doc = await buildDocument(`workspace {
    model {
        a = softwareSystem "A"
        b = softwareSystem "B"
        r = a -> b "calls"
    }
    views {
        image r {
            plantuml "x"
        }
    }
}
`);

        expect(diagnostics(doc)).toEqual(['The element "r" does not exist']);
    });

    it('reports an unknown element in an include expression', async () => {
        const doc = await buildDocument(`workspace {
    model {
        a = softwareSystem "A"
    }
    views {
        systemContext a {
            include missing
        }
    }
}
`);

        expect(diagnostics(doc)).toEqual(['The element/relationship "missing" does not exist']);
    });

    it('reports an unknown element in an animation step', async () => {
        const doc = await buildDocument(`workspace {
    model {
        a = softwareSystem "A"
    }
    views {
        systemContext a {
            include *
            animation {
                missing
            }
        }
    }
}
`);

        expect(diagnostics(doc)).toEqual(['The element/relationship "missing" does not exist']);
    });

    it('reports a filtered view based on a key that no view declares', async () => {
        const doc = await buildDocument(`workspace {
    model {
        a = softwareSystem "A"
    }
    views {
        filtered missing include "x" {
        }
    }
}
`);

        expect(diagnostics(doc)).toEqual(['The view "missing" does not exist']);
    });

    it('accepts a filtered view based on a declared view key', async () => {
        const doc = await buildDocument(`workspace {
    model {
        a = softwareSystem "A"
    }
    views {
        systemContext a "base" {
            include *
        }
        filtered base include "x" {
        }
    }
}
`);

        expect(diagnostics(doc)).toEqual([]);
    });
});
