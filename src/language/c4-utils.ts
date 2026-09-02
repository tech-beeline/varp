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

import { AstUtils } from 'langium';
import {
    isComponent,
    isContainer,
    isContainerInstance,
    isDeploymentNode,
    isImplicitRelationship,
    isInfrastructureNode,
    isRelationship,
    isSoftwareSystem,
    isSoftwareSystemInstance,
} from '../generated/ast';

export class C4Utils {

    /**
     * Simple and fast string hashing to a 32-bit hex string.
     * Uses the FNV-1a hash algorithm variant.
     * Works in any JS environment (Node, Browser, Worker).
     * Used for generating stable element/view IDs from CST offsets.
     * 
     * @param str The input string to hash
     * @returns 32-bit unsigned integer as lowercase hex string (e.g., "a1b2c3d4")
     */
    static stringHash(str: string): string {
        let hash = 0x811c9dc5;
        for (let i = 0; i < str.length; i++) {
            hash ^= str.charCodeAt(i);
            hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
        }
        // Return as unsigned hex
        return (hash >>> 0).toString(16);
    }
    
    /**
     * Generates a compact hash from multiple string parts joined by '|'.
     * Uses a Bernstein-style hash (djb2 variant) transformed to 32-bit integer.
     * Used for generating stable IDs for relationships from source/target element IDs and offsets.
     * 
     * @param parts String parts to hash (typically element type, source ID, target ID, offset)
     * @returns Compact positive hex string (e.g., "1a2b3c")
     */
    static generateHash(...parts: string[]): string {
        const input = parts.join('|');
        let hash = 0;
        for (let i = 0; i < input.length; i++) {
            const char = input.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash |= 0; // Convert to 32-bit integer
        }
        return Math.abs(hash).toString(16);
    }

    /**
     * Removes surrounding quotes (single, double, or triple-double) and trims whitespace.
     * Handles: `"value"`, `'value'`, `"""value"""`, and partial trimming.
     * Returns empty string for undefined/null input.
     * 
     * @param value The raw DSL string value, possibly with quotes
     * @returns Cleaned string without surrounding quotes
     */
    static stripQuotes(value: string | undefined): string {
        return value?.trim().replace(/^("""|'|")([\s\S]*?)\1$/, '$2').trim() ?? '';
    }
}

export interface FlatIdResolvers {
    /** Resolves the source element of a relationship (used for relationship ids). */
    source?: (rel: any) => any | undefined;
    /** Resolves the target element of a relationship (used for relationship ids). */
    target?: (rel: any) => any | undefined;
}

/**
 * Computes the stable flat id used by the JSON generator for any model node
 * (Person, SoftwareSystem, Container, Component, DeploymentNode, CustomElement,
 * Relationship, ...). The id is a prefix + hash of the element type, a document
 * disambiguator and (for relationships) the resolved source/target ids and CST
 * offset.
 *
 * This is the SINGLE implementation of the id scheme - both the JSON generator
 * (via its own source/target resolvers) and the JSON enricher (to match AST
 * nodes to already-emitted JSON) use it, so the ids always agree.
 *
 * @param element     the AST node ($type + $cstNode required)
 * @param rootDocUri  the URI string of the root workspace document (may be '' to
 *                    skip doc disambiguation, keeping ids identical to single-file)
 * @param resolvers   optional source/target resolvers used for relationship ids;
 *                    when omitted, a fallback context-element walk is used
 */
export function flatId(element: any, rootDocUri: string, resolvers?: FlatIdResolvers): string {
    // Disambiguate elements defined outside the root workspace document so
    // structurally identical files in !include / !extends chains never collide.
    let docPart = '';
    if (rootDocUri && element) {
        try {
            const doc = AstUtils.getDocument(element);
            if (doc && doc.uri) {
                const docUri = doc.uri.toString();
                if (docUri !== rootDocUri) {
                    docPart = docUri.split('/').pop() + '|';
                }
            }
        } catch {
            // ignore - keep short hash
        }
    }

    const offset = element?.$cstNode?.offset ?? '0';
    let hashInput: string;

    if (isImplicitRelationship(element)) {
        const source = (resolvers?.source ?? contextElement)(element);
        const target = (resolvers?.target ?? contextElement)(element);
        const sourceId = source ? flatId(source, rootDocUri, resolvers) : 'unknown_src';
        const targetId = target ? flatId(target, rootDocUri, resolvers) : 'unknown_dst';
        hashInput = `implicit|${sourceId}|${targetId}|${docPart}${offset}`;
    } else if (isRelationship(element)) {
        const source = (resolvers?.source ?? contextElement)(element);
        const target = (resolvers?.target ?? contextElement)(element);
        const sourceId = source ? flatId(source, rootDocUri, resolvers) : 'unknown_src';
        const targetId = target ? flatId(target, rootDocUri, resolvers) : 'unknown_dst';
        hashInput = `relationship|${sourceId}|${targetId}|${docPart}${offset}`;
    } else {
        const type = element?.$type || 'element';
        hashInput = `${type}|${docPart}${offset}`;
    }

    const hash = C4Utils.generateHash(hashInput);

    let prefix = 'element';
    if (isRelationship(element) || isImplicitRelationship(element)) {
        prefix = 'relationship';
    } else if (element?.$type) {
        prefix = element.$type.toLowerCase();
    }
    return `${prefix}_${hash}`;
}

/** Fallback source/target resolver: climbs the AST $container chain for C4 elements. */
function contextElement(rel: any): any | undefined {
    let parent = rel?.$container;
    while (parent) {
        if (isSoftwareSystem(parent) || isContainer(parent) || isComponent(parent) ||
            isDeploymentNode(parent) || isInfrastructureNode(parent) ||
            isSoftwareSystemInstance(parent) || isContainerInstance(parent)) {
            return parent;
        }
        parent = parent.$container;
    }
    return undefined;
}
