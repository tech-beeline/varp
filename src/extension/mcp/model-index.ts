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
    views: McpView[];
}

export function buildModelIndex(model: FlattenedModel): ModelIndex {
    const elementById = new Map<string, McpElement>();
    const outgoers = new Map<string, McpRelationship[]>();
    const incomers = new Map<string, McpRelationship[]>();

    for (const e of model.elements) {
        elementById.set(e.id, e);
        outgoers.set(e.id, e.relationships);
    }
    for (const e of model.elements) {
        for (const r of e.relationships) {
            if (!incomers.has(r.destinationId)) {
                incomers.set(r.destinationId, []);
            }
            incomers.get(r.destinationId)!.push(r);
        }
    }

    return { elementById, outgoers, incomers, views: model.views };
}

function pathsEqual(a: string[], b: string[]): boolean {
    if (a.length !== b.length) {
        return false;
    }
    return a.every((v, i) => v === b[i]);
}

/** True when `ancestor`'s path is a strict prefix of `descendant`'s path. */
function isStrictPrefix(ancestor: string[], descendant: string[]): boolean {
    // An empty path (root-level element) is not a strict ancestor of anything:
    // `[].every(...)` is vacuously true and would mark every root element as an
    // ancestor of every other element.
    if (ancestor.length === 0 || ancestor.length >= descendant.length) {
        return false;
    }
    return ancestor.every((v, i) => v === descendant[i]);
}

/** All elements strictly contained under `id` (by path), including itself's nested levels. */
export function descendantsOf(index: ModelIndex, id: string): McpElement[] {
    const el = index.elementById.get(id);
    if (!el) {
        return [];
    }
    return [...index.elementById.values()].filter(e => e.id !== id && isStrictPrefix(el.path, e.path));
}

/** All elements that strictly contain `id` (by path). */
export function ancestorsOf(index: ModelIndex, id: string): McpElement[] {
    const el = index.elementById.get(id);
    if (!el) {
        return [];
    }
    return [...index.elementById.values()].filter(e => e.id !== id && isStrictPrefix(e.path, el.path));
}

/** Direct children (one path level deeper) of `id`. */
export function childrenOf(index: ModelIndex, id: string): McpElement[] {
    const el = index.elementById.get(id);
    if (!el) {
        return [];
    }
    return [...index.elementById.values()].filter(
        e => e.id !== id && e.path.length === el.path.length + 1 && isStrictPrefix(el.path, e.path),
    );
}

/** The direct parent of `id`, if any. */
export function parentOf(index: ModelIndex, id: string): McpElement | undefined {
    const el = index.elementById.get(id);
    if (!el || el.path.length === 0) {
        return undefined;
    }
    const parentPath = el.path.slice(0, -1);
    return [...index.elementById.values()].find(e => pathsEqual(e.path, parentPath));
}

/** Elements sharing the same parent as `id` (excluding itself). */
export function siblingsOf(index: ModelIndex, id: string): McpElement[] {
    const el = index.elementById.get(id);
    if (!el || el.path.length === 0) {
        return [];
    }
    const parentPath = el.path.slice(0, -1);
    return [...index.elementById.values()].filter(
        e => e.id !== id && e.path.length === parentPath.length + 1 && pathsEqual(e.path.slice(0, -1), parentPath),
    );
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
