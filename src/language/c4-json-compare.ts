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

/**
 * Structural comparison of C4 JSON output.
 *
 * Two profiles are supported:
 *
 * - `render`: the fields that affect how a diagram is rendered. Verified against the
 *   reference output by the generator fixtures, which run the generator only.
 * - `full`: the whole workspace JSON, including the non-render content added by the
 *   enricher (documentation, retained DSL, DSL identifiers). Verified by the
 *   enricher fixtures, which run the generator and the enricher.
 *
 * The same split applies to `properties`: in `render` mode only the keys the
 * renderer/layout reads are compared, in `full` mode all user properties are.
 */

import { base64DecodeToBytes } from './c4-base64';

export type CompareMode = 'render' | 'full';

export interface CompareOptions {
    mode?: CompareMode;
}

interface CompareResult {
    path: string;
    message: string;
    expected?: any;
    actual?: any;
}

/** ID fields are auto-generated and always differ between generators. */
const ID_KEYS = [
    'id', 'softwareSystemId', 'containerId', 'parentId', 'elementId',
    'sourceId', 'destinationId', 'linkedRelationshipId',
];

/**
 * Keys ignored by both profiles: ids, host metadata, our own layout output and the
 * view key scheme (a product decision — keys are generated differently on purpose).
 */
const COMMON_IGNORED_KEYS = new Set([
    '$',
    ...ID_KEYS,
    'lastModifiedDate', 'lastModifiedAgent',
    'dimensions', 'paperSize', 'automaticLayout',
    'key',
]);

/**
 * Non-render keys, ignored in `render` mode but compared in `full` mode:
 * documentation (and its image MIME `type`), and the auto-generated-key flag
 * do not affect rendering.
 */
const RENDER_ONLY_IGNORED_KEYS = new Set([
    'documentation',
    'type',
    'generatedKey',
]);

/**
 * Properties read by the renderer/layout. Compared in `render` mode; in `full`
 * mode all user properties are compared instead.
 */
const RENDER_PROPERTY_KEYS = new Set([
    'structurizr.groupSeparator',
    'structurizr.groupPadding',
    'structurizr.boundaryPadding',
    'structurizr.deploymentNodePadding',
    'plantuml.url',
    'plantuml.format',
]);

/**
 * Compares two C4 JSON objects structurally.
 * Returns array of differences (empty if identical).
 */
export function compareJson(actual: any, expected: any, path: string = '', options: CompareOptions = {}): CompareResult[] {
    const diffs: CompareResult[] = [];
    const mode: CompareMode = options.mode ?? 'full';

    if (actual === expected) return diffs;

    if (typeof actual !== typeof expected) {
        diffs.push({ path, message: 'Type mismatch', expected: typeof expected, actual: typeof actual });
        return diffs;
    }

    if (actual === null || expected === null) {
        if (actual !== expected) {
            diffs.push({ path, message: 'Null mismatch', expected, actual });
        }
        return diffs;
    }

    if (typeof actual === 'object') {
        if (Array.isArray(actual) && Array.isArray(expected)) {
            compareArrays(actual, expected, path, diffs, mode);
        } else if (!Array.isArray(actual) && !Array.isArray(expected)) {
            compareObjects(actual, expected, path, diffs, mode);
        } else {
            diffs.push({ path, message: 'Array/object mismatch', expected: Array.isArray(expected), actual: Array.isArray(actual) });
        }
    }

    return diffs;
}

function compareObjects(actual: any, expected: any, path: string, diffs: CompareResult[], mode: CompareMode): void {
    const ignored = mode === 'render'
        ? new Set([...COMMON_IGNORED_KEYS, ...RENDER_ONLY_IGNORED_KEYS])
        : COMMON_IGNORED_KEYS;

    // Collect all keys (ignore $document, $cstNode and similar internal properties)
    const keys = new Set([...Object.keys(actual), ...Object.keys(expected)]);

    for (const key of keys) {
        if (key.startsWith('$') || ignored.has(key)) continue;
        // The root workspace configuration is empty in the reference output and is
        // not produced by the generator; the view configuration (styles, themes,
        // terminology) is compared.
        if (key === 'configuration' && path === '') continue;

        const actualVal = actual[key];
        const expectedVal = expected[key];

        // Both undefined/absent → skip
        if (actualVal === undefined && expectedVal === undefined) continue;

        // If one is undefined and the other is null → treat as same
        if (actualVal === undefined && expectedVal === null) continue;
        if (actualVal === null && expectedVal === undefined) continue;

        // If both are empty arrays or undefined → skip
        if (Array.isArray(actualVal) && actualVal.length === 0 && expectedVal === undefined) continue;
        if (Array.isArray(expectedVal) && expectedVal.length === 0 && actualVal === undefined) continue;

        // An empty styles block ({elements: [], relationships: []}) is equivalent to
        // an absent styles field — the generator now omits empty style collections.
        if (key === 'styles' && actualVal === undefined &&
            expectedVal && Array.isArray(expectedVal.elements) && expectedVal.elements.length === 0 &&
            Array.isArray(expectedVal.relationships) && expectedVal.relationships.length === 0) {
            continue;
        }

        const childPath = path ? `${path}.${key}` : key;

        // Property maps are compared by profile: render keys only, or every user
        // property (server inspection counters and auto-generated DSL identifiers
        // are not comparable values).
        if (key === 'properties') {
            compareProperties(actualVal, expectedVal, childPath, diffs, mode);
            continue;
        }

        // Special handling for named elements (model)
        if (key === 'people' || key === 'softwareSystems' || key === 'deploymentNodes' || key === 'customElements') {
            compareNamedArrays(actualVal, expectedVal, childPath, 'name', diffs, mode);
        } else if (key === 'containers' || key === 'components' || key === 'children' || key === 'infrastructureNodes') {
            compareNamedArrays(actualVal, expectedVal, childPath, 'name', diffs, mode);
        } else if (key === 'softwareSystemInstances' || key === 'containerInstances') {
            // Instances have no name and their element ids differ between generators,
            // so compare them positionally (declaration order).
            compareArrays(actualVal, expectedVal, childPath, diffs, mode);
        } else if (key === 'relationships' && path.includes('model')) {
            compareRelationshipArrays(actualVal, expectedVal, childPath, diffs, mode);
        } else if (path.includes('animations') && (key === 'elements' || key === 'relationships')) {
            // Animation steps reference element/relationship ids that differ between
            // generators — compare the number of entries per step.
            compareAnimationIdArrays(actualVal, expectedVal, childPath, diffs);
        } else if (key === 'elements' && (path.includes('view') || path.includes('views')) && !path.includes('animations') && !path.includes('configuration')) {
            // View elements are arrays of {id, x, y} — just check count and ID presence.
            // Style elements live under configuration and are compared as objects.
            compareViewElementArrays(actualVal, expectedVal, childPath, diffs);
        } else if (key === 'relationships' && (path.includes('view') || path.includes('views')) && !path.includes('animations') && !path.includes('configuration')) {
            // View relationships carry vertices and ids that differ between generators.
            // Style relationships live under configuration and are compared as objects.
            compareViewRelationshipArrays(actualVal, expectedVal, childPath, diffs);
        } else if (Array.isArray(actualVal) && Array.isArray(expectedVal)) {
            compareArrays(actualVal, expectedVal, childPath, diffs, mode);
        } else if (typeof actualVal === 'object' && typeof expectedVal === 'object' && actualVal !== null && expectedVal !== null) {
            const nested = compareJson(actualVal, expectedVal, childPath, { mode });
            diffs.push(...nested);
        } else {
            // Primitive value comparison
            if (actualVal !== expectedVal) {
                diffs.push({ path: childPath, message: 'Value mismatch', expected: expectedVal, actual: actualVal });
            }
        }
    }
}

/**
 * Compares two property maps. In `render` mode only the render-affecting keys are
 * compared; in `full` mode every user property is, except the server inspection
 * counters and the auto-generated `structurizr.dsl.identifier` (random UUIDs, whose
 * shape is asserted by the identifiers fixture).
 */
function compareProperties(actual: any, expected: any, path: string, diffs: CompareResult[], mode: CompareMode): void {
    const actualProps = actual && typeof actual === 'object' ? actual : {};
    const expectedProps = expected && typeof expected === 'object' ? expected : {};

    for (const key of new Set([...Object.keys(actualProps), ...Object.keys(expectedProps)])) {
        if (key.startsWith('structurizr.inspection')) continue;
        if (mode === 'render' && !RENDER_PROPERTY_KEYS.has(key)) continue;
        if (mode === 'full' && key === 'structurizr.dsl.identifier') continue;

        const actualVal = actualProps[key];
        const expectedVal = expectedProps[key];
        if (actualVal === undefined && expectedVal === undefined) continue;

        // The retained DSL is joined with the host line separator (`\r\n` on
        // Windows, `\n` elsewhere) while the fixtures encode CRLF, so compare the
        // decoded text with normalized line endings.
        if (key === 'structurizr.dsl') {
            if (normalizeRetainedDsl(actualVal) !== normalizeRetainedDsl(expectedVal)) {
                diffs.push({ path: `${path}.${key}`, message: 'Property mismatch', expected: expectedVal, actual: actualVal });
            }
            continue;
        }

        if (actualVal !== expectedVal) {
            diffs.push({ path: `${path}.${key}`, message: 'Property mismatch', expected: expectedVal, actual: actualVal });
        }
    }
}

/** Decodes a retained-DSL base64 value and normalizes its line endings to LF. */
function normalizeRetainedDsl(value: unknown): unknown {
    if (typeof value !== 'string') return value;
    try {
        const bytes = base64DecodeToBytes(value);
        return new TextDecoder().decode(bytes).replace(/\r\n/g, '\n');
    } catch {
        return value;
    }
}

function compareArrays(actual: any[], expected: any[], path: string, diffs: CompareResult[], mode: CompareMode): void {
    // For primitive arrays, sort and compare
    if (actual.every((v: any) => typeof v !== 'object') && expected.every((v: any) => typeof v !== 'object')) {
        const sortedActual = [...actual].sort();
        const sortedExpected = [...expected].sort();
        if (JSON.stringify(sortedActual) !== JSON.stringify(sortedExpected)) {
            diffs.push({ path, message: 'Array mismatch', expected, actual });
        }
        return;
    }

    // For object arrays, compare one by one
    const maxLen = Math.max(actual.length, expected.length);
    for (let i = 0; i < maxLen; i++) {
        if (i >= actual.length) {
            diffs.push({ path: `${path}[${i}]`, message: 'Missing in actual', expected: expected[i], actual: undefined });
        } else if (i >= expected.length) {
            diffs.push({ path: `${path}[${i}]`, message: 'Extra in actual', expected: undefined, actual: actual[i] });
        } else {
            const nested = compareJson(actual[i], expected[i], `${path}[${i}]`, { mode });
            diffs.push(...nested);
        }
    }
}

/**
 * Compare arrays of named elements (people, softwareSystems, deploymentNodes, etc.)
 * Match by the specified key field (e.g. "name") instead of by index.
 */
function compareNamedArrays(actual: any[], expected: any[], path: string, keyField: string, diffs: CompareResult[], mode: CompareMode): void {
    if (!Array.isArray(actual) && !Array.isArray(expected)) return;
    // An absent field (undefined) is equivalent to an empty array — the generator
    // now omits empty collections entirely.
    if (Array.isArray(actual) && actual.length === 0 && expected === undefined) return;
    if (Array.isArray(expected) && expected.length === 0 && actual === undefined) return;
    if (!Array.isArray(actual)) { diffs.push({ path, message: 'Expected array', expected: 'array', actual }); return; }
    if (!Array.isArray(expected)) { diffs.push({ path, message: 'Expected array', actual: 'array', expected }); return; }

    // Build map by key
    const actualMap = new Map<string, any>();
    for (const item of actual) {
        const key = item[keyField];
        if (key !== undefined && key !== null) actualMap.set(String(key), item);
    }
    const expectedMap = new Map<string, any>();
    for (const item of expected) {
        const key = item[keyField];
        if (key !== undefined && key !== null) expectedMap.set(String(key), item);
    }

    // Check expected items exist in actual
    for (const [key, expectedItem] of expectedMap) {
        const actualItem = actualMap.get(key);
        if (!actualItem) {
            diffs.push({ path: `${path}[${key}]`, message: `Missing element "${key}"`, expected: expectedItem, actual: undefined });
        } else {
            const nested = compareJson(actualItem, expectedItem, `${path}[${key}]`, { mode });
            diffs.push(...nested);
        }
    }

    // Report extra items in actual
    for (const [key, actualItem] of actualMap) {
        if (!expectedMap.has(key)) {
            diffs.push({ path: `${path}[${key}]`, message: `Extra element "${key}"`, expected: undefined, actual: actualItem });
        }
    }
}

/**
 * Compare relationship arrays by matching source→target names.
 */
function compareRelationshipArrays(actual: any[], expected: any[], path: string, diffs: CompareResult[], mode: CompareMode): void {
    if (!Array.isArray(actual) && !Array.isArray(expected)) return;
    // An absent field (undefined) is equivalent to an empty array — the generator
    // now omits empty collections entirely.
    if (Array.isArray(actual) && actual.length === 0 && expected === undefined) return;
    if (Array.isArray(expected) && expected.length === 0 && actual === undefined) return;
    if (!Array.isArray(actual)) { diffs.push({ path, message: 'Expected array', expected: 'array', actual }); return; }
    if (!Array.isArray(expected)) { diffs.push({ path, message: 'Expected array', actual: 'array', expected }); return; }

    // For each expected relationship, find a matching actual one by sourceId→destinationId
    // But since IDs may differ, we match by description as fallback
    const usedIndices = new Set<number>();

    const tagsEqual = (a: any, b: any) => (a?.tags ?? '') === (b?.tags ?? '');
    const descEqual = (a: any, b: any) => (!a?.description && !b?.description) ||
        (a?.description?.toLowerCase() === b?.description?.toLowerCase());

    const compare = (expectedRel: any, index: number) => {
        usedIndices.add(index);
        // Compare relationship content (skip ID, sourceId, destinationId)
        const nested = compareJson(
            { ...actual[index], id: undefined, sourceId: undefined, destinationId: undefined, linkedRelationshipId: undefined },
            { ...expectedRel, id: undefined, sourceId: undefined, destinationId: undefined, linkedRelationshipId: undefined },
            `${path}[${expectedRel.description || index}]`,
            { mode }
        );
        diffs.push(...nested);
    };

    for (const expectedRel of expected) {
        // Prefer a candidate with the same description and tags, so duplicate
        // descriptions (multiple relationships between the same elements) pair up.
        let matchIndex = -1;
        for (let i = 0; i < actual.length; i++) {
            if (usedIndices.has(i)) continue;
            if (descEqual(expectedRel, actual[i]) && tagsEqual(expectedRel, actual[i])) { matchIndex = i; break; }
        }
        if (matchIndex < 0) {
            for (let i = 0; i < actual.length; i++) {
                if (usedIndices.has(i)) continue;
                if (descEqual(expectedRel, actual[i])) { matchIndex = i; break; }
            }
        }
        if (matchIndex >= 0) {
            compare(expectedRel, matchIndex);
        } else {
            diffs.push({ path: `${path}[${expectedRel.description || '?'}]`, message: 'Missing relationship', expected: expectedRel, actual: undefined });
        }
    }
}

/**
 * Compare animation step id arrays ({elements}/{relationships}). The ids differ
 * between generators, so only the number of entries is compared.
 */
function compareAnimationIdArrays(actual: any, expected: any, path: string, diffs: CompareResult[]): void {
    if (actual === undefined && expected === undefined) return;
    if (!Array.isArray(actual)) { diffs.push({ path, message: 'Expected array', expected: 'array', actual }); return; }
    if (!Array.isArray(expected)) { diffs.push({ path, message: 'Expected array', actual: 'array', expected }); return; }
    if (actual.length !== expected.length) {
        diffs.push({ path, message: 'Animation step count mismatch', expected: expected.length, actual: actual.length });
    }
}

function compareViewElementArrays(actual: any[], expected: any[], path: string, diffs: CompareResult[]): void {
    if (!Array.isArray(actual)) { diffs.push({ path, message: 'Expected array', expected: 'array', actual }); return; }
    if (!Array.isArray(expected)) { diffs.push({ path, message: 'Expected array', actual: 'array', expected }); return; }

    // Just compare counts — IDs will always differ
    if (actual.length !== expected.length) {
        diffs.push({ path, message: `View element count mismatch`, expected: expected.length, actual: actual.length });
    }
}

/**
 * Compare view relationship arrays (list of {id}).
 */
function compareViewRelationshipArrays(actual: any[], expected: any[], path: string, diffs: CompareResult[]): void {
    if (!Array.isArray(actual)) { diffs.push({ path, message: 'Expected array', expected: 'array', actual }); return; }
    if (!Array.isArray(expected)) { diffs.push({ path, message: 'Expected array', actual: 'array', expected }); return; }

    // Just compare counts — IDs will always differ
    if (actual.length !== expected.length) {
        diffs.push({ path, message: `View relationship count mismatch`, expected: expected.length, actual: actual.length });
    }
}
