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

import {
    View, isSystemContextView, isContainerView, isComponentView, 
    isDeploymentView,
    isCustomView} from '../generated/ast';
import { C4Utils } from './c4-utils';

/**
 * Generates stable, deterministic keys for views in the C4 workspace.
 * Supports both user-specified explicit keys and auto-generated keys
 * based on view type, scope element, and CST offset for uniqueness.
 */
export class ViewKeyProvider {

    /**
     * Returns the view's explicit key if defined, otherwise generates a stable key.
     * Explicit keys are set via the `key` property in DSL (e.g., `container "MyView" { key "custom-key" }`).
     * Auto-generated keys use the pattern: `<TargetName>-<ViewType>-<hash>`.
     */
    getKey(view: View): string {
        return C4Utils.stripQuotes(view.key) || this.generateStableKey(view);
    }

    /**
     * Generates a stable, deterministic view key based on the view's target element and type.
     * 
     * Key format: `<TargetName>-<ViewType>-<offsetHash>`
     * 
     * Examples:
     * - SystemLandscape view → `Landscape-SystemLandscape-a1b2c3d4`
     * - SystemContext for "MySystem" → `MySystem-SystemContext-e5f6g7h8`
     * - Container view for "MySystem" → `MySystem-Container-9i0j1k2l`
     * - Component view for "MyContainer" → `MyContainer-Component-m3n4o5p6`
     * - Deployment view for "MySystem" in "Live" → `MySystem-Live-Deployment-q7r8s9t0`
     * - Custom view → `Custom-View-u1v2w3x4`
     * 
     * The CST offset hash ensures uniqueness when multiple views of the same type
     * target the same element (e.g., filtered views of the same base view).
     */
    private generateStableKey(view: View): string {
        // Extract view type name without "View" suffix (e.g., "SystemContextView" → "SystemContext")
        const type = view.$type.replace('View', '');
        let targetName = 'Landscape';

        // Determine the target element name based on view type
        if (isSystemContextView(view) || isContainerView(view)) {
            targetName = C4Utils.stripQuotes(view.softwareSystem?.ref?.name) || 'System';
        } else if (isComponentView(view)) {
            targetName = C4Utils.stripQuotes(view.container?.ref?.name) || 'Container';
        } else if (isDeploymentView(view)) {
            targetName = `${C4Utils.stripQuotes(view.softwareSystem?.ref?.name) || 'System'}-${C4Utils.stripQuotes(view.environment?.ref?.name) || 'Env'}`;
        } else if(isCustomView(view)) {
            targetName =  'Custom';
        }

        // Build base key: <TargetName>-<ViewType>
        const baseKey = `${targetName}-${type}`;

        // Append CST offset hash for uniqueness when keys might collide
        const offset = view.$cstNode?.offset || 0;
        return `${baseKey}-${C4Utils.stringHash(offset.toString())}`;
    }

}
