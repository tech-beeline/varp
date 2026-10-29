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

/** View categories of the generated Structurizr JSON. */
const VIEW_GROUPS = [
    'systemLandscapeViews',
    'systemContextViews',
    'containerViews',
    'componentViews',
    'dynamicViews',
    'deploymentViews',
    'filteredViews',
    'customViews',
];

/**
 * Finds the view in freshly generated JSON that corresponds to the currently
 * displayed view. View keys embed a CST-offset hash that changes when the source
 * is edited, so the exact key can go stale. Views of the same target and type share
 * the `<TargetName>-<ViewType>` prefix, so the match uses the title first and the
 * declaration order second: picking the first view with the prefix would switch the
 * preview to another view of the same scope while the source is being edited.
 *
 * Returns undefined when the view cannot be identified; the caller then keeps the
 * displayed view instead of switching to a sibling.
 */
export function resolveFreshViewKey(json: any, currentKey: string | undefined, previousJson?: any): string | undefined {
    if (!currentKey) {
        return undefined;
    }
    if (findViewByKey(json, currentKey)) {
        return currentKey;
    }

    const dash = currentKey.lastIndexOf('-');
    const prefix = dash > 0 ? currentKey.substring(0, dash) : currentKey;
    const fresh = viewsWithPrefix(json, prefix);
    if (fresh.length === 0) {
        return undefined;
    }

    const previous = viewsWithPrefix(previousJson, prefix);
    const index = previous.findIndex(view => view.key === currentKey);
    if (index < 0) {
        return undefined;
    }

    const previousTitle = previous[index]?.title;
    if (previousTitle) {
        const sameTitle = fresh.filter(view => view.title === previousTitle);
        return sameTitle.length === 1 ? sameTitle[0].key : undefined;
    }
    // Untitled views keep their declaration order; a different count means the view
    // itself disappeared (for example while its expression does not parse yet).
    if (fresh.length !== previous.length) {
        return undefined;
    }
    return (fresh[index] ?? fresh[0]).key;
}

/** Views whose key starts with the stable `<TargetName>-<ViewType>` prefix, in JSON order. */
function viewsWithPrefix(json: any, prefix: string): any[] {
    const views: any[] = [];
    if (!prefix) {
        return views;
    }
    for (const bucket of Object.values((json?.views ?? {}) as Record<string, unknown>)) {
        if (!Array.isArray(bucket)) {
            continue;
        }
        for (const view of bucket as any[]) {
            if (view && typeof view.key === 'string' && view.key.startsWith(prefix + '-')) {
                views.push(view);
            }
        }
    }
    return views;
}

/** Finds a view by its exact key in any view bucket. */
function findViewByKey(json: any, key: string): any | undefined {
    const views = json?.views;
    if (!views) {
        return undefined;
    }
    for (const group of VIEW_GROUPS) {
        const list = views[group];
        if (!Array.isArray(list)) {
            continue;
        }
        const found = list.find((view: any) => view?.key === key);
        if (found) {
            return found;
        }
    }
    return undefined;
}
