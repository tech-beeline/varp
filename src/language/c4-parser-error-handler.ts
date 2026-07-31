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

import { LangiumParserErrorMessageProvider } from 'langium';
import { IParserErrorMessageProvider, IToken, TokenType } from 'chevrotain';
import { allowedTokensByBlock } from './c4-tokens';

export class C4ParserErrorMessageProvider extends LangiumParserErrorMessageProvider implements IParserErrorMessageProvider {
    
    override buildMismatchTokenMessage(options: {
        expected: TokenType;
        actual: IToken;
        previous: IToken;
        ruleName: string;
    }): string {
        const { ruleName } = options;

        // Static view contexts
        if (ruleName.startsWith('SystemLandscapeView')) {
            return `Unexpected tokens (expected: ${allowedTokensByBlock['SystemLandscapeView'].join(', ')}).`;
        }
        if (ruleName.startsWith('SystemContextView')) {
            return `Unexpected tokens (expected: ${allowedTokensByBlock['SystemContextView'].join(', ')}).`;
        }
        if (ruleName.startsWith('ContainerView')) {
            return `Unexpected tokens (expected: ${allowedTokensByBlock['ContainerView'].join(', ')}).`;
        }
        if (ruleName.startsWith('ComponentView')) {
            return `Unexpected tokens (expected: ${allowedTokensByBlock['ComponentView'].join(', ')}).`;
        }

        // Try to match ruleName against known block keys
        // Order matters: check more specific names first (e.g. 'ContainerInstance' before 'Container')
        const exactKey = [
            'Workspace', 'ModelBlock',
            'SoftwareSystemInstance', 'SoftwareSystem',
            'ContainerInstance', 'Container',
            'Component',
            'DeploymentEnvironment', 'DeploymentNode', 'DeploymentView',
            'DynamicView', 'FilteredView', 'CustomView', 'ImageView',
            'InfrastructureNode', 'ImplicitRelationship',
            'CustomElement', 'GenericInstance',
            'Person',
            'RelationshipStyle', 'Relationship',
            'ElementStyle',
            'ElementsDirective', 'ElementExtension', 'RelationshipExtension',
            'ArchetypesBlock', 'ArchetypeDefinition', 'ArchetypeInstance',
            'ConfigurationBlock', 'PropertiesBlock',
            'StylesBlock', 'LightStyleBlock', 'DarkStyleBlock',
            'TerminologyBlock',
            'ParallelStepBlock', 'DynamicStep', 'AnimationProperty',
            'PerspectivesBlock', 'Perspective',
            'Group'
        ];

        for (const key of exactKey) {
            if (ruleName.startsWith(key)) {
                const tokens = allowedTokensByBlock[key];
                if (tokens) {
                    return `Unexpected tokens (expected: ${tokens.join(', ')}).`;
                }
            }
        }

        // Fallback for ViewsBlock
        if (ruleName.startsWith('Views')) {
            return `Unexpected tokens (expected: ${allowedTokensByBlock['ViewsBlock'].join(', ')}).`;
        }

        return super.buildMismatchTokenMessage(options);
    }

    override buildNotAllInputParsedMessage(options: {
        firstRedundant: IToken;
        ruleName: string;
    }): string {
        return `Unexpected tokens.`;
    }
}