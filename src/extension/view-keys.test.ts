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

import { describe, it, expect } from 'vitest';
import { resolveFreshViewKey } from './view-keys';

const json = (...views: any[]) => ({ views: { systemContextViews: views } });

const PLAIN = { key: 'Ensemble-SystemContext-11111111', title: 'Integrations Prod Ensemble' };
const KAFKA = { key: 'Ensemble-SystemContext-22222222', title: 'Integrations Prod Ensemble via Kafka' };

describe('fresh view key resolution', () => {
    it('keeps a key that still exists', () => {
        expect(resolveFreshViewKey(json(PLAIN, KAFKA), KAFKA.key, json(PLAIN, KAFKA))).toBe(KAFKA.key);
    });

    it('matches the edited view by its title, not by declaration order', () => {
        const edited = { ...KAFKA, key: 'Ensemble-SystemContext-33333333' };

        expect(resolveFreshViewKey(json(PLAIN, edited), KAFKA.key, json(PLAIN, KAFKA))).toBe(edited.key);
    });

    it('keeps the displayed view while it is missing from the generated JSON', () => {
        expect(resolveFreshViewKey(json(PLAIN), KAFKA.key, json(PLAIN, KAFKA))).toBeUndefined();
    });

    it('matches untitled views by declaration order', () => {
        const first = { key: 'Ensemble-SystemContext-aaaaaaa1' };
        const second = { key: 'Ensemble-SystemContext-aaaaaaa2' };
        const edited = { key: 'Ensemble-SystemContext-aaaaaaa3' };

        expect(resolveFreshViewKey(json(first, edited), second.key, json(first, second))).toBe(edited.key);
    });

    it('keeps the displayed view when an untitled view disappears', () => {
        const first = { key: 'Ensemble-SystemContext-bbbbbbb1' };
        const second = { key: 'Ensemble-SystemContext-bbbbbbb2' };

        expect(resolveFreshViewKey(json(first), second.key, json(first, second))).toBeUndefined();
    });

    it('does not resolve a changed key without the previous JSON', () => {
        const edited = { ...KAFKA, key: 'Ensemble-SystemContext-33333333' };

        expect(resolveFreshViewKey(json(PLAIN, edited), KAFKA.key, undefined)).toBeUndefined();
    });
});
