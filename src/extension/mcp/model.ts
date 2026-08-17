/**
 * Model serialization for MCP tools.
 *
 * Works over the resolved Structurizr JSON produced by the language server
 * (C4GeneratorHandler) and fetched through the custom LSP requests:
 *   - custom/listProjects   -> root workspace document URIs with cached JSON
 *   - custom/getContentForUri -> the Structurizr JSON for a given URI
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
        const res = await this.client.sendRequest('custom/listProjects', {});
        return (res?.projects as string[]) ?? [];
    }

    async getContent(uri: string): Promise<any> {
        const res = await this.client.sendRequest('custom/getContentForUri', { uri });
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

    const addElement = (el: any, type: string, path: string[]): void => {
        elements.push({
            id: String(el?.id ?? ''),
            name: el?.name ?? '',
            type,
            description: el?.description,
            technology: el?.technology,
            tags: splitTags(el?.tags),
            path,
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

    (model.softwareSystems ?? []).forEach((s: any) => {
        addElement(s, 'SoftwareSystem', [s?.name ?? '']);
        (s.containers ?? []).forEach((c: any) => {
            addElement(c, 'Container', [s?.name ?? '', c?.name ?? '']);
            (c.components ?? []).forEach((co: any) =>
                addElement(co, 'Component', [s?.name ?? '', c?.name ?? '', co?.name ?? '']));
        });
    });

    const walkDeployment = (nodes: any[], path: string[]): void => {
        (nodes ?? []).forEach((n: any) => {
            const nodePath = [...path, n?.name ?? ''];
            addElement(n, 'DeploymentNode', nodePath);
            walkDeployment(n?.children ?? [], nodePath);
            (n?.infrastructureNodes ?? []).forEach((inf: any) =>
                addElement(inf, 'InfrastructureNode', [...nodePath, inf?.name ?? '']));
            (n?.softwareSystemInstances ?? []).forEach((inst: any) =>
                addElement(inst, 'SoftwareSystemInstance', [...nodePath, inst?.name ?? '']));
            (n?.containerInstances ?? []).forEach((inst: any) =>
                addElement(inst, 'ContainerInstance', [...nodePath, inst?.name ?? '']));
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

    const collectViews = (arr: any[], type: string): void => {
        (arr ?? []).forEach((v: any) => {
            views.push({
                key: String(v?.key ?? ''),
                type,
                title: v?.title,
                description: v?.description,
                elementIds: (v?.elements ?? []).map((e: any) => String(e?.id ?? '')),
                relationships: (v?.relationships ?? []).map((r: any) => ({
                    id: r?.id,
                    sourceId: String(r?.sourceId ?? ''),
                    destinationId: String(r?.destinationId ?? ''),
                    description: r?.description,
                    order: r?.order,
                })),
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
