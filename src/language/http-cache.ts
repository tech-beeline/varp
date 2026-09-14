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
 * Shared in-memory cache for remote (http/https) content fetched by the
 * language server. Used by:
 *  - `!include` / `extendsUri` document resolution (plain fetch + cache)
 *  - remote Structurizr themes (fetch + validation + cache)
 *
 * A single TTL (`HTTP_CACHE_TTL`) governs every cached document. When a theme
 * fails validation (malformed JSON, missing required fields, or unavailable
 * icons), its URL is cached as *invalid for the TTL* so the webview never
 * receives a broken theme; once the TTL expires the next request re-downloads
 * and re-validates it (giving a broken-but-fixed source a chance to recover).
 *
 * The module is platform-neutral: the callers (`main.ts` / `main.browser.ts`)
 * supply the transport dependent `fetch` implementation. Keeping it here lets
 * both entries share one implementation while tests can stub the network.
 */

/** Cache TTL for every remote (http/https) document, in milliseconds. */
export const HTTP_CACHE_TTL = 60000; // 60 seconds

export interface CacheEntry {
	/** Raw text of the cached document (only present when the fetch succeeded). */
	content: string | null;
	/** Whether the fetched content passed the (optional) validator. */
	valid: boolean;
	/** Whether the HTTP request itself failed (network/status error). */
	fetchError: boolean;
	timestamp: number;
}

/** Result of a fetch attempt: the downloaded text and the HTTP response. */
export interface FetchResult {
	text: string;
	/** The URL the content was fetched from (may differ after redirects). */
	response: {
		ok: boolean;
		status: number;
	};
}

export type Fetcher = (url: string) => Promise<FetchResult>;

/**
 * Validator for a fetched document. Throws an Error when the content is
 * unacceptable; returns void/undefined when it is fine.
 *
 * The `fetcher` argument is the cache's own fetcher, so validators that need to
 * verify referenced assets (e.g. theme icons) reuse the same transport - and in
 * tests it can be stubbed together with the cache.
 */
export type ContentValidator = (url: string, text: string, fetcher: Fetcher) => void | Promise<void>;

/**
 * In-memory cache of remote documents. Single instance per process is the norm
 * (module-level usage in the entry points); tests may create their own.
 */
export class HttpCache {
	private readonly cache = new Map<string, CacheEntry>();
	/** URL → in-flight fetch promise. Coalesces concurrent requests to the same
	 *  URL so a burst of calls (e.g. several generate() runs racing on the same
	 *  theme) issue a single network request instead of N duplicates. */
	private readonly inFlight = new Map<string, Promise<string>>();
	private readonly ttl: number;
	private readonly fetcher: Fetcher;

	constructor(fetcher: Fetcher, ttl: number = HTTP_CACHE_TTL) {
		this.fetcher = fetcher;
		this.ttl = ttl;
	}

	/** URL → cache entry; exposed for tests/debugging. */
	public snapshot(): ReadonlyMap<string, CacheEntry> {
		return this.cache;
	}

	private isFresh(entry: CacheEntry): boolean {
		return Date.now() - entry.timestamp < this.ttl;
	}

	/**
	 * Reads a remote document through the cache.
	 *
	 * - Fetches (via the provided fetcher) when no fresh entry exists.
	 * - When a `validator` is supplied it runs *before* the entry is cached, so
	 *   an invalid document is stored as `{ valid: false }` and the caller
	 *   receives an Error (it must not apply the document).
	 * - Invalid/failed entries are served fresh until the TTL expires, then the
	 *   next call re-downloads and re-validates.
	 */
	public async readRemoteWithCache(url: string, validator?: ContentValidator): Promise<string> {
		const cached = this.cache.get(url);

		if (cached && this.isFresh(cached)) {
			if (!cached.valid) {
				throw new Error(`Cached document is invalid: ${url}`);
			}
			return cached.content as string;
		}

		// Coalesce concurrent requests: if a fetch for this URL is already in
		// flight, await the same promise instead of issuing a duplicate network
		// request. Without this, N simultaneous callers (e.g. several generate()
		// runs racing on the same theme URL) fire N identical fetches.
		const pending = this.inFlight.get(url);
		if (pending) {
			// Share the in-flight request (success AND failure). Do NOT retry per
			// waiter on rejection - every waiter falling through to its own fetch
			// would reproduce the download burst the coalescing is meant to stop.
			return pending;
		}

		const request = this.fetchAndCache(url, validator);
		this.inFlight.set(url, request);
		try {
			return await request;
		} finally {
			// Only clear the marker if we are still the owner; a stale finally from
			// an old run must not delete a newer in-flight request.
			if (this.inFlight.get(url) === request) {
				this.inFlight.delete(url);
			}
		}
	}

	private async fetchAndCache(url: string, validator?: ContentValidator): Promise<string> {
		let fetched: FetchResult;
		try {
			fetched = await this.fetcher(url);
		} catch (err) {
			this.cache.set(url, {
				content: null,
				valid: false,
				fetchError: true,
				timestamp: Date.now()
			});
			throw err;
		}

		if (!fetched.response.ok) {
			this.cache.set(url, {
				content: fetched.text,
				valid: false,
				fetchError: true,
				timestamp: Date.now()
			});
			throw new Error(`Failed to fetch ${url}: ${fetched.response.status}`);
		}

		if (validator) {
			try {
				await validator(url, fetched.text, this.fetcher);
			} catch (err) {
				this.cache.set(url, {
					content: fetched.text,
					valid: false,
					fetchError: false,
					timestamp: Date.now()
				});
				throw err;
			}
		}

		this.cache.set(url, {
			content: fetched.text,
			valid: true,
			fetchError: false,
			timestamp: Date.now()
		});
		return fetched.text;
	}
}

/**
 * Default fetcher used in Node.js. `response.text()` may be unavailable for a
 * HEAD-style fetch, but here we always GET (we need the body anyway).
 */
export const defaultFetcher: Fetcher = async (url: string) => {
	const response = await fetch(url);
	return {
		text: await response.text(),
		response: { ok: response.ok, status: response.status }
	};
};

/**
 * Validates that `text` is a well-formed Structurizr theme JSON document.
 *
 * A theme is considered valid when:
 *  - it parses as a JSON object (not null/array/primitive);
 *  - it has `elements` and `relationships` keys, each an array
 *    (their absence would crash the renderer's style/preload loops);
 *  - every `icon`/`logo` it references is downloadable over the network
 *    (relative icon paths are resolved against the theme's base URL first).
 *
 * Throws an Error with a human-readable reason on any failure; the caller
 * treats that as "theme must not be applied".
 */
export async function validateTheme(
 url: string,
 text: string,
 fetcher: Fetcher = defaultFetcher
): Promise<void> {
 let theme: any;
 try {
 	theme = JSON.parse(text);
 } catch {
 	throw new Error(`Theme is not valid JSON: ${url}`);
 }

 if (theme === null || typeof theme !== 'object' || Array.isArray(theme)) {
 	throw new Error(`Theme is not a JSON object: ${url}`);
 }

 if (!Array.isArray(theme.elements)) {
 	throw new Error(`Theme is missing required field "elements" (array): ${url}`);
 }
 if (!Array.isArray(theme.relationships)) {
 	throw new Error(`Theme is missing required field "relationships" (array): ${url}`);
 }

 const baseUrl = url.substring(0, url.lastIndexOf('/') + 1);

 const iconUrls: string[] = [];

 for (const style of theme.elements) {
 	if (style && typeof style === 'object' && typeof style.icon === 'string' && style.icon.length > 0) {
 		// data URIs need no network check
 		if (style.icon.startsWith('data:image')) {
 			continue;
 		}
 		iconUrls.push(resolveIconUrl(baseUrl, style.icon));
 	}
 }

 // The theme logo (bottom-left branding) is also rendered from an image URL.
 if (typeof theme.logo === 'string' && theme.logo.length > 0) {
 	// data URIs need no network check
 	if (theme.logo.startsWith('data:image')) {
 		// skip
 	} else {
 		iconUrls.push(resolveIconUrl(baseUrl, theme.logo));
 	}
 }

 // Verify every referenced image is downloadable. Any failure invalidates the
 // whole theme (per the requirement: unavailable images → do not apply theme).
 for (const iconUrl of iconUrls) {
 	const fetched = await fetcher(iconUrl);
 	if (!fetched.response.ok) {
 		throw new Error(`Theme image is not available (HTTP ${fetched.response.status}): ${iconUrl}`);
 	}
 }
}

function resolveIconUrl(baseUrl: string, icon: string): string {
 if (/^https?:\/\//i.test(icon)) {
 	return icon;
 }
 return baseUrl + icon;
}
