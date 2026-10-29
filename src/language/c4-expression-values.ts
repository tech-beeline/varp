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

import { AstUtils, type AstNode } from 'langium';
import {
    isArchetypeDefinition, isArchetypeInstance, isComponent, isConstant, isContainer, isContainerInstance,
    isCustomElement, isDeploymentNode, isElementExtension, isElementsDirective, isGenericInstance, isGroup,
    isInfrastructureNode, isPerson, isPropertiesBlock, isRelationship, isRelationshipExtension, isRelationshipsDirective,
    isSoftwareSystem, isSoftwareSystemInstance
} from '../generated/ast';
import { C4Utils } from './c4-utils';

/** Values that view and model expressions can compare against. */
export interface ExpressionValues {
    elementTags: string[];
    relationshipTags: string[];
    technologies: string[];
    groups: string[];
    elementPropertyKeys: string[];
    elementPropertyValues: Map<string, string[]>;
    relationshipPropertyKeys: string[];
    relationshipPropertyValues: Map<string, string[]>;
    propertyKeys: string[];
    constants: string[];
    views: string[];
}

/** The same values collected from a single document. */
export interface DocumentValues {
    elementTags: Set<string>;
    relationshipTags: Set<string>;
    technologies: Set<string>;
    groups: Set<string>;
    elementPropertyKeys: Set<string>;
    elementPropertyValues: Map<string, Set<string>>;
    relationshipPropertyKeys: Set<string>;
    relationshipPropertyValues: Map<string, Set<string>>;
    propertyKeys: Set<string>;
    constants: Set<string>;
    views: Set<string>;
}

/** Group path separator used by Structurizr when the workspace does not override it. */
const GROUP_SEPARATOR = '/';

/**
 * Collects the distinct tag, technology, group and property values declared in one
 * document. The per-document result is cached by the caller, so editing one file does
 * not rescan the rest of the workspace.
 */
export function collectDocumentValues(root: AstNode | undefined): DocumentValues {
    const values: DocumentValues = {
        elementTags: new Set(),
        relationshipTags: new Set(),
        technologies: new Set(),
        groups: new Set(),
        elementPropertyKeys: new Set(),
        elementPropertyValues: new Map(),
        relationshipPropertyKeys: new Set(),
        relationshipPropertyValues: new Map(),
        propertyKeys: new Set(),
        constants: new Set(),
        views: new Set(),
    };
    if (!root) return values;

    for (const node of AstUtils.streamAllContents(root)) {
        if (isPropertiesBlock(node)) {
            for (const item of node.items) {
                const key = C4Utils.stripQuotes(String(item.name ?? '')).trim();
                if (key) values.propertyKeys.add(key);
            }
            continue;
        }
        if (isConstant(node)) {
            const name = C4Utils.stripQuotes(String(node.name ?? '')).trim();
            if (name) values.constants.add(name);
            continue;
        }
        if (node.$type.endsWith('View') && typeof (node as any).key === 'string') {
            const key = C4Utils.stripQuotes((node as any).key).trim();
            if (key) values.views.add(key);
            continue;
        }
        // Overlays, element extensions and archetypes declare values that end up on the
        // elements they modify or instantiate.
        if (isElementsDirective(node) || isElementExtension(node) || isArchetypeDefinition(node)) {
            collectTags(node, values.elementTags);
            collectTechnology(node, values.technologies);
            collectProperties(node, values.elementPropertyKeys, values.elementPropertyValues);
            continue;
        }
        if (isRelationshipExtension(node) || isRelationshipsDirective(node)) {
            collectTags(node, values.relationshipTags);
            collectProperties(node, values.relationshipPropertyKeys, values.relationshipPropertyValues);
            continue;
        }
        if (isRelationship(node)) {
            collectTags(node, values.relationshipTags);
            collectProperties(node, values.relationshipPropertyKeys, values.relationshipPropertyValues);
            continue;
        }
        if (isGroup(node)) {
            const path = groupPath(node);
            if (path) values.groups.add(path);
            continue;
        }
        if (!isElement(node)) continue;
        collectTags(node, values.elementTags);
        collectTechnology(node, values.technologies);
        collectProperties(node, values.elementPropertyKeys, values.elementPropertyValues);
    }
    return values;
}

/** Merges per-document values into the sorted lists used by completion. */
export function mergeExpressionValues(documents: Iterable<DocumentValues>): ExpressionValues {
    const elementTags = new Set<string>();
    const relationshipTags = new Set<string>();
    const technologies = new Set<string>();
    const groups = new Set<string>();
    const elementPropertyKeys = new Set<string>();
    const relationshipPropertyKeys = new Set<string>();
    const elementPropertyValues = new Map<string, Set<string>>();
    const relationshipPropertyValues = new Map<string, Set<string>>();
    const propertyKeys = new Set<string>();
    const constants = new Set<string>();
    const views = new Set<string>();

    for (const document of documents) {
        addAll(elementTags, document.elementTags);
        addAll(relationshipTags, document.relationshipTags);
        addAll(technologies, document.technologies);
        addAll(groups, document.groups);
        addAll(elementPropertyKeys, document.elementPropertyKeys);
        addAll(relationshipPropertyKeys, document.relationshipPropertyKeys);
        mergeValues(elementPropertyValues, document.elementPropertyValues);
        mergeValues(relationshipPropertyValues, document.relationshipPropertyValues);
        addAll(propertyKeys, document.propertyKeys);
        addAll(constants, document.constants);
        addAll(views, document.views);
    }

    return {
        elementTags: [...elementTags].sort(),
        relationshipTags: [...relationshipTags].sort(),
        technologies: [...technologies].sort(),
        groups: [...groups].sort(),
        elementPropertyKeys: [...elementPropertyKeys].sort(),
        elementPropertyValues: toSortedValues(elementPropertyValues),
        relationshipPropertyKeys: [...relationshipPropertyKeys].sort(),
        relationshipPropertyValues: toSortedValues(relationshipPropertyValues),
        propertyKeys: [...propertyKeys].sort(),
        constants: [...constants].sort(),
        views: [...views].sort(),
    };
}

function addAll(target: Set<string>, source: Set<string>): void {
    for (const value of source) target.add(value);
}

function mergeValues(target: Map<string, Set<string>>, source: Map<string, Set<string>>): void {
    for (const [key, values] of source) {
        const bucket = target.get(key) ?? new Set<string>();
        for (const value of values) bucket.add(value);
        target.set(key, bucket);
    }
}

/** Element types that can carry tags, technologies and properties. */
function isElement(node: AstNode): boolean {
    return isPerson(node) || isSoftwareSystem(node) || isContainer(node) || isComponent(node)
        || isCustomElement(node) || isDeploymentNode(node) || isInfrastructureNode(node)
        || isSoftwareSystemInstance(node) || isContainerInstance(node)
        || isGenericInstance(node) || isArchetypeInstance(node);
}

/** `tags "a, b" c` on an element or relationship. */
function collectTags(node: AstNode, target: Set<string>): void {
    const properties = (node as any).tagsProps;
    if (Array.isArray(properties)) {
        for (const property of properties) {
            for (const value of property?.values ?? []) addTagValue(value, target);
        }
    }
    const declared = (node as any).tags;
    if (Array.isArray(declared)) {
        for (const value of declared) if (typeof value === 'string') addTagValue(value, target);
    }
}

function addTagValue(raw: unknown, target: Set<string>): void {
    if (typeof raw !== 'string') return;
    const trimmed = raw.trim();
    if (!trimmed) return;
    const quoted = trimmed.startsWith('"') && trimmed.endsWith('"');
    const inner = quoted ? trimmed.slice(1, -1) : trimmed;
    const parts = quoted ? inner.split(',') : inner.split(/[\s,]+/);
    for (const part of parts) {
        const tag = part.trim();
        if (tag) target.add(tag);
    }
}

/** Positional technology (`container "C" "desc" "Java"`), comma segments and in-block `technology`. */
function collectTechnology(node: AstNode, target: Set<string>): void {
    const source = node as any;
    addValue(source.technology, target);
    for (const property of source.techProps ?? []) addValue(property?.value, target);
    for (const part of source.technologyParts ?? []) addValue(part, target);
}

function addValue(raw: unknown, target: Set<string>): void {
    if (typeof raw !== 'string') return;
    const value = C4Utils.stripQuotes(raw).trim();
    if (value) target.add(value);
}

/** `properties { "key" "value" }` blocks of an element or relationship. */
function collectProperties(
    node: AstNode,
    keys: Set<string>,
    values: Map<string, Set<string>>
): void {
    for (const block of (node as any).properties ?? []) {
        for (const item of block?.items ?? []) {
            const key = C4Utils.stripQuotes(String(item?.name ?? '')).trim();
            if (!key) continue;
            keys.add(key);
            const value = C4Utils.stripQuotes(String(item?.value ?? '')).trim();
            if (!value) continue;
            const bucket = values.get(key) ?? new Set<string>();
            bucket.add(value);
            values.set(key, bucket);
        }
    }
}

/** Group path from the outermost enclosing group, e.g. `Platform/Integration`. */
function groupPath(group: AstNode): string {
    const names: string[] = [];
    let node: AstNode | undefined = group;
    while (node && isGroup(node)) {
        const name = C4Utils.stripQuotes(String(node.name ?? '')).trim();
        if (name) names.unshift(name);
        node = node.$container;
    }
    return names.join(GROUP_SEPARATOR);
}

function toSortedValues(values: Map<string, Set<string>>): Map<string, string[]> {
    return new Map([...values].map(([key, bucket]) => [key, [...bucket].sort()]));
}

/** Tags declared on a single element or relationship. */
export function declaredTagsOf(node: AstNode): string[] {
    const tags = new Set<string>();
    collectTags(node, tags);
    return [...tags];
}

/** Group path of an element, e.g. `Platform/Integration`. */
export function groupPathOf(node: AstNode): string | undefined {
    const names: string[] = [];
    let current = node.$container;
    while (current && isGroup(current)) {
        const name = C4Utils.stripQuotes(String(current.name ?? '')).trim();
        if (name) names.unshift(name);
        current = current.$container;
    }
    return names.length > 0 ? names.join(GROUP_SEPARATOR) : undefined;
}
