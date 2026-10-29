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

/** Agent recorded in the workspace JSON as the producer of the latest revision. */
export const WORKSPACE_METADATA_AGENT = 'c4-varp';

/** `yyyy-MM-ddTHH:mm:ssZ` in UTC, the timestamp format of the Structurizr JSON writer. */
export function isoUtcSeconds(epochMilliseconds: number): string {
    return new Date(Math.floor(epochMilliseconds / 1000) * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * Records who produced the JSON and when its workspace file last changed; the
 * renderer prints both in the diagram metadata block. A document without a file
 * behind it (untitled editor, remote scheme without a timestamp) keeps the date
 * unset, which leaves the block empty.
 */
export function applyWorkspaceFileMetadata(json: any, mtimeMilliseconds: number | undefined): void {
    if (!json) return;

    json.lastModifiedAgent = WORKSPACE_METADATA_AGENT;
    if (typeof mtimeMilliseconds === 'number' && Number.isFinite(mtimeMilliseconds)) {
        json.lastModifiedDate = isoUtcSeconds(mtimeMilliseconds);
    }
}
