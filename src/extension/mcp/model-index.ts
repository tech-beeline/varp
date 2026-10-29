import type { FlattenedModel, McpElement, McpRelationship, McpView } from './model';

/**
 * Per-project lookup structures built from a FlattenedModel. Used by the graph
 * and query tools to resolve elements by id and traverse relationships without
 * rescanning the element list on every call.
 */
export interface ModelIndex {
    elementById: Map<string, McpElement>;
    /** elementId -> outgoing relationships. */
    outgoers: Map<string, McpRelationship[]>;
    /** elementId -> incoming relationships. */
    incomers: Map<string, McpRelationship[]>;
    /** parentId -> direct children, in model order. */
    children: Map<string, McpElement[]>;
    views: McpView[];
}

export function buildModelIndex(model: FlattenedModel): ModelIndex {
    const elementById = new Map<string, McpElement>();
    const outgoers = new Map<string, McpRelationship[]>();
    const incomers = new Map<string, McpRelationship[]>();
    const children = new Map<string, McpElement[]>();

    for (const e of model.elements) {
        elementById.set(e.id, e);
        outgoers.set(e.id, e.relationships);
        if (e.parentId !== undefined) {
            const list = children.get(e.parentId);
            if (list) {
                list.push(e);
            } else {
                children.set(e.parentId, [e]);
            }
        }
    }
    for (const e of model.elements) {
        for (const r of e.relationships) {
            if (!incomers.has(r.destinationId)) {
                incomers.set(r.destinationId, []);
            }
            incomers.get(r.destinationId)!.push(r);
        }
    }

    return { elementById, outgoers, incomers, children, views: model.views };
}

/**
 * All elements contained under `id` at any depth, in breadth-first order. The
 * queue is walked by index so the traversal stays linear on large subtrees; the
 * caller decides how much of the result to materialise.
 */
export function descendantsOf(index: ModelIndex, id: string): McpElement[] {
    const result: McpElement[] = [];
    const queue = [...(index.children.get(id) ?? [])];
    for (let i = 0; i < queue.length; i++) {
        const child = queue[i];
        result.push(child);
        queue.push(...(index.children.get(child.id) ?? []));
    }
    return result;
}

/** All elements that contain `id`, from the direct parent outwards. */
export function ancestorsOf(index: ModelIndex, id: string): McpElement[] {
    const result: McpElement[] = [];
    let parentId = index.elementById.get(id)?.parentId;
    while (parentId !== undefined) {
        const parent = index.elementById.get(parentId);
        if (!parent) {
            break;
        }
        result.push(parent);
        parentId = parent.parentId;
    }
    return result;
}

/** Direct children of `id`. */
export function childrenOf(index: ModelIndex, id: string): McpElement[] {
    return index.children.get(id) ?? [];
}

/** The direct parent of `id`, if any. */
export function parentOf(index: ModelIndex, id: string): McpElement | undefined {
    const parentId = index.elementById.get(id)?.parentId;
    return parentId !== undefined ? index.elementById.get(parentId) : undefined;
}

/** Elements sharing the same parent as `id` (excluding itself). */
export function siblingsOf(index: ModelIndex, id: string): McpElement[] {
    const el = index.elementById.get(id);
    if (!el || el.parentId === undefined) {
        return [];
    }
    return (index.children.get(el.parentId) ?? []).filter(e => e.id !== id);
}

/** Direct outgoers of `id` (relationship targets), with the relationship attached. */
export function directOutgoers(index: ModelIndex, id: string): { element: McpElement; relationship: McpRelationship }[] {
    return (index.outgoers.get(id) ?? []).map(r => {
        const element = index.elementById.get(r.destinationId);
        return element ? { element, relationship: r } : null;
    }).filter((x): x is { element: McpElement; relationship: McpRelationship } => x !== null);
}

/** Direct incomers of `id` (relationship sources), with the relationship attached. */
export function directIncomers(index: ModelIndex, id: string): { element: McpElement; relationship: McpRelationship }[] {
    return (index.incomers.get(id) ?? []).map(r => {
        const element = index.elementById.get(r.sourceId);
        return element ? { element, relationship: r } : null;
    }).filter((x): x is { element: McpElement; relationship: McpRelationship } => x !== null);
}
