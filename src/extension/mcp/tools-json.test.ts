import { describe, expect, it } from 'vitest';
import type { C4ModelSource } from './model';
import { parseToolResult } from './tools';
import { readModelJsonHandler, readViewJsonHandler } from './tools-json';

const PROJECT_URI = 'file:///main.dsl';

function workspaceJson() {
    return {
        name: 'Json',
        model: {
            people: [{ id: 'p1', name: 'User', tags: 'Element,Person' }],
            softwareSystems: [
                { id: 's1', name: 'System A', tags: 'Element,Software System' },
            ],
        },
        views: {
            systemLandscapeViews: [
                {
                    key: 'Landscape-SystemLandscape-abc',
                    elements: [{ id: 's1', x: 0, y: 0, width: 100, height: 50 }],
                    relationships: [],
                    dimensions: { width: 1200, height: 900 },
                },
            ],
        },
    };
}

function mockSource(model: any, projects: string[] = [PROJECT_URI]): C4ModelSource {
    return {
        listProjects: async () => projects,
        getContent: async (uri: string) => (uri === PROJECT_URI ? model : null),
    };
}

const source = mockSource(workspaceJson() as any);

describe('read-model-json', () => {
    it('returns the raw model with people and software systems', async () => {
        const result = parseToolResult(await readModelJsonHandler(source, {}));
        expect(result.model.people).toHaveLength(1);
        expect(result.model.people[0].id).toBe('p1');
        expect(result.model.softwareSystems).toHaveLength(1);
        expect(result.model.softwareSystems[0].name).toBe('System A');
    });

    it('returns an error when no model is available', async () => {
        const empty = mockSource(null);
        const result = parseToolResult(await readModelJsonHandler(empty, {}));
        expect(result.error).toBeTruthy();
    });
});

describe('read-view-json', () => {
    it('returns the raw view object with elements and dimensions', async () => {
        const result = parseToolResult(await readViewJsonHandler(source, { key: 'Landscape-SystemLandscape-abc' }));
        expect(result.view.key).toBe('Landscape-SystemLandscape-abc');
        expect(result.view.elements).toEqual([
            { id: 's1', x: 0, y: 0, width: 100, height: 50 },
        ]);
        expect(result.view.dimensions).toEqual({ width: 1200, height: 900 });
    });

    it('returns an error for an unknown view key', async () => {
        const result = parseToolResult(await readViewJsonHandler(source, { key: 'no-such-view' }));
        expect(result.error).toBeTruthy();
    });
});
