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

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HttpCache, validateTheme, HTTP_CACHE_TTL, type Fetcher } from './http-cache';

/** Builds an in-memory fetcher from a URL→body map (all responses OK). */
function fetcherFor(map: Record<string, string>): Fetcher {
	return async (url: string) => ({
		text: map[url] ?? '',
		response: { ok: url in map, status: url in map ? 200 : 404 }
	});
}

const VALID_THEME = JSON.stringify({
	name: 'Amazon Web Services',
	elements: [
		{ tag: 'Amazon Web Services - EC2', icon: 'aws-ec2.png' },
		{ tag: 'Amazon Web Services - RDS', icon: 'https://cdn.example.com/rds.png' },
		{ tag: 'Amazon Web Services - Cloud', icon: 'aws-cloud.png', background: '#232f3e' }
	],
	relationships: [{ tag: 'Relationship', color: '#707070' }]
});

describe('HttpCache coalescing (concurrent requests share one fetch)', () => {
	it('issues a single network request for simultaneous readers of the same URL', async () => {
		const fetchSpy = vi.fn(async () => {
			// Simulate a slow network round trip so all callers overlap.
			await new Promise(r => setTimeout(r, 20));
			return { text: 'hello', response: { ok: true, status: 200 } };
		});
		const cache = new HttpCache(fetchSpy as any);

		const results = await Promise.all([
			cache.readRemoteWithCache('https://x.example/doc'),
			cache.readRemoteWithCache('https://x.example/doc'),
			cache.readRemoteWithCache('https://x.example/doc')
		]);
		expect(results).toEqual(['hello', 'hello', 'hello']);
		expect(fetchSpy).toHaveBeenCalledTimes(1);
	});

	it('shares a single failure across concurrent readers instead of re-fetching per waiter', async () => {
		let calls = 0;
		const fetchSpy = vi.fn(async () => {
			calls += 1;
			await new Promise(r => setTimeout(r, 20));
			throw new Error('ECONNRESET');
		});
		const cache = new HttpCache(fetchSpy as any);

		await expect(Promise.all([
			cache.readRemoteWithCache('https://x.example/doc'),
			cache.readRemoteWithCache('https://x.example/doc'),
			cache.readRemoteWithCache('https://x.example/doc')
		])).rejects.toThrow('ECONNRESET');
		expect(calls).toBe(1);
	});
});

describe('validateTheme', () => {
	it('accepts a well-formed theme with relative and absolute icons', async () => {
		await expect(validateTheme('https://themes.example.com/amazon/theme.json', VALID_THEME)).resolves.toBeUndefined();
	});

	it('rejects a document that is not valid JSON', async () => {
		await expect(validateTheme('https://x.example/theme.json', '<!DOCTYPE html>')).rejects.toThrow('not valid JSON');
	});

	it('rejects a JSON array (not an object)', async () => {
		await expect(validateTheme('https://x.example/theme.json', '[1,2,3]')).rejects.toThrow(/not a JSON object/);
	});

	it('accepts a theme without "elements" and "relationships"', async () => {
		await expect(validateTheme('https://x.example/theme.json', JSON.stringify({ logo: '' }))).resolves.toBeUndefined();
	});

	it('accepts a theme whose "elements" is not an array', async () => {
		await expect(validateTheme('https://x.example/theme.json', JSON.stringify({ elements: {}, relationships: [] }))).resolves.toBeUndefined();
	});

	it('accepts a theme regardless of whether its icons are available', async () => {
		// Icon availability is not checked: verifying it would download every icon
		// and stall on an unreachable host.
		const theme = JSON.stringify({
			elements: [{ tag: 'Amazon Web Services - EC2', icon: 'missing.png' }],
			relationships: [],
			logo: 'https://x.example/logo-missing.png'
		});
		await expect(validateTheme('https://x.example/theme.json', theme)).resolves.toBeUndefined();
	});
});

describe('HttpCache.readRemoteWithCache', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it('fetches and caches a valid remote document', async () => {
		const fetchSpy = vi.fn(fetcherFor({ 'https://x.example/doc': 'hello' }));
		const cache = new HttpCache(fetchSpy);

		await expect(cache.readRemoteWithCache('https://x.example/doc')).resolves.toBe('hello');
		await expect(cache.readRemoteWithCache('https://x.example/doc')).resolves.toBe('hello');
		expect(fetchSpy).toHaveBeenCalledTimes(1); // served from cache on 2nd call
	});

	it('caches an invalid theme and refuses to serve it during the TTL', async () => {
		const fetchSpy = vi.fn(fetcherFor({ 'https://x.example/theme.json': 'not json' }));
		const cache = new HttpCache(fetchSpy);

		await expect(cache.readRemoteWithCache('https://x.example/theme.json', validateTheme)).rejects.toThrow();
		// second call within TTL -> still rejected, still from cache (no new fetch)
		await expect(cache.readRemoteWithCache('https://x.example/theme.json', validateTheme)).rejects.toThrow();
		expect(fetchSpy).toHaveBeenCalledTimes(1);

		// TTL expired -> re-download + re-validate (still broken)
		vi.advanceTimersByTime(HTTP_CACHE_TTL + 1);
		await expect(cache.readRemoteWithCache('https://x.example/theme.json', validateTheme)).rejects.toThrow();
		expect(fetchSpy).toHaveBeenCalledTimes(2);
	});

	it('recovers a theme that becomes valid after the TTL', async () => {
		let bodies: Record<string, string> = { 'https://x.example/theme.json': 'not json' };
		const fetchSpy = vi.fn(fetcherFor(bodies));
		const cache = new HttpCache(fetchSpy);

		await expect(cache.readRemoteWithCache('https://x.example/theme.json', validateTheme)).rejects.toThrow();

		vi.advanceTimersByTime(HTTP_CACHE_TTL + 1);
		bodies['https://x.example/theme.json'] = VALID_THEME;
		await expect(cache.readRemoteWithCache('https://x.example/theme.json', validateTheme)).resolves.toBe(VALID_THEME);
		// the theme is fetched twice: invalid, then recovered after the TTL
		expect(fetchSpy.mock.calls.filter(([u]) => u === 'https://x.example/theme.json')).toHaveLength(2);
	});

	it('remembers a valid theme and does not re-fetch within the TTL', async () => {
		const fetchSpy = vi.fn(fetcherFor({ 'https://x.example/theme.json': VALID_THEME }));
		const cache = new HttpCache(fetchSpy);

		await expect(cache.readRemoteWithCache('https://x.example/theme.json', validateTheme)).resolves.toBe(VALID_THEME);
		await expect(cache.readRemoteWithCache('https://x.example/theme.json', validateTheme)).resolves.toBe(VALID_THEME);
		expect(fetchSpy.mock.calls.filter(([u]) => u === 'https://x.example/theme.json')).toHaveLength(1);
	});
});
