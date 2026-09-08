import { describe, expect, it } from 'vitest';
import type { C4ModelSource } from './model';
import { parseToolResult } from './tools';
import { listViewsHandler } from './tools-view';

const PROJECT_URI = 'file:///main.dsl';

function viewsWorkspaceJson() {
    return {
        name: 'Views',
        model: {
            softwareSystems: [
                {
                    id: 's1', name: 'System A',
                    containers: [
                        { id: 'c1', name: 'Web' },
                        { id: 'c2', name: 'API' },
                    ],
                },
            ],
        },
        views: {
            systemLandscapeViews: [
                {
                    key: 'Landscape-SystemLandscape-1', title: 'Landscape',
                    elements: [{ id: 's1' }], relationships: [{ id: 'r1' }],
                },
            ],
            containerViews: [
                {
                    key: 'Container-SystemA-2', title: 'Containers of System A', description: 'Main',
                    elements: [{ id: 'c1' }, { id: 'c2' }], relationships: [],
                },
                {
                    key: 'Container-SystemA-3',
                    elements: [], relationships: [],
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

const source = mockSource(viewsWorkspaceJson() as any);

describe('list-views', () => {
    it('returns a catalog of all views with counts and byType', async () => {
        const result = parseToolResult(await listViewsHandler(source, {}));

        expect(result.error).toBeUndefined();
        expect(result.project).toBe(PROJECT_URI);
        expect(result.count).toBe(3);
        expect(result.byType).toEqual({ systemLandscape: 1, container: 2 });

        expect(result.views).toHaveLength(3);
        const landscape = result.views.find((v: any) => v.key === 'Landscape-SystemLandscape-1');
        expect(landscape).toMatchObject({
            type: 'systemLandscape',
            title: 'Landscape',
            elementCount: 1,
            relationshipCount: 1,
        });
        const container = result.views.find((v: any) => v.key === 'Container-SystemA-2');
        expect(container).toMatchObject({
            type: 'container',
            title: 'Containers of System A',
            description: 'Main',
            elementCount: 2,
            relationshipCount: 0,
        });
    });

    it('filters views by type', async () => {
        const result = parseToolResult(await listViewsHandler(source, { type: 'container' }));
        expect(result.count).toBe(2);
        expect(result.byType).toEqual({ container: 2 });
        expect(result.views.every((v: any) => v.type === 'container')).toBe(true);
    });

    it('returns empty catalog for an unmatching type', async () => {
        const result = parseToolResult(await listViewsHandler(source, { type: 'dynamic' }));
        expect(result.count).toBe(0);
        expect(result.byType).toEqual({});
        expect(result.views).toEqual([]);
    });

    it('returns an error when the project has no model', async () => {
        const empty = mockSource(null);
        const result = parseToolResult(await listViewsHandler(empty, {}));
        expect(result.error).toBeTruthy();
    });
});
