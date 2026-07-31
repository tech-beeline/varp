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

import type { AstNode } from 'langium';
import { GrammarUtils } from 'langium';
import { AbstractInlayHintProvider, type InlayHintAcceptor } from 'langium/lsp';
import { InlayHintKind } from 'vscode-languageserver';

/**
 * Provides inlay hints (inline labels) for C4 DSL documents.
 * Shows parameter labels like "name:", "description:", "technology:" etc.
 * next to their values in the editor, making the DSL more readable.
 */
export class C4InlayHintProvider extends AbstractInlayHintProvider {
    
    /** AST node types that should display inlay hints (model elements, relationships, views, deployment nodes) */
    private readonly hintableTypes = new Set([
        'Workspace', 'Person', 'SoftwareSystem', 'Container', 'Component',
        'Relationship', 'ImplicitRelationship', 'DynamicStep',
        'DeploymentNode', 'InfrastructureNode', 'SoftwareInstance', 
        'ContainerInstance', 'SoftwareSystemInstance', 'ArchetypeInstance',
        'Group', 'DeploymentEnvironment', 'DeploymentGroup',
        'SystemLandscapeView', 'SystemContextView', 'ContainerView', 
        'ComponentView', 'DeploymentView', 'DynamicView' , 'ImageView', 'FilteredView', 'CustomView', 'HealthCheck', 'CustomElement'
    ]);

    /** Maps grammar property names to their display labels for inlay hints */
    private readonly propertyLabelMap: Record<string, string> = {
        'name': 'name',
        'key': 'key',
        'envName': 'environment', // For DeploymentView (STRING)
        'envRef': 'environment',  // For DeploymentView (Reference)
        'environment': 'environment',
        'description': 'description',
        'technology': 'technology',
        'container' : 'container',
        'deploymentGroupString' : 'deploymentGroup',
        'deploymentGroup' : 'deploymentGroup',
        'deploymentGroups' : 'deploymentGroup',
        'softwareSystem' : 'softwareSystem',
        'tags': 'tags',
        'tag': 'tags',
        'title': 'title',
        'baseKey': 'baseKey',
        'mode': 'mode',
        'instances': 'instances',
        'url': 'url',
        'interval': 'interval',
        'timeout': 'timeout',
        'metadata': 'metadata',
        'order': 'step'           // For DynamicStep (1: a -> b)
    };

    /**
     * Computes inlay hints for a given AST node. For each property in the label map,
     * finds the corresponding CST node and emits a parameter hint at its start position.
     * Skips DeploymentNode.deploymentGroup (handled by a separate grammar property),
     * and skips empty/zero-length CST nodes (optional properties with no value).
     */
    computeInlayHint(node: AstNode, acceptor: InlayHintAcceptor): void {
        if (this.hintableTypes.has(node.$type)) {

            for (const [prop, label] of Object.entries(this.propertyLabelMap)) {

                if(node.$type === 'DeploymentNode' && prop === 'deploymentGroup') {
                    continue;
                }

                const cstNode = GrammarUtils.findNodeForProperty(node.$cstNode, prop);
                
                if (cstNode) {
                    // Skip hidden or empty nodes (optional properties may have empty CST)
                    if (cstNode.range.start.line === cstNode.range.end.line && 
                        cstNode.range.start.character === cstNode.range.end.character) {
                        continue;
                    }

                    acceptor({
                        position: cstNode.range.start,
                        label: `${label}:`,
                        kind: InlayHintKind.Parameter,
                        paddingRight: true,
                    });
                }
            }
        }
    }
}
