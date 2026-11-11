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

        // The input ended inside a block. The reference parser reports the same and
        // names the likely cause, which a token list alone does not.
        if (options.actual.tokenType.name === 'EOF') {
            const tokens = this.expectedTokens(ruleName);
            const expectedList = tokens ? ` (expected: ${tokens.join(', ')})` : '';
            return `Unexpected end of DSL content${expectedList} - are one or more closing curly braces missing?`;
        }

        // The document has ended and the token belongs to no block. A block-level
        // token list would be misleading here, so only the token is reported.
        if (options.expected.name === 'EOF') {
            return `Unexpected token '${options.actual.image}'`;
        }

        // A group is declared with a name and a body, so the brace is part of the
        // declaration itself rather than a token this block accepts.
        if (ruleName.startsWith('Group') && options.expected.name === '{') {
            return 'Expected: group <name> {';
        }

        const expected = this.buildExpectedMessage(ruleName);
        if (expected !== undefined) {
            return expected;
        }

        return super.buildMismatchTokenMessage(options);
    }

    override buildNoViableAltMessage(options: {
        expectedPathsPerAlt: TokenType[][][];
        actual: IToken[];
        previous: IToken;
        customUserDescription: string;
        ruleName: string;
    }): string {
        // Without this the default message lists every lookahead path of the
        // alternatives, which for a block with many entries is hundreds of lines.
        const expected = this.buildExpectedMessage(options.ruleName);
        if (expected !== undefined) {
            return expected;
        }

        return super.buildNoViableAltMessage(options);
    }

    override buildNotAllInputParsedMessage(options: {
        firstRedundant: IToken;
        ruleName: string;
    }): string {
        return `Unexpected token '${options.firstRedundant.image}'`;
    }

    override buildEarlyExitMessage(options: {
        expectedIterationPaths: TokenType[][];
        actual: IToken[];
        previous: IToken;
        customUserDescription: string;
        ruleName: string;
    }): string {
        // The default message explains the predicted paths of the first iteration,
        // which describes the grammar instead of what the block accepts.
        const expected = this.buildExpectedMessage(options.ruleName);
        if (expected !== undefined) {
            return expected;
        }

        return super.buildEarlyExitMessage(options);
    }

    /** The message naming what the block of the given rule accepts, or `undefined` for an unknown rule. */
    private buildExpectedMessage(ruleName: string): string | undefined {
        // A property block holds no keywords: every entry is a name and a value.
        if (ruleName.startsWith('Propert')) {
            return 'Expected: <name> <value>';
        }
        const tokens = this.expectedTokens(ruleName);
        return tokens === undefined ? undefined : `Unexpected tokens (expected: ${tokens.join(', ')}).`;
    }

    /** The keywords the block of the given rule accepts, or `undefined` for an unknown rule. */
    private expectedTokens(ruleName: string): string[] | undefined {
        // Static view contexts
        if (ruleName.startsWith('SystemLandscapeView')) {
            return allowedTokensByBlock['SystemLandscapeView'];
        }
        if (ruleName.startsWith('SystemContextView')) {
            return allowedTokensByBlock['SystemContextView'];
        }
        if (ruleName.startsWith('ContainerView')) {
            return allowedTokensByBlock['ContainerView'];
        }
        if (ruleName.startsWith('ComponentView')) {
            return allowedTokensByBlock['ComponentView'];
        }

        // Rule names of the generated rules, longest first: 'ContainerInstance'
        // has to win over 'Container', and 'SoftwareSystemInstance' over 'SoftwareSystem'.
        const knownBlocks = [
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

        for (const block of knownBlocks) {
            if (ruleName.startsWith(block)) {
                const tokens = allowedTokensByBlock[block];
                if (tokens) {
                    return tokens;
                }
            }
        }

        // Fallback for ViewsBlock
        if (ruleName.startsWith('Views')) {
            return allowedTokensByBlock['ViewsBlock'];
        }
        return undefined;
    }
}
