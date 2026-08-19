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

// Command identifiers now live in the shared module so the language server can
// use them without importing from the extension layer. Re-exported here for
// backward compatibility with the existing extension imports.
export {
    DIAGRAM_PREVIEW,
    COPY_CAPABILITY_CODE,
    SHOW_PATTERN_DESCRIPTION,
    GET_PATTERN_DSL,
    REFRESH_PATTERNS
} from '../shared/commands';
