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

import { type AstNode } from 'langium';
import {
    isComponent, isContainer, isCustomElement, isDeploymentEnvironment, isDeploymentNode,
    isInfrastructureNode, isPerson, isSoftwareSystem, type NamedElement
} from '../generated/ast';
import { C4Utils } from './c4-utils';

/** A declared relationship, with the elements it connects. */
export interface DeclaredRelationship {
    node: AstNode;
    source: NamedElement;
    destination: NamedElement;
    /** Whether implied relationships are enabled at the point the relationship is declared. */
    impliedEnabled: boolean;
}

/** Element types the model creates implied relationships for. */
function createsImpliedRelationships(element: NamedElement): boolean {
    return isPerson(element) || isSoftwareSystem(element) || isContainer(element)
        || isComponent(element) || isCustomElement(element);
}

/** Nearest enclosing model element; groups and deployment environments are not elements. */
export function parentElementOf(element: NamedElement): NamedElement | undefined {
    let current: any = element.$container;
    while (current) {
        if (isSoftwareSystem(current) || isContainer(current) || isComponent(current)
            || isDeploymentNode(current) || isInfrastructureNode(current)) {
            return current as NamedElement;
        }
        current = current.$container;
    }
    return undefined;
}

/** Whether one element encloses the other; people never count as parents. */
function isAncestor(ancestor: NamedElement, element: NamedElement): boolean {
    if (isPerson(ancestor) || isPerson(element)) return false;
    for (let parent = parentElementOf(element); parent; parent = parentElementOf(parent)) {
        if (parent === ancestor) return true;
    }
    return false;
}

/** Whether an implied relationship may be created between two elements. */
function impliedRelationshipIsAllowed(source: NamedElement, destination: NamedElement): boolean {
    if (source === destination) return false;
    return !isAncestor(source, destination) && !isAncestor(destination, source);
}

/** Relationships declared so far, indexed by source and destination element. */
class RelationshipRegistry {
    private readonly descriptionsBySource = new Map<NamedElement, Map<NamedElement, Set<string>>>();

    /** Whether any relationship, whatever its description, exists between the two elements. */
    hasAny(source: NamedElement, destination: NamedElement): boolean {
        return this.descriptionsBySource.get(source)?.has(destination) ?? false;
    }

    has(source: NamedElement, destination: NamedElement, description: string): boolean {
        return this.descriptionsBySource.get(source)?.get(destination)?.has(description) ?? false;
    }

    add(source: NamedElement, destination: NamedElement, description: string): void {
        let byDestination = this.descriptionsBySource.get(source);
        if (!byDestination) {
            byDestination = new Map<NamedElement, Set<string>>();
            this.descriptionsBySource.set(source, byDestination);
        }
        let descriptions = byDestination.get(destination);
        if (!descriptions) {
            descriptions = new Set<string>();
            byDestination.set(destination, descriptions);
        }
        descriptions.add(description);
    }
}

/**
 * Returns the declared relationships that repeat one already declared or implied between the
 * same elements with the same description.
 *
 * Replays the order the model is built in: each declared relationship is registered, then
 * implied relationships are created between the enclosing elements of its source and
 * destination, unless one already exists.
 */
export function findDuplicateRelationships(relationships: DeclaredRelationship[]): DeclaredRelationship[] {
    const registry = new RelationshipRegistry();
    const duplicates: DeclaredRelationship[] = [];

    for (const relationship of relationships) {
        const { source, destination } = relationship;
        const description = descriptionOf(relationship.node);

        if (registry.has(source, destination, description)) {
            duplicates.push(relationship);
            continue;
        }
        registry.add(source, destination, description);

        if (!relationship.impliedEnabled
            || !createsImpliedRelationships(source)
            || !createsImpliedRelationships(destination)) {
            continue;
        }
        for (let impliedSource: NamedElement | undefined = source; impliedSource; impliedSource = parentElementOf(impliedSource)) {
            for (let impliedDestination: NamedElement | undefined = destination; impliedDestination; impliedDestination = parentElementOf(impliedDestination)) {
                if (impliedRelationshipIsAllowed(impliedSource, impliedDestination) && !registry.hasAny(impliedSource, impliedDestination)) {
                    registry.add(impliedSource, impliedDestination, description);
                }
            }
        }
    }

    return duplicates;
}

/** Description of a relationship declaration, without the surrounding quotes. */
function descriptionOf(node: AstNode): string {
    return C4Utils.stripQuotes((node as any).description ?? '');
}

/** Strips the separators the canonical name format drops. */
function formatCanonicalName(name: string): string {
    return name.replace(/\./g, '').replace(/\//g, '');
}

/** Name of an element, prepared for the canonical name format. */
function elementName(element: NamedElement): string {
    return formatCanonicalName(C4Utils.stripQuotes((element as any).name ?? ''));
}

/**
 * Canonical name of an element, in the shape relationships are reported with. Static
 * structure elements use the type prefix the model uses; other element types fall back to
 * the plain name.
 */
export function canonicalElementName(element: NamedElement): string {
    const name = elementName(element);
    if (isPerson(element)) return `Person://${name}`;
    if (isSoftwareSystem(element)) return `SoftwareSystem://${name}`;
    if (isCustomElement(element)) return `Custom://${name}`;
    if (isContainer(element) || isComponent(element)) {
        const prefix = isContainer(element) ? 'Container' : 'Component';
        return `${prefix}://${[...ancestorNames(element), name].join('.')}`;
    }
    if (isDeploymentNode(element) || isInfrastructureNode(element)) {
        const prefix = isDeploymentNode(element) ? 'DeploymentNode' : 'InfrastructureNode';
        return `${prefix}://${[...deploymentPath(element), name].join('/')}`;
    }
    return name;
}

/** Names of the enclosing elements, outermost first. */
function ancestorNames(element: NamedElement): string[] {
    const names: string[] = [];
    for (let parent = parentElementOf(element); parent; parent = parentElementOf(parent)) {
        names.unshift(elementName(parent));
    }
    return names;
}

/** Names of the enclosing deployment environment and nodes, outermost first. */
function deploymentPath(element: NamedElement): string[] {
    const names: string[] = [];
    let current: any = element.$container;
    while (current) {
        if (isDeploymentEnvironment(current) || isDeploymentNode(current) || isInfrastructureNode(current)) {
            names.unshift(elementName(current));
        }
        current = current.$container;
    }
    return names;
}
