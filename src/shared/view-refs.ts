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

/** Identity of a generated view: its key and display title. */
export interface ViewRef {
    key: string;
    title?: string;
}

/** View buckets in the order the generator writes them. */
const VIEW_BUCKETS = [
    'systemLandscapeViews',
    'systemContextViews',
    'containerViews',
    'componentViews',
    'deploymentViews',
    'dynamicViews',
    'filteredViews',
    'customViews',
    'imageViews'
];

/**
 * Collects the key and title of every view in a generated workspace JSON, in
 * the order the views are declared. The list is small enough to send instead of
 * the workspace JSON when the client only needs to track view keys.
 */
export function collectViewRefs(json: any): ViewRef[] {
    const refs: ViewRef[] = [];
    for (const bucket of VIEW_BUCKETS) {
        const list = json?.views?.[bucket];
        if (!Array.isArray(list)) {
            continue;
        }
        for (const view of list) {
            if (typeof view?.key !== 'string') {
                continue;
            }
            const ref: ViewRef = { key: view.key };
            if (typeof view.title === 'string' && view.title.length > 0) {
                ref.title = view.title;
            }
            refs.push(ref);
        }
    }
    return refs;
}
