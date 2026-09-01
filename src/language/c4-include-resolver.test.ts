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
import { URI, Utils } from 'vscode-uri';
import { createC4Services } from './c4-module';
import {
    stripPathQuotes,
    resolveTargetUri,
    resolveTargetUris,
    resolveIncludedDocument,
    getConstantsForDocument,
    substituteConstants,
    findParentDocument,
    getAncestorChain,
    getRootWorkspaceUri,
} from './c4-include-resolver';

const PROJECT = URI.parse('file:///project/');
/** Context URI inside the project, so dirname resolves to file:///project/. */
const CONTEXT = URI.parse('file:///project/main.dsl');

/** Builds a fresh service container with the given virtual .dsl files. */
async function createProject(files: Record<string, string>) {
    const services = createC4Services({ connection: undefined as any, ...EmptyFileSystem }).C4;
    const docs = Object.entries(files).map(([name, content]) => {
        const uri = Utils.resolvePath(PROJECT, name);
        const doc = services.shared.workspace.LangiumDocumentFactory.fromString(content, uri);
        services.shared.workspace.LangiumDocuments.addDocument(doc);
        return doc;
    });
    await services.shared.workspace.DocumentBuilder.build(docs);
    return { services, docs };
}

function rootOf(services: Awaited<ReturnType<typeof createProject>>['services'], name: string) {
    const uri = Utils.resolvePath(PROJECT, name);
    return services.shared.workspace.LangiumDocuments.getDocument(uri)?.parseResult.value;
}

describe('stripPathQuotes', () => {
    it('strips single and double quotes and handles undefined', () => {
        expect(stripPathQuotes('"foo.dsl"')).toBe('foo.dsl');
        expect(stripPathQuotes("'foo.dsl'")).toBe('foo.dsl');
        expect(stripPathQuotes('foo.dsl')).toBe('foo.dsl');
        expect(stripPathQuotes(undefined)).toBe('');
        expect(stripPathQuotes('')).toBe('');
    });
});

describe('resolveTargetUri', () => {
    it('resolves relative paths against the context document directory', () => {
        expect(resolveTargetUri('../model/base.dsl', CONTEXT)?.toString()).toBe('file:///model/base.dsl');
    });

    it('keeps http(s) URLs as-is', () => {
        expect(resolveTargetUri('https://example.com/model.dsl', CONTEXT)?.toString()).toBe('https://example.com/model.dsl');
        expect(resolveTargetUri('http://example.com/model.dsl', CONTEXT)?.toString()).toBe('http://example.com/model.dsl');
    });

    it('strips quotes before resolving', () => {
        expect(resolveTargetUri('"model/base.dsl"', CONTEXT)?.toString()).toBe('file:///project/model/base.dsl');
    });

    it('returns undefined for an empty path', () => {
        expect(resolveTargetUri('', CONTEXT)).toBeUndefined();
    });
});

describe('resolveTargetUris', () => {
    it('adds a .dsl candidate for extension-less local paths', () => {
        const uris = resolveTargetUris('model/views', CONTEXT, { withDslFallback: true });
        expect(uris.map((u) => u.toString())).toEqual([
            'file:///project/model/views',
            'file:///project/model/views.dsl',
        ]);
    });

    it('does not add a .dsl candidate when the path already ends with .dsl', () => {
        const uris = resolveTargetUris('model/views.dsl', CONTEXT, { withDslFallback: true });
        expect(uris).toHaveLength(1);
        expect(uris[0].toString()).toBe('file:///project/model/views.dsl');
    });

    it('does not add a .dsl candidate for http(s) URLs', () => {
        const uris = resolveTargetUris('https://example.com/model', CONTEXT, { withDslFallback: true });
        expect(uris).toHaveLength(1);
        expect(uris[0].toString()).toBe('https://example.com/model');
    });

    it('returns an empty array for unresolvable paths', () => {
        expect(resolveTargetUris('', CONTEXT)).toEqual([]);
    });
});

describe('constants', () => {
    it('collects !constant declarations and strips quotes', async () => {
        const { services } = await createProject({
            'constants.dsl': '!constant BASE "shared/model"\n!constant OTHER unquoted\n',
        });
        const constants = getConstantsForDocument(
            services.shared,
            Utils.resolvePath(PROJECT, 'constants.dsl').toString(),
        );
        expect(constants.get('BASE')).toBe('shared/model');
        expect(constants.get('OTHER')).toBe('unquoted');
    });

    it('substitutes local constants first, then constants visible from the workspace graph', async () => {
        // other.dsl is a fragment of main.dsl's workspace (included by it), so its
        // constants are visible from main.dsl. A constant from an unrelated document
        // is intentionally NOT visible (see the constant-scoping tests below).
        const { services } = await createProject({
            'main.dsl': '!constant MODE "local"\n!include "other.dsl"\nworkspace {\n}\n',
            'other.dsl': '!constant MODE "remote"\n!constant GLOBAL "42"\n',
        });
        const mainRoot = rootOf(services, 'main.dsl');
        expect(mainRoot).toBeDefined();
        expect(substituteConstants(services.shared, '${MODE}/views', mainRoot!)).toBe('local/views');
        expect(substituteConstants(services.shared, '${GLOBAL}/views', mainRoot!)).toBe('42/views');
    });

    it('leaves unknown placeholders as-is', async () => {
        const { services } = await createProject({
            'main.dsl': 'workspace {\n}\n',
        });
        const mainRoot = rootOf(services, 'main.dsl');
        expect(mainRoot).toBeDefined();
        expect(substituteConstants(services.shared, '${UNKNOWN}/x.dsl', mainRoot!)).toBe('${UNKNOWN}/x.dsl');
    });
});

describe('resolveIncludedDocument', () => {
    it('finds a loaded document and falls back to the .dsl extension', async () => {
        const { services } = await createProject({
            'main.dsl': 'workspace {\n}\n',
            'shared/model.dsl': 'person "User"\n',
        });
        const mainRoot = rootOf(services, 'main.dsl');
        expect(mainRoot).toBeDefined();
        const doc = resolveIncludedDocument(services.shared, 'shared/model', mainRoot!, { withDslFallback: true });
        expect(doc?.uri.toString()).toBe('file:///project/shared/model.dsl');
    });

    it('returns undefined for missing documents', async () => {
        const { services } = await createProject({
            'main.dsl': 'workspace {\n}\n',
        });
        const mainRoot = rootOf(services, 'main.dsl');
        expect(mainRoot).toBeDefined();
        expect(resolveIncludedDocument(services.shared, 'missing/file', mainRoot!)).toBeUndefined();
    });
});

describe('workspace graph & constant scoping', () => {
    it('walks the !include ancestor chain (closest parent first, root last)', async () => {
        const { services } = await createProject({
            'main.dsl': '!include "mid.dsl"\nworkspace {\n}\n',
            'mid.dsl': '!include "frag.dsl"\nperson "MidUser"\n',
            'frag.dsl': 'person "FragUser"\n',
        });
        const shared = services.shared;
        const fragUri = Utils.resolvePath(PROJECT, 'frag.dsl').toString();
        const midUri = Utils.resolvePath(PROJECT, 'mid.dsl').toString();
        const mainUri = Utils.resolvePath(PROJECT, 'main.dsl').toString();

        expect(findParentDocument(shared, fragUri)?.uri.toString()).toBe(midUri);
        expect(getAncestorChain(shared, fragUri)).toEqual([midUri, mainUri]);
        expect(getRootWorkspaceUri(shared, fragUri)).toBe(mainUri);
        expect(getRootWorkspaceUri(shared, mainUri)).toBe(mainUri);
    });

    it('resolves a constant declared in the parent file (reported instability scenario)', async () => {
        const { services } = await createProject({
            'main.dsl': '!constant PEOPLE_INCLUDE "people.dsl"\n!include "${PEOPLE_INCLUDE}"\nworkspace {\n}\n',
            'people.dsl': 'person "User"\n',
        });
        const peopleRoot = rootOf(services, 'people.dsl');
        expect(peopleRoot).toBeDefined();
        // The constant is only declared in main.dsl (the ancestor) - the lookup must find it
        // through the !include graph instead of scanning all open documents.
        expect(substituteConstants(services.shared, '${PEOPLE_INCLUDE}', peopleRoot!)).toBe('people.dsl');
    });

    it('does not leak constants from unrelated workspaces', async () => {
        const { services } = await createProject({
            'main.dsl': '!constant MAIN_ONLY "m"\n!include "frag.dsl"\nworkspace {\n}\n',
            'frag.dsl': 'person "User"\n',
            'other.dsl': '!constant SECRET "x"\nworkspace {\n}\n',
        });
        const fragRoot = rootOf(services, 'frag.dsl');
        const otherRoot = rootOf(services, 'other.dsl');
        expect(fragRoot).toBeDefined();
        expect(otherRoot).toBeDefined();
        // SECRET is only declared in the unrelated other.dsl - invisible from frag.dsl.
        expect(substituteConstants(services.shared, '${SECRET}/path', fragRoot!)).toBe('${SECRET}/path');
        // MAIN_ONLY is only declared in the owning workspace - invisible from other.dsl.
        expect(substituteConstants(services.shared, '${MAIN_ONLY}', otherRoot!)).toBe('${MAIN_ONLY}');
    });

    it('resolves duplicate constants deterministically to the owning workspace, not a random sibling', async () => {
        const { services } = await createProject({
            'main.dsl': '!constant MODE "local"\n!include "frag.dsl"\nworkspace {\n}\n',
            'frag.dsl': 'person "User"\n',
            'other.dsl': '!constant MODE "remote"\nworkspace {\n}\n',
        });
        const fragRoot = rootOf(services, 'frag.dsl');
        const otherRoot = rootOf(services, 'other.dsl');
        expect(fragRoot).toBeDefined();
        expect(otherRoot).toBeDefined();
        // MODE is declared in both workspaces. From frag.dsl it must come from its ancestor
        // main.dsl (local/views), regardless of document insertion order.
        expect(substituteConstants(services.shared, '${MODE}/views', fragRoot!)).toBe('local/views');
        // From other.dsl the local declaration wins.
        expect(substituteConstants(services.shared, '${MODE}/views', otherRoot!)).toBe('remote/views');
    });
});
