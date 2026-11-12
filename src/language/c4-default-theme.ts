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

/**
 * The built-in `default` theme, copied from the open-source
 * https://github.com/structurizr/themes repository (Apache 2.0).
 *
 * The vendor DSL maps `theme default` to the URL below, but the Structurizr
 * cloud no longer serves that file. The content is bundled so the preview
 * renders the same styles without a network request.
 */
export const DEFAULT_THEME_URL = 'https://static.structurizr.com/themes/default/theme.json';

export const DEFAULT_THEME = {
    name: 'Default theme',
    description: 'Description',
    elements: [
        { tag: 'Boundary:Container', color: '#438dd5' },
        { tag: 'Boundary:SoftwareSystem', color: '#1168bd' },
        { tag: 'Component', background: '#85bbf0', color: '#ffffff' },
        { tag: 'Container', background: '#438dd5', color: '#ffffff' },
        { tag: 'Element', shape: 'RoundedBox' },
        { tag: 'Person', background: '#08427b', color: '#ffffff', shape: 'Person' },
        { tag: 'Software System', background: '#1168bd', color: '#ffffff' }
    ]
};

/** Theme content in the format the webview expects from `c4/getThemes`. */
export const DEFAULT_THEME_JSON = JSON.stringify(DEFAULT_THEME);

/** True when a theme declaration names the built-in default theme (any case). */
export function isDefaultThemeName(name: string | undefined): boolean {
    return name !== undefined && name.trim().toLowerCase() === 'default';
}

/** True when a theme URL refers to the built-in default theme. */
export function isDefaultThemeUrl(url: string | undefined): boolean {
    return url === DEFAULT_THEME_URL;
}
