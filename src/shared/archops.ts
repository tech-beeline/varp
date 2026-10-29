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

/** Settings of the archops automation server. */
export const ARCHOPS_URL = 'archops.api.url';
export const ARCHOPS_KEY = 'archops.api.key';
export const ARCHOPS_SECRET = 'archops.api.secret';

/** Context key that shows the archops views only when the server is configured. */
export const ARCHOPS_CONFIGURED_CONTEXT = 'varp.archops';

/** Minimal configuration reader, so the check does not depend on the vscode module. */
export interface ConfigurationReader {
    get<T>(section: string): T | undefined;
}

/** Whether the archops server is fully configured: URL, key and secret. */
export function archopsConfigured(configuration: ConfigurationReader): boolean {
    const url = configuration.get<string>(ARCHOPS_URL)?.trim();
    const key = configuration.get<string>(ARCHOPS_KEY)?.trim();
    const secret = configuration.get<string>(ARCHOPS_SECRET)?.trim();
    return Boolean(url && key && secret);
}
