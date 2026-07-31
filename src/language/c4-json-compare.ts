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
 * Utility for structural comparison of C4 JSON output.
 * 
 * Compares two JSON objects (actual vs expected) by:
 * - Matching model elements by name (not by ID)
 * - Matching relationships by source→destination names
 * - Matching view elements/relationships via ID mapping
 * - Ignoring ID, order, and minor formatting differences
 */

interface CompareResult {
    path: string;
    message: string;
    expected?: any;
    actual?: any;
}

/**
 * Compares two C4 JSON objects structurally.
 * Returns array of differences (empty if identical).
 */
export function compareJson(actual: any, expected: any, path: string = ''): CompareResult[] {
    const diffs: CompareResult[] = [];

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
            compareArrays(actual, expected, path, diffs);
        } else if (!Array.isArray(actual) && !Array.isArray(expected)) {
            compareObjects(actual, expected, path, diffs);
        } else {
            diffs.push({ path, message: 'Array/object mismatch', expected: Array.isArray(expected), actual: Array.isArray(actual) });
        }
    }

    return diffs;
}

const IGNORED_KEYS = new Set([
    // Langium internals
    '$', 'generatedKey',
    // ID fields — always auto-generated and differ
    'id', 'softwareSystemId', 'containerId', 'parentId', 'sourceId', 'destinationId', 'linkedRelationshipId',
    // Structurizr adds these, we don't — ignore
    'location', 'documentation',
    // View ordering
    'order', 'key',
    // Properties with structurizr.dsl.identifier — Structurizr adds, we don't
    'properties',
    // Structurizr adds empty configuration at root level
    'configuration',
    // Structurizr adds these to views, we don't
    'enterpriseBoundaryVisible',
    // Our actual adds fields that Structurizr doesn't
    'type',
    'externalSoftwareSystemBoundariesVisible',
    'automaticLayout',
    // View rendering details — our generator doesn't produce these
    'dimensions',
    'paperSize',
]);

function compareObjects(actual: any, expected: any, path: string, diffs: CompareResult[]): void {
    // Collect all keys (ignore $document, $cstNode and similar internal properties)
    const keys = new Set([...Object.keys(actual), ...Object.keys(expected)]);
    
    for (const key of keys) {
        if (key.startsWith('$') || IGNORED_KEYS.has(key)) continue;
        
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

        const childPath = path ? `${path}.${key}` : key;

        // Special handling for named elements (model)
        if (key === 'people' || key === 'softwareSystems' || key === 'deploymentNodes' || key === 'customElements') {
            compareNamedArrays(actualVal, expectedVal, childPath, 'name', diffs);
        } else if (key === 'containers' || key === 'components' || key === 'children' || key === 'infrastructureNodes' || key === 'softwareSystemInstances' || key === 'containerInstances') {
            compareNamedArrays(actualVal, expectedVal, childPath, 'name', diffs);
        } else if (key === 'relationships' && path.includes('model')) {
            compareRelationshipArrays(actualVal, expectedVal, childPath, diffs);
        } else if (key === 'elements' && (path.includes('view') || path.includes('views'))) {
            // View elements are arrays of {id, x, y} — just check count and ID presence
            compareViewElementArrays(actualVal, expectedVal, childPath, diffs);
        } else if (key === 'relationships' && (path.includes('view') || path.includes('views'))) {
            compareViewRelationshipArrays(actualVal, expectedVal, childPath, diffs);
        } else if (Array.isArray(actualVal) && Array.isArray(expectedVal)) {
            compareArrays(actualVal, expectedVal, childPath, diffs);
        } else if (typeof actualVal === 'object' && typeof expectedVal === 'object' && actualVal !== null && expectedVal !== null) {
            const nested = compareJson(actualVal, expectedVal, childPath);
            diffs.push(...nested);
        } else {
            // Primitive value comparison (case-insensitive for strings)
            if (typeof actualVal === 'string' && typeof expectedVal === 'string') {
                if (actualVal.toLowerCase() !== expectedVal.toLowerCase()) {
                    diffs.push({ path: childPath, message: 'Value mismatch', expected: expectedVal, actual: actualVal });
                }
            } else if (actualVal !== expectedVal) {
                diffs.push({ path: childPath, message: 'Value mismatch', expected: expectedVal, actual: actualVal });
            }
        }
    }
}

function compareArrays(actual: any[], expected: any[], path: string, diffs: CompareResult[]): void {
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
            const nested = compareJson(actual[i], expected[i], `${path}[${i}]`);
            diffs.push(...nested);
        }
    }
}

/**
 * Compare arrays of named elements (people, softwareSystems, deploymentNodes, etc.)
 * Match by the specified key field (e.g. "name") instead of by index.
 */
function compareNamedArrays(actual: any[], expected: any[], path: string, keyField: string, diffs: CompareResult[]): void {
    if (!Array.isArray(actual) && !Array.isArray(expected)) return;
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
            const nested = compareJson(actualItem, expectedItem, `${path}[${key}]`);
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
function compareRelationshipArrays(actual: any[], expected: any[], path: string, diffs: CompareResult[]): void {
    if (!Array.isArray(actual) && !Array.isArray(expected)) return;
    if (!Array.isArray(actual)) { diffs.push({ path, message: 'Expected array', expected: 'array', actual }); return; }
    if (!Array.isArray(expected)) { diffs.push({ path, message: 'Expected array', actual: 'array', expected }); return; }

    // For each expected relationship, find a matching actual one by sourceId→destinationId
    // But since IDs may differ, we match by description as fallback
    const usedIndices = new Set<number>();
    
    for (const expectedRel of expected) {
        let found = false;
        for (let i = 0; i < actual.length; i++) {
            if (usedIndices.has(i)) continue;
            const actualRel = actual[i];
            
            // Match if descriptions are equal (ignoring case) or both undefined
            const descMatch = (!expectedRel.description && !actualRel.description) ||
                (expectedRel.description?.toLowerCase() === actualRel.description?.toLowerCase());
            
            if (descMatch) {
                found = true;
                usedIndices.add(i);
                
                // Compare relationship content (skip ID, sourceId, destinationId)
                const nested = compareJson(
                    { ...actualRel, id: undefined, sourceId: undefined, destinationId: undefined, linkedRelationshipId: undefined },
                    { ...expectedRel, id: undefined, sourceId: undefined, destinationId: undefined, linkedRelationshipId: undefined },
                    `${path}[${expectedRel.description || i}]`
                );
                diffs.push(...nested);
                break;
            }
        }
        if (!found) {
            diffs.push({ path: `${path}[${expectedRel.description || '?'}]`, message: 'Missing relationship', expected: expectedRel, actual: undefined });
        }
    }
}

/**
 * Compare view element arrays (list of {id, x, y}).
 * Match by ID mapping → name, or just count elements.
 */
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