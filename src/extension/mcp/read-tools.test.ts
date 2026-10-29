import { beforeAll, describe, expect, it } from 'vitest';
import type { C4ModelSource } from './model';
import { flattenModel } from './model';
import { loadWorkspaceJson } from './test-fixtures';
import { parseToolResult } from './tools';
import { readDeploymentHandler, readViewHandler } from './tools-read';

const FIXTURE = 'simple-workspace';
const PROJECT_URI = 'file:///main.dsl';

function mockSource(model: any, projects: string[] = [PROJECT_URI]): C4ModelSource {
    return {
        listProjects: async () => projects,
        getContent: async (uri: string) => (uri === PROJECT_URI ? model : null),
    };
}

/** Minimal Structurizr JSON with a deployment tree. */
function deploymentWorkspaceJson() {
    return {
        name: 'Deployment',
        model: {
            deploymentNodes: [
                {
                    id: '1',
                    name: 'Production',
                    technology: 'AWS',
                    instanceCount: 1,
                    tags: 'Deployment Node,Production',
                    children: [
                        {
                            id: '2',
                            name: 'Server',
                            instanceCount: 2,
                            tags: 'Deployment Node',
                            infrastructureNodes: [
                                { id: '3', name: 'Load Balancer', tags: 'Infrastructure Node' },
                            ],
                            softwareSystemInstances: [
                                { id: '4', name: 'Web App Instance', tags: 'Software System Instance' },
                            ],
                            containerInstances: [
                                { id: '5', name: 'Database Instance', tags: 'Container Instance' },
                            ],
                        },
                    ],
                },
            ],
        },
        views: {},
    };
}

describe('read-view (from simple-workspace DSL fixture)', () => {
    let workspaceJson: any;
    let source: C4ModelSource;

    beforeAll(async () => {
        workspaceJson = await loadWorkspaceJson(FIXTURE);
        source = mockSource(workspaceJson);
    });

    it('returns the view metadata, elements and relationships', async () => {
        const model = flattenModel(PROJECT_URI, workspaceJson);
        const containerView = model.views.find(v => v.type === 'container')!;
        const result = parseToolResult(await readViewHandler(source, { key: containerView.key }));

        expect(result.view.key).toBe(containerView.key);
        expect(result.view.type).toBe('container');
        expect(result.elements.length).toBeGreaterThan(0);

        const webApp = model.elements.find(e => e.name === 'Web Application')!;
        expect(result.elements).toEqual(
            expect.arrayContaining([expect.objectContaining({ id: webApp.id, name: 'Web Application' })]),
        );
    });

    it('returns an error for an unknown view key', async () => {
        const result = parseToolResult(await readViewHandler(source, { key: 'no-such-view' }));
        expect(result.error).toBeTruthy();
    });
});

describe('read-deployment (crafted workspace JSON)', () => {
    const source = mockSource(deploymentWorkspaceJson() as any);

    it('returns the full deployment tree without an id', async () => {
        const result = parseToolResult(await readDeploymentHandler(source, {}));
        expect(result.deployment).toHaveLength(1);
        const production = result.deployment[0];
        expect(production.name).toBe('Production');
        expect(production.technology).toBe('AWS');
        expect(production.instanceCount).toBe(1);
        expect(production.tags).toEqual(['Deployment Node', 'Production']);
        expect(production.children).toHaveLength(1);

        const server = production.children[0];
        expect(server.name).toBe('Server');
        expect(server.instanceCount).toBe(2);
        expect(server.children).toHaveLength(3);
        const types = server.children.map((c: any) => c.type);
        expect(types).toEqual([
            'infrastructureNode', 'softwareSystemInstance', 'containerInstance',
        ]);
        expect(server.children[0].name).toBe('Load Balancer');
        expect(server.children[2].name).toBe('Database Instance');
    });

    it('returns the subtree for a given deployment node id', async () => {
        const result = parseToolResult(await readDeploymentHandler(source, { id: '2' }));
        expect(result.deployment.name).toBe('Server');
        expect(result.deployment.instanceCount).toBe(2);
        expect(result.path).toEqual(['Production', 'Server']);
    });

    it('returns an error for an unknown deployment node id', async () => {
        const result = parseToolResult(await readDeploymentHandler(source, { id: '999' }));
        expect(result.error).toBeTruthy();
    });
});
