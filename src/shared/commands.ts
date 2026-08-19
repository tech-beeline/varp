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
 * Command identifiers shared between the LANGUAGE SERVER (CodeLens in
 * c4-code-lens.ts) and the EXTENSION HOST (init.ts, patterns.ts,
 * capabilities.ts).
 *
 * Kept in a neutral top-level module so the language server never imports
 * from the extension layer (and vice versa the shared values stay
 * dependency-free).
 */

export const DIAGRAM_PREVIEW = "varp.diagram-preview";
export const COPY_CAPABILITY_CODE = "varp.copy-capability-code";
export const SHOW_PATTERN_DESCRIPTION = "varp.show-pattern-description";
export const GET_PATTERN_DSL = "varp.get-pattern-dsl";
export const REFRESH_PATTERNS = "varp.refresh-patterns";
