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
import { renderFitnessResults, type FitnessResult } from './fitness-results-view';

const result = (response: any): FitnessResult => ({ alias: 'alias', response });

describe('fitness results rendering', () => {
    it('shows the check name after its code', () => {
        const html = renderFitnessResults(result({
            results: {
                'FF-001': { success: true, name: 'Databases are encrypted', check_result: { is_check: true } }
            }
        }));

        expect(html).toContain('<span class="code">FF-001</span><span class="name"> — Databases are encrypted</span>');
    });

    it('shows the code alone when a check has no name', () => {
        const html = renderFitnessResults(result({
            results: {
                'FF-002': { success: true, check_result: { is_check: true } }
            }
        }));

        expect(html).toContain('<span class="code">FF-002</span>');
        expect(html).not.toContain('class="name"');
    });

    it('shows no separator when the name is empty', () => {
        const html = renderFitnessResults(result({
            results: {
                'FF-005': { success: true, name: '', check_result: { is_check: true } },
                'FF-006': { success: true, name: '   ', check_result: { is_check: true } }
            },
            skipped: [{ code: 'FF-007', name: '', reason: 'no data' }]
        }));

        expect(html).toContain('<span class="code">FF-005</span>');
        expect(html).toContain('<span class="code">FF-006</span>');
        expect(html).toContain('<span class="code">FF-007</span>');
        expect(html).not.toContain('class="name"');
        expect(html).not.toContain(' — ');
    });

    it('shows the name of a check that did not run', () => {
        const html = renderFitnessResults(result({
            results: {},
            skipped: [{ code: 'FF-003', name: 'Services are monitored', reason: 'no data' }]
        }));

        expect(html).toContain('<span class="code">FF-003</span><span class="name"> — Services are monitored</span>');
        expect(html).toContain('no data');
    });

    it('escapes the name', () => {
        const html = renderFitnessResults(result({
            results: {
                'FF-004': { success: true, name: '<img src=x onerror="alert(1)">', check_result: { is_check: true } }
            }
        }));

        expect(html).toContain('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
        expect(html).not.toContain('<img');
    });
});
