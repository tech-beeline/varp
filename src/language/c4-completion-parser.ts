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

import { EarlyExitException, NoViableAltException, type IToken } from 'chevrotain';
import { createCompletionParser, type LangiumCompletionParser, type LangiumCoreServices } from 'langium';

/**
 * Completion parser with cheap error messages.
 *
 * To describe a parse error, Chevrotain recomputes the lookahead paths of the
 * whole rule (`getLookaheadPathsForOr`) and only then asks the error message
 * provider for a text. On a grammar of this size the recomputation is
 * prohibitively slow, and the completion parser produces such errors on every
 * unfinished edit - for example while the user is typing inside a string literal.
 *
 * Completion only uses the token index and the element stack returned by the
 * parser; the messages are never shown. Throwing the same exception types with
 * an empty message keeps error recovery intact and skips the expensive path.
 */
export function createC4CompletionParser(services: LangiumCoreServices): LangiumCompletionParser {
    const parser = createCompletionParser(services);
    // `wrapper` is protected in AbstractLangiumParser, but the overridden
    // methods below are public members of the Chevrotain parser instance.
    const wrapper = (parser as unknown as { wrapper: ChevrotainErrorRecoveryHooks }).wrapper;
    if (typeof wrapper.raiseNoAltException !== 'function' || typeof wrapper.raiseEarlyExitException !== 'function') {
        // Chevrotain internals changed: keep the stock parser rather than fail.
        return parser;
    }
    wrapper.raiseNoAltException = function (this: ChevrotainErrorRecoveryHooks) {
        throw this.SAVE_ERROR(new NoViableAltException('', this.LA(1), this.LA(0)));
    };
    wrapper.raiseEarlyExitException = function (this: ChevrotainErrorRecoveryHooks) {
        throw this.SAVE_ERROR(new EarlyExitException('', this.LA(1), this.LA(0)));
    };
    return parser;
}

/** The parts of the Chevrotain parser instance used to replace the error messages. */
interface ChevrotainErrorRecoveryHooks {
    raiseNoAltException(occurrence: number, errMsgTypes?: string): never;
    raiseEarlyExitException(occurrence: number, prodType: number, errMsgTypes?: string): never;
    SAVE_ERROR(error: unknown): Error;
    LA(howMuch: number): IToken;
}
