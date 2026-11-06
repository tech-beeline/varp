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

import type { ViewRef } from '../shared/view-refs';

/**
 * Finds the view in the fresh view list that corresponds to the currently
 * displayed view. View keys embed a CST-offset hash that changes when the source
 * is edited, so the exact key can go stale. Views of the same target and type share
 * the `<TargetName>-<ViewType>` prefix, so the match uses the title first and the
 * declaration order second: picking the first view with the prefix would switch the
 * preview to another view of the same scope while the source is being edited.
 *
 * Returns undefined when the view cannot be identified; the caller then keeps the
 * displayed view instead of switching to a sibling.
 */
export function resolveFreshViewKey(fresh: ViewRef[] | undefined, currentKey: string | undefined, previous?: ViewRef[]): string | undefined {
    if (!currentKey) {
        return undefined;
    }
    const views = fresh ?? [];
    if (views.some(view => view.key === currentKey)) {
        return currentKey;
    }

    const dash = currentKey.lastIndexOf('-');
    const prefix = dash > 0 ? currentKey.substring(0, dash) : currentKey;
    const freshGroup = viewsWithPrefix(views, prefix);
    if (freshGroup.length === 0) {
        return undefined;
    }

    const previousGroup = viewsWithPrefix(previous ?? [], prefix);
    const index = previousGroup.findIndex(view => view.key === currentKey);
    if (index < 0) {
        return undefined;
    }

    const previousTitle = previousGroup[index]?.title;
    if (previousTitle) {
        const sameTitle = freshGroup.filter(view => view.title === previousTitle);
        return sameTitle.length === 1 ? sameTitle[0].key : undefined;
    }
    // Untitled views keep their declaration order; a different count means the view
    // itself disappeared (for example while its expression does not parse yet).
    if (freshGroup.length !== previousGroup.length) {
        return undefined;
    }
    return (freshGroup[index] ?? freshGroup[0]).key;
}

/** Views whose key starts with the stable `<TargetName>-<ViewType>` prefix, in list order. */
function viewsWithPrefix(views: ViewRef[], prefix: string): ViewRef[] {
    if (!prefix) {
        return [];
    }
    return views.filter(view => view.key.startsWith(prefix + '-'));
}
