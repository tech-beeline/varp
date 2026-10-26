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

const MODEL = `        platform = group "Platform" {
            integration = group "Integration" {
                s = softwareSystem "S" {
                    tags "critical"
                    properties {
                        owner "team-a"
                    }
                    c = container "C" "cache" "Java" {
                        technology "PostgreSQL"
                        tags "db"
                    }
                }
            }
        }
        a = softwareSystem "A"
        a -> s "calls" {
            tags "sync"
            properties {
                protocol "https"
            }
        }`;

const VIEW = (expression: string) => `workspace {
    model {
${MODEL}
    }
    views {
        systemLandscape "L" {
            include ${expression}
        }
    }
}`;

async function completeAt(text: string, offset: number) {
    const services = createC4Services({ connection: undefined as any, ...EmptyFileSystem }).C4;
    const uri = URI.parse('file:///completion-values.dsl');
    const document = services.shared.workspace.LangiumDocumentFactory.fromString(text, uri);
    services.shared.workspace.LangiumDocuments.addDocument(document);
    await services.shared.workspace.DocumentBuilder.build([document]);

    const result: any = await services.lsp.CompletionProvider!.getCompletion(document, {
        textDocument: { uri: uri.toString() },
        position: document.textDocument.positionAt(offset),
    } as any);
    return (result?.items ?? []) as any[];
}

function at(text: string, expression: string) {
    return text.indexOf(expression) + expression.length;
}

/** Completes inside a file that is included into a view body of another file. */
async function completeInFragment(root: string, fragment: string) {
    const services = createC4Services({ connection: undefined as any, ...EmptyFileSystem }).C4;
    const docs = [root, fragment].map((text, index) => {
        const uri = URI.parse(`file:///completion-fragment-${index}.dsl`);
        return services.shared.workspace.LangiumDocumentFactory.fromString(text, uri);
    });
    for (const doc of docs) services.shared.workspace.LangiumDocuments.addDocument(doc);
    await services.shared.workspace.DocumentBuilder.build(docs);

    const doc = docs[1];
    const text = doc.textDocument.getText();
    const result: any = await services.lsp.CompletionProvider!.getCompletion(doc, {
        textDocument: { uri: doc.uri.toString() },
        position: doc.textDocument.positionAt(text.length),
    } as any);
    return (result?.items ?? []) as any[];
}

describe('expression value completion', () => {
    it('offers the technologies declared in the workspace', async () => {
        const text = VIEW('element.technology==');
        const items = await completeAt(text, at(text, 'element.technology=='));

        expect(items.map(item => item.label)).toEqual(['Java', 'PostgreSQL']);
    });

    it('offers the declared element tags', async () => {
        const text = VIEW('element.tag==');
        const labels = (await completeAt(text, at(text, 'element.tag=='))).map(item => item.label);

        expect(labels).toEqual(['critical', 'db']);
        expect(labels).not.toContain('sync');
    });

    it('offers relationship tags in a relationship expression', async () => {
        const text = VIEW('relationship.tag==');
        const labels = (await completeAt(text, at(text, 'relationship.tag=='))).map(item => item.label);

        expect(labels).toEqual(['sync']);
    });

    it('offers the element type keywords', async () => {
        const text = VIEW('element.type==');
        const labels = (await completeAt(text, at(text, 'element.type=='))).map(item => item.label);

        expect(labels).toEqual([
            'person', 'softwareSystem', 'container', 'component', 'deploymentNode',
            'infrastructureNode', 'softwareSystemInstance', 'containerInstance', 'custom',
        ]);
    });

    it('offers group paths', async () => {
        const text = VIEW('element.group==');
        const labels = (await completeAt(text, at(text, 'element.group=='))).map(item => item.label);

        expect(labels).toEqual(['Platform', 'Platform/Integration']);
    });

    it('offers property keys inside the brackets', async () => {
        const text = VIEW('element.properties["');
        const labels = (await completeAt(text, at(text, 'element.properties["'))).map(item => item.label);

        expect(labels).toEqual(['owner']);
    });

    it('offers property values for the typed key', async () => {
        const text = VIEW('element.properties["owner"]==');
        const labels = (await completeAt(text, at(text, 'element.properties["owner"]=='))).map(item => item.label);

        expect(labels).toEqual(['team-a']);
    });

    it('offers relationship property values', async () => {
        const text = VIEW('relationship.properties["protocol"]==');
        const labels = (await completeAt(text, at(text, 'relationship.properties["protocol"]=='))).map(item => item.label);

        expect(labels).toEqual(['https']);
    });

    it('labels each value with its kind', async () => {
        const cases: [string, string][] = [
            ['element.technology==', 'technology'],
            ['element.tag==', 'tag'],
            ['element.type==', 'element type'],
            ['element.group==', 'group'],
            ['element.properties["', 'property'],
            ['element.properties["owner"]==', 'property value'],
        ];
        for (const [expression, detail] of cases) {
            const text = VIEW(expression);
            const items = await completeAt(text, at(text, expression));
            expect(items.length, expression).toBeGreaterThan(0);
            expect(items.map(item => item.labelDetails?.description), expression).toEqual(items.map(() => detail));
        }
    });

    it('filters by the typed prefix and replaces it', async () => {
        const text = VIEW('element.technology==Ja');
        const offset = at(text, 'element.technology==Ja');
        const items = await completeAt(text, offset);

        expect(items.map(item => item.label)).toEqual(['Java']);
        expect(items[0].textEdit).toMatchObject({
            range: {
                start: { line: 26, character: 40 },
                end: { line: 26, character: 42 },
            },
            newText: 'Java',
        });
    });

    it('completes the last segment of a tag list', async () => {
        const text = VIEW('element.tag==critical, d');
        const offset = at(text, 'element.tag==critical, d');
        const items = await completeAt(text, offset);

        expect(items.map(item => item.label)).toEqual(['db']);
        expect(items[0].textEdit).toMatchObject({ newText: 'db' });
    });

    it('offers values in a view body included from another file', async () => {
        const root = `workspace {
    model {
${MODEL}
    }
    views {
        container s "c" {
            !include 'fragment.dsl'
        }
    }
}`;
        const cases: [string, string[]][] = [
            ['element.technology==', ['Java', 'PostgreSQL']],
            ['element.tag==', ['critical', 'db']],
            ['element.type==', ['softwareSystem', 'container']],
            ['element.group==', ['Platform']],
            ['relationship.tag==', ['sync']],
            ['element.properties["', ['owner']],
            ['element.properties["owner"]==', ['team-a']],
            ['relationship.properties["protocol"]==', ['https']],
        ];
        for (const [expression, expected] of cases) {
            const items = await completeInFragment(root, `include *\nexclude ${expression}`);
            const labels = items.map(item => item.label);
            for (const label of expected) {
                expect(labels, expression).toContain(label);
            }
        }
    });

    it('does not offer values inside prose', async () => {
        const text = `workspace {
    model {
        s = softwareSystem "S" {
            tags "critical"
            description "about element.tag=="
        }
    }
}`;
        const items = await completeAt(text, at(text, 'about element.tag=='));

        expect(items.map(item => item.label)).not.toContain('critical');
    });

    it('rescans a document after it changes', async () => {
        const services = createC4Services({ connection: undefined as any, ...EmptyFileSystem }).C4;
        const uri = URI.parse('file:///completion-values-edit.dsl');
        const open = async (text: string) => {
            const documents = services.shared.workspace.LangiumDocuments;
            if (documents.getDocument(uri)) documents.deleteDocument(uri);
            const document = services.shared.workspace.LangiumDocumentFactory.fromString(text, uri);
            documents.addDocument(document);
            await services.shared.workspace.DocumentBuilder.build([document]);
            return document;
        };
        const complete = async (document: any, text: string) => {
            const result: any = await services.lsp.CompletionProvider!.getCompletion(document, {
                textDocument: { uri: uri.toString() },
                position: document.textDocument.positionAt(at(text, 'element.technology==')),
            } as any);
            return (result?.items ?? []).map((item: any) => item.label);
        };

        const original = VIEW('element.technology==');
        expect(await complete(await open(original), original)).toEqual(['Java', 'PostgreSQL']);

        const updated = original.replace('"Java"', '"Kotlin"');
        const second = await open(updated);
        expect(await complete(second, updated)).toEqual(['Kotlin', 'PostgreSQL']);
    });
});
