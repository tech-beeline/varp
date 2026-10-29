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
import { AstUtils, EmptyFileSystem, type LangiumDocument } from 'langium';
import { URI } from 'vscode-uri';
import { createC4Services } from './c4-module';
import { isDynamicStep } from '../generated/ast';

const ERROR_SEVERITY = 1;

/** Parses a DSL string with validation enabled. */
async function build(content: string): Promise<LangiumDocument> {
    const services = createC4Services({ connection: undefined as any, ...EmptyFileSystem }).C4;
    const doc = services.shared.workspace.LangiumDocumentFactory.fromString(
        content,
        URI.parse('file:///numeric-validation.dsl')
    );
    services.shared.workspace.LangiumDocuments.addDocument(doc);
    await services.shared.workspace.DocumentBuilder.build([doc], { validation: true });
    return doc;
}

function errorMessages(doc: LangiumDocument): string[] {
    return (doc.diagnostics ?? [])
        .filter(d => d.severity === ERROR_SEVERITY)
        .map(d => typeof d.message === 'string' ? d.message : d.message.value);
}

function firstStepOrder(doc: LangiumDocument): string | undefined {
    const step = AstUtils.streamAllContents(doc.parseResult.value).filter(isDynamicStep).toArray()[0];
    return step?.order;
}

const dynamicView = (step: string): string => `
workspace {
    model {
        a = softwareSystem "A"
        b = softwareSystem "B"
        a -> b "uses"
    }
    views {
        dynamic * "seq" {
            ${step}
        }
    }
}
`;

describe('ordered dynamic steps', () => {
    it('parses the glued order form and strips the delimiter', async () => {
        const doc = await build(dynamicView('1: a -> b "first"'));

        expect(doc.parseResult.parserErrors).toHaveLength(0);
        expect(firstStepOrder(doc)).toBe('1');
    });

    it('parses the spaced order form', async () => {
        const doc = await build(dynamicView('2 : a -> b "second"'));

        expect(doc.parseResult.parserErrors).toHaveLength(0);
        expect(firstStepOrder(doc)).toBe('2');
    });

    it('keeps a decimal order', async () => {
        const doc = await build(dynamicView('1.0: a -> b "first"'));

        expect(doc.parseResult.parserErrors).toHaveLength(0);
        expect(firstStepOrder(doc)).toBe('1.0');
    });

    it('parses a step without an order', async () => {
        const doc = await build(dynamicView('a -> b "first"'));

        expect(doc.parseResult.parserErrors).toHaveLength(0);
        expect(firstStepOrder(doc)).toBeUndefined();
    });
});

describe('numeric property validation', () => {
    const styles = (body: string): string => `
workspace {
    views {
        styles {
${body}
        }
    }
}
`;

    const cases: Array<{ name: string; body: string; message: string }> = [
        {
            name: 'position',
            body: '            relationship "R" {\n                position abc\n            }',
            message: 'Position must be an integer between 0 and 100.'
        },
        {
            name: 'opacity',
            body: '            element "E" {\n                opacity abc\n            }',
            message: 'Opacity must be an integer between 0 and 100.'
        },
        {
            name: 'thickness',
            body: '            relationship "R" {\n                thickness abc\n            }',
            message: 'Thickness must be a positive integer.'
        },
        {
            name: 'fontSize',
            body: '            element "E" {\n                fontSize abc\n            }',
            message: 'Font size must be a positive integer.'
        },
        {
            name: 'width',
            body: '            element "E" {\n                width abc\n            }',
            message: 'Width must be a positive integer.'
        },
        {
            name: 'height',
            body: '            element "E" {\n                height abc\n            }',
            message: 'Height must be a positive integer.'
        },
        {
            name: 'strokeWidth',
            body: '            element "E" {\n                strokeWidth abc\n            }',
            message: 'Stroke width must be an integer between 1 and 10.'
        }
    ];

    for (const testCase of cases) {
        it(`rejects a non-integer ${testCase.name}`, async () => {
            const doc = await build(styles(testCase.body));

            expect(doc.parseResult.parserErrors).toHaveLength(0);
            expect(errorMessages(doc)).toContain(testCase.message);
        });
    }

    it('accepts integer style values', async () => {
        const doc = await build(styles(`            relationship "R" {
                position 50
                thickness 2
            }
            element "E" {
                opacity 75
                fontSize 24
                width 450
                height 300
                strokeWidth 4
            }`));

        expect(doc.parseResult.parserErrors).toHaveLength(0);
        expect(errorMessages(doc)).toHaveLength(0);
    });

    it('rejects non-integer autolayout separations', async () => {
        const doc = await build(`
workspace {
    views {
        systemLandscape "land" {
            autoLayout lr abc def
        }
    }
}
`);

        expect(doc.parseResult.parserErrors).toHaveLength(0);
        const messages = errorMessages(doc);
        expect(messages).toContain('Rank separation must be a positive integer in pixels.');
        expect(messages).toContain('Node separation must be a positive integer in pixels.');
    });

    it('rejects a non-integer health check interval', async () => {
        const doc = await build(`
workspace {
    model {
        sys = softwareSystem "Sys"
        deploymentEnvironment "Prod" {
            deploymentNode "Node" {
                softwareSystemInstance sys {
                    healthCheck "h" "http://localhost" abc
                }
            }
        }
    }
}
`);

        expect(doc.parseResult.parserErrors).toHaveLength(0);
        expect(errorMessages(doc)).toContain('The interval must be a positive integer (number of seconds).');
    });

    it('rejects a non-integer health check timeout', async () => {
        const doc = await build(`
workspace {
    model {
        sys = softwareSystem "Sys"
        deploymentEnvironment "Prod" {
            deploymentNode "Node" {
                softwareSystemInstance sys {
                    healthCheck "h" "http://localhost" 60 abc
                }
            }
        }
    }
}
`);

        expect(doc.parseResult.parserErrors).toHaveLength(0);
        expect(errorMessages(doc)).toContain('The timeout must be zero or a positive integer (number of milliseconds).');
    });

    it('rejects a health check interval below one', async () => {
        const doc = await build(`
workspace {
    model {
        sys = softwareSystem "Sys"
        deploymentEnvironment "Prod" {
            deploymentNode "Node" {
                softwareSystemInstance sys {
                    healthCheck "h" "http://localhost" 0
                }
            }
        }
    }
}
`);

        expect(doc.parseResult.parserErrors).toHaveLength(0);
        expect(errorMessages(doc)).toContain('The interval must be a positive integer (number of seconds).');
    });
});

describe('instances validation', () => {
    const deploymentNode = (instances: string): string => `
workspace {
    model {
        deploymentEnvironment "Prod" {
            deploymentNode "Node" {
                instances ${instances}
            }
        }
    }
}
`;

    it('accepts a positive integer', async () => {
        const doc = await build(deploymentNode('3'));

        expect(doc.parseResult.parserErrors).toHaveLength(0);
        expect(errorMessages(doc)).toHaveLength(0);
    });

    it('accepts a numeric range', async () => {
        const doc = await build(deploymentNode('1..5'));

        expect(doc.parseResult.parserErrors).toHaveLength(0);
        expect(errorMessages(doc)).toHaveLength(0);
    });

    it('accepts ranges ending in N and *', async () => {
        for (const value of ['1..N', '1..*']) {
            const doc = await build(deploymentNode(value));
            expect(doc.parseResult.parserErrors).toHaveLength(0);
            expect(errorMessages(doc)).toHaveLength(0);
        }
    });

    it('rejects zero', async () => {
        const doc = await build(deploymentNode('0'));

        expect(doc.parseResult.parserErrors).toHaveLength(0);
        expect(errorMessages(doc)).toContain('Number of instances must be a positive integer or a range.');
    });

    it('rejects a non-numeric value', async () => {
        const doc = await build(deploymentNode('abc'));

        expect(doc.parseResult.parserErrors).toHaveLength(0);
        expect(errorMessages(doc)).toContain('Number of instances must be a positive integer or a range.');
    });

    it('rejects a reversed range', async () => {
        const doc = await build(deploymentNode('5..1'));

        expect(doc.parseResult.parserErrors).toHaveLength(0);
        expect(errorMessages(doc)).toContain('Range upper bound must be greater than the lower bound.');
    });
});
