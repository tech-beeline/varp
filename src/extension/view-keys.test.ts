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
import { collectViewRefs } from '../shared/view-refs';

const PLAIN = { key: 'Ensemble-SystemContext-11111111', title: 'Integrations Prod Ensemble' };
const KAFKA = { key: 'Ensemble-SystemContext-22222222', title: 'Integrations Prod Ensemble via Kafka' };

describe('fresh view key resolution', () => {
    it('keeps a key that still exists', () => {
        expect(resolveFreshViewKey([PLAIN, KAFKA], KAFKA.key, [PLAIN, KAFKA])).toBe(KAFKA.key);
    });

    it('matches the edited view by its title, not by declaration order', () => {
        const edited = { ...KAFKA, key: 'Ensemble-SystemContext-33333333' };

        expect(resolveFreshViewKey([PLAIN, edited], KAFKA.key, [PLAIN, KAFKA])).toBe(edited.key);
    });

    it('keeps the displayed view while it is missing from the generated list', () => {
        expect(resolveFreshViewKey([PLAIN], KAFKA.key, [PLAIN, KAFKA])).toBeUndefined();
    });

    it('matches untitled views by declaration order', () => {
        const first = { key: 'Ensemble-SystemContext-aaaaaaa1' };
        const second = { key: 'Ensemble-SystemContext-aaaaaaa2' };
        const edited = { key: 'Ensemble-SystemContext-aaaaaaa3' };

        expect(resolveFreshViewKey([first, edited], second.key, [first, second])).toBe(edited.key);
    });

    it('keeps the displayed view when an untitled view disappears', () => {
        const first = { key: 'Ensemble-SystemContext-bbbbbbb1' };
        const second = { key: 'Ensemble-SystemContext-bbbbbbb2' };

        expect(resolveFreshViewKey([first], second.key, [first, second])).toBeUndefined();
    });

    it('does not resolve a changed key without the previous list', () => {
        const edited = { ...KAFKA, key: 'Ensemble-SystemContext-33333333' };

        expect(resolveFreshViewKey([PLAIN, edited], KAFKA.key, undefined)).toBeUndefined();
    });

    it('returns undefined without a current key or a fresh list', () => {
        expect(resolveFreshViewKey([PLAIN], undefined, [PLAIN])).toBeUndefined();
        expect(resolveFreshViewKey(undefined, PLAIN.key, undefined)).toBeUndefined();
    });
});

describe('view references', () => {
    it('collects keys and titles in declaration order across buckets', () => {
        const json = {
            views: {
                systemContextViews: [{ key: 'ctx', title: 'Context' }, { key: 'ctx2' }],
                containerViews: [{ key: 'cont', title: '' }],
                imageViews: [{ key: 'img', title: 'Image' }]
            }
        };

        expect(collectViewRefs(json)).toEqual([
            { key: 'ctx', title: 'Context' },
            { key: 'ctx2' },
            { key: 'cont' },
            { key: 'img', title: 'Image' }
        ]);
    });

    it('skips views without a key and missing buckets', () => {
        expect(collectViewRefs({ views: { systemContextViews: [{ title: 'no key' }, { key: 'ok' }] } }))
            .toEqual([{ key: 'ok' }]);
        expect(collectViewRefs(undefined)).toEqual([]);
    });
});
