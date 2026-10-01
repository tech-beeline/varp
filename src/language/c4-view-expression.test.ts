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

const MODEL = `    model {
        a = softwareSystem "A"
        b = softwareSystem "B"
        a -> b "Uses"
    }`;

/** Parses a systemLandscape view whose include is the given expression. */
async function parseInclude(expression: string, index: number): Promise<{ type?: string; errors: string[] }> {
    const services = createC4Services({ connection: undefined as any, ...EmptyFileSystem }).C4;
    const dsl = `workspace {\n${MODEL}\n    views {\n        systemLandscape {\n            include ${expression}\n            exclude b\n        }\n    }\n}\n`;
    const doc = services.shared.workspace.LangiumDocumentFactory.fromString(dsl, URI.parse(`file:///view-expression-${index}.dsl`));
    services.shared.workspace.LangiumDocuments.addDocument(doc);
    await services.shared.workspace.DocumentBuilder.build([doc]);
    const errors = ((doc.parseResult as any).parserErrors ?? []).map((e: any) => e.message);
    const view = (doc.parseResult.value as any).workspaces?.[0]?.viewsBlocks?.[0]?.views?.[0];
    const expr = view?.includeProps?.[0]?.expressions?.[0]?.expression;
    return { type: expr?.$type, errors };
}

describe('view expression grammar', () => {
    const cases: Array<[string, string]> = [
        ['relationship==*->*', 'RelationshipEqExpression'],
        ['relationship==*', 'RelationshipEqExpression'],
        ['relationship==a->*', 'RelationshipEqExpression'],
        ['relationship==*->b', 'RelationshipEqExpression'],
        ['relationship==a->b', 'RelationshipEqExpression'],
        ['*->a', 'StarToElementExpression'],
        ['a->*', 'StarFromElementExpression'],
        ['a->b', 'DirectCouplingExpression'],
        ['a->', 'EfferentCouplingExpression'],
        ['->a', 'AfferentCouplingExpression'],
        ['->a->', 'AfferentEfferentExpression'],
        ['*->*', 'StarStarExpression'],
        ['element==->a', 'ElementEqAfferentExpression'],
        ['element==a->', 'ElementEqEfferentExpression'],
        ['element==->a->', 'ElementEqAfferentEfferentExpression'],
        ['element.tag==t', 'ElementTagExpression'],
        ['element.tag==t && a->b', 'BinaryExpression'],
        ['a', 'SingleElementExpression'],
        ['"element.tag==tag A"', 'StringLiteralExpression'],
    ];

    cases.forEach(([expression, expected], index) => {
        it(`parses ${expression} as ${expected}`, async () => {
            const result = await parseInclude(expression, index);
            expect(result.errors).toEqual([]);
            expect(result.type).toBe(expected);
        });
    });

    it('keeps a relationship== pattern bound instead of using it as an arrow operand', async () => {
        const result = await parseInclude('relationship==*->*', 100);
        expect(result.errors).toEqual([]);
        expect(result.type).toBe('RelationshipEqExpression');
    });

    it('still allows a parenthesised relationship== pattern as an arrow operand', async () => {
        const result = await parseInclude('(relationship==*)->*', 101);
        expect(result.errors).toEqual([]);
        expect(result.type).toBe('StarFromElementExpression');
    });
});
