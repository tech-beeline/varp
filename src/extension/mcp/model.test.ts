import { beforeAll, describe, expect, it } from 'vitest';
import { flattenModel } from './model';
import { loadWorkspaceJson } from './test-fixtures';

const FIXTURE = 'simple-workspace';
const PROJECT_URI = 'file:///main.dsl';

let workspaceJson: any;

beforeAll(async () => {
    workspaceJson = await loadWorkspaceJson(FIXTURE);
});

describe('flattenModel (from simple-workspace DSL fixture)', () => {
    it('flattens all elements with types, tags and hierarchy paths', () => {
        const model = flattenModel(PROJECT_URI, workspaceJson);
        expect(model.elements).toHaveLength(4);

        const user = model.elements.find(e => e.name === 'User')!;
        expect(user.type).toBe('Person');
        expect(user.path).toEqual([]);

        const webApp = model.elements.find(e => e.name === 'Web Application')!;
        expect(webApp.type).toBe('Container');
        expect(webApp.path).toEqual(['Software System', 'Web Application']);
        expect(webApp.tags).toEqual(expect.arrayContaining(['Tag1', 'Tag2']));
    });

    it('keeps outgoing relationships with destination ids', () => {
        const model = flattenModel(PROJECT_URI, workspaceJson);
        const user = model.elements.find(e => e.name === 'User')!;
        expect(user.relationships.length).toBeGreaterThan(0);
        const uses = user.relationships.find(r => r.description === 'Uses')!;
        const softwareSystem = model.elements.find(e => e.name === 'Software System')!;
        expect(uses.destinationId).toBe(softwareSystem.id);
    });

    it('collects systemContext and container views', () => {
        const model = flattenModel(PROJECT_URI, workspaceJson);
        expect(model.views).toHaveLength(2);

        const systemContext = model.views.find(v => v.type === 'systemContext');
        expect(systemContext).toBeDefined();
        const user = model.elements.find(e => e.name === 'User')!;
        const softwareSystem = model.elements.find(e => e.name === 'Software System')!;
        expect(systemContext!.elementIds).toHaveLength(2);
        expect(systemContext!.elementIds).toEqual(expect.arrayContaining([user.id, softwareSystem.id]));

        const containerView = model.views.find(v => v.type === 'container');
        expect(containerView).toBeDefined();
        const webApp = model.elements.find(e => e.name === 'Web Application')!;
        const db = model.elements.find(e => e.name === 'Database')!;
        expect(containerView!.elementIds).toEqual(expect.arrayContaining([webApp.id, db.id]));
    });

    it('resolves view relationship endpoints from model relationships by id', () => {
        const model = flattenModel(PROJECT_URI, workspaceJson);
        const withRelationships = model.views.filter(v => v.relationships.length > 0);
        expect(withRelationships.length).toBeGreaterThan(0);
        for (const view of withRelationships) {
            for (const rel of view.relationships) {
                expect(rel.sourceId).not.toBe('');
                expect(rel.destinationId).not.toBe('');
            }
        }
    });
});

describe('flattenModel deployment instances', () => {
    it('names a ContainerInstance after the container it instantiates', async () => {
        const json = await loadWorkspaceJson('element-own-properties');
        const model = flattenModel(PROJECT_URI, json);
        const node = model.elements.find(e => e.name === 'Prod' && e.type === 'DeploymentNode')!;
        const instance = model.elements.find(e => e.type === 'ContainerInstance')!;
        expect(instance.name).toBe('Web Application');
        expect(instance.path).toEqual(['Prod', 'Web Application']);
        expect(instance.parentId).toBe(node.id);
    });
});
