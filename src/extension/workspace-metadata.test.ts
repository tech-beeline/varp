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
import { WORKSPACE_METADATA_AGENT, applyWorkspaceFileMetadata, isoUtcSeconds } from './workspace-metadata';

describe('workspace file metadata', () => {
    it('formats the timestamp the way the Structurizr JSON writer does', () => {
        // 2026-09-23T14:39:10.123Z -> seconds precision, UTC, trailing Z
        expect(isoUtcSeconds(Date.UTC(2026, 8, 23, 14, 39, 10, 123))).toBe('2026-09-23T14:39:10Z');
        expect(isoUtcSeconds(0)).toBe('1970-01-01T00:00:00Z');
    });

    it('records the agent and the file timestamp', () => {
        const json: any = {};
        applyWorkspaceFileMetadata(json, Date.UTC(2026, 8, 23, 14, 39, 10));
        expect(json).toEqual({
            lastModifiedAgent: WORKSPACE_METADATA_AGENT,
            lastModifiedDate: '2026-09-23T14:39:10Z'
        });
    });

    it('keeps the date unset when the document has no timestamp', () => {
        const json: any = {};
        applyWorkspaceFileMetadata(json, undefined);
        expect(json.lastModifiedAgent).toBe(WORKSPACE_METADATA_AGENT);
        expect('lastModifiedDate' in json).toBe(false);
    });

    it('ignores a non-finite timestamp', () => {
        const json: any = {};
        applyWorkspaceFileMetadata(json, Number.NaN);
        expect('lastModifiedDate' in json).toBe(false);
    });
});
