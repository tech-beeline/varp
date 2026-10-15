/**
 * Model serialization for MCP tools.
 *
 * Works over the resolved Structurizr JSON produced by the language server
 * (C4GeneratorHandler) and fetched through the custom LSP requests:
 *   - c4/listProjects   -> root workspace document URIs that can be served
 *   - c4/getContentForUri -> the Structurizr JSON for a given URI
 */

export interface McpRelationship {
    id?: string;
    sourceId: string;
    destinationId: string;
    description?: string;
    tags: string[];
}

export interface McpElement {
    id: string;
    name: string;
    type: string;
    description?: string;
    technology?: string;
    tags: string[];
    /** Hierarchical path, e.g. ['Software System', 'Container']. */
    path: string[];
    /**
     * Id of the containing element, when there is one. Taken from the tree while
     * flattening instead of being inferred from `path`: the name-based paths of the
     * model tree and the deployment tree can coincide (both have a one-segment
     * root), so a path lookup can return an element of the other tree.
     */
    parentId?: string;
    properties?: Record<string, string>;
    /** Outgoing relationships (this element as the source). */
    relationships: McpRelationship[];
    /** Incoming relationships (this element as the destination), computed from the model. */
    incomingRelationships: McpRelationship[];
}

export interface McpViewRelationship {
    id?: string;
    sourceId: string;
    destinationId: string;
    description?: string;
    order?: string;
}

export interface McpView {
    key: string;
    type: string;
    title?: string;
    description?: string;
    elementIds: string[];
    relationships: McpViewRelationship[];
}

export interface McpProject {
    uri: string;
    name?: string;
    description?: string;
}

export interface FlattenedModel {
    project: McpProject;
    elements: McpElement[];
    views: McpView[];
}

/** Minimal language-client surface used to fetch model data. */
export interface C4LanguageClientLike {
    sendRequest(method: string, params: any): Promise<any>;
}

/** Source of resolved C4 model data for MCP tools. */
export interface C4ModelSource {
    listProjects(): Promise<string[]>;
    getContent(uri: string): Promise<any>;
}

/** C4ModelSource backed by the VS Code language client over LSP custom requests. */
export class LanguageClientModelSource implements C4ModelSource {
    constructor(private readonly client: C4LanguageClientLike) { }

    async listProjects(): Promise<string[]> {
        const res = await this.client.sendRequest('c4/listProjects', {});
        return (res?.projects as string[]) ?? [];
    }

    async getContent(uri: string): Promise<any> {
        const res = await this.client.sendRequest('c4/getContentForUri', { uri });
        return res?.json ?? null;
    }
}

function splitTags(tags?: string): string[] {
    if (!tags) {
        return [];
    }
    return tags.split(',').map(t => t.trim()).filter(Boolean);
}

/** Flattens Structurizr workspace JSON into a tool-friendly model. */
export function flattenModel(uri: string, json: any): FlattenedModel {
    const elements: McpElement[] = [];
    const views: McpView[] = [];
    const model = json?.model ?? {};

    const addElement = (el: any, type: string, path: string[], parentId?: string): void => {
        elements.push({
            id: String(el?.id ?? ''),
            name: el?.name ?? '',
            type,
            description: el?.description,
            technology: el?.technology,
            tags: splitTags(el?.tags),
            path,
            parentId,
            properties: el?.properties,
            relationships: (el?.relationships ?? []).map((r: any) => ({
                id: r?.id,
                sourceId: String(r?.sourceId ?? ''),
                destinationId: String(r?.destinationId ?? ''),
                description: r?.description,
                tags: splitTags(r?.tags),
            })),
            incomingRelationships: [],
        });
    };

    (model.people ?? []).forEach((p: any) => addElement(p, 'Person', []));

    // Deployment instances carry no `name` of their own (neither here nor in the
    // reference JSON): they instantiate a container or software system, so their
    // label is resolved from the referenced element.
    const containerNames = new Map<string, string>();
    const systemNames = new Map<string, string>();
    const instanceName = (inst: any, names: Map<string, string>, refKey: string): string => {
        if (typeof inst?.name === 'string' && inst.name.length > 0) {
            return inst.name;
        }
        return names.get(String(inst?.[refKey] ?? '')) ?? '';
    };

    (model.softwareSystems ?? []).forEach((s: any) => {
        const systemId = String(s?.id ?? '');
        systemNames.set(systemId, s?.name ?? '');
        addElement(s, 'SoftwareSystem', [s?.name ?? '']);
        (s.containers ?? []).forEach((c: any) => {
            const containerId = String(c?.id ?? '');
            containerNames.set(containerId, c?.name ?? '');
            addElement(c, 'Container', [s?.name ?? '', c?.name ?? ''], systemId);
            (c.components ?? []).forEach((co: any) =>
                addElement(co, 'Component', [s?.name ?? '', c?.name ?? '', co?.name ?? ''], containerId));
        });
    });

    const walkDeployment = (nodes: any[], path: string[], parentId?: string): void => {
        (nodes ?? []).forEach((n: any) => {
            const nodePath = [...path, n?.name ?? ''];
            const nodeId = String(n?.id ?? '');
            addElement(n, 'DeploymentNode', nodePath, parentId);
            walkDeployment(n?.children ?? [], nodePath, nodeId);
            (n?.infrastructureNodes ?? []).forEach((inf: any) =>
                addElement(inf, 'InfrastructureNode', [...nodePath, inf?.name ?? ''], nodeId));
            (n?.softwareSystemInstances ?? []).forEach((inst: any) => {
                const name = instanceName(inst, systemNames, 'softwareSystemId');
                addElement({ ...inst, name }, 'SoftwareSystemInstance', [...nodePath, name], nodeId);
            });
            (n?.containerInstances ?? []).forEach((inst: any) => {
                const name = instanceName(inst, containerNames, 'containerId');
                addElement({ ...inst, name }, 'ContainerInstance', [...nodePath, name], nodeId);
            });
        });
    };
    walkDeployment(model.deploymentNodes ?? [], []);

    // Second pass: compute incoming relationships (by destination id).
    for (const e of elements) {
        for (const r of e.relationships) {
            const target = elements.find(t => t.id === r.destinationId);
            if (target) {
                target.incomingRelationships.push(r);
            }
        }
    }

    // Index model relationships by id. View relationships only carry the
    // relationship id (plus layout), so their endpoints are resolved here from
    // the model relationship with the same id.
    const relationshipsById = new Map<string, McpRelationship>();
    for (const e of elements) {
        for (const r of e.relationships) {
            if (r.id && !relationshipsById.has(r.id)) {
                relationshipsById.set(r.id, r);
            }
        }
    }

    const collectViews = (arr: any[], type: string): void => {
        (arr ?? []).forEach((v: any) => {
            views.push({
                key: String(v?.key ?? ''),
                type,
                title: v?.title,
                description: v?.description,
                elementIds: (v?.elements ?? []).map((e: any) => String(e?.id ?? '')),
                relationships: (v?.relationships ?? []).map((r: any) => {
                    const modelRel = r?.id ? relationshipsById.get(String(r.id)) : undefined;
                    return {
                        id: r?.id,
                        sourceId: String(r?.sourceId ?? modelRel?.sourceId ?? ''),
                        destinationId: String(r?.destinationId ?? modelRel?.destinationId ?? ''),
                        description: r?.description ?? modelRel?.description,
                        order: r?.order,
                    };
                }),
            });
        });
    };
    const viewsJson = json?.views ?? {};
    collectViews(viewsJson.systemLandscapeViews, 'systemLandscape');
    collectViews(viewsJson.systemContextViews, 'systemContext');
    collectViews(viewsJson.containerViews, 'container');
    collectViews(viewsJson.componentViews, 'component');
    collectViews(viewsJson.deploymentViews, 'deployment');
    collectViews(viewsJson.dynamicViews, 'dynamic');
    collectViews(viewsJson.filteredViews, 'filtered');
    collectViews(viewsJson.customViews, 'custom');

    return {
        project: { uri, name: json?.name, description: json?.description },
        elements,
        views,
    };
}

export interface ElementDetail {
    element: McpElement;
    /** Views that include the element (key + view type). */
    includedInViews: { key: string; type: string }[];
}

/**
 * Resolves a single element of a flattened model plus the views that include it.
 * Shared by the single-element and batch MCP tools.
 */
export function elementDetail(model: FlattenedModel, id: string): ElementDetail | undefined {
    const element = model.elements.find(e => e.id === id);
    if (!element) {
        return undefined;
    }
    const includedInViews = model.views
        .filter(v => v.elementIds.includes(id))
        .map(v => ({ key: v.key, type: v.type }));
    return { element, includedInViews };
}
