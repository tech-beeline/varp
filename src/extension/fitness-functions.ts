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

import { window, workspace } from 'vscode';
import { generateHmac } from './hmac';
import type { C4LanguageClient } from './init';
import type { FitnessResult, FitnessResultsView } from './fitness-results-view';

/** Path of the ff-manager method on the gateway. */
const RUN_ALL_WORKSPACE_PATH = '/ff/api/v1/run-all-workspace';

/** Model property holding the product alias the checks run against. */
const CMDB_PROPERTY = 'workspace_cmdb';

/** Branch reported to the checks; the method defaults to `main` as well. */
const BRANCH = 'main';

/**
 * Checks run sequentially and the answer arrives after the last one, so the request
 * needs a timeout far above the default. The gateway must allow the same.
 */
const REQUEST_TIMEOUT_MS = 300000;

/** Product alias the checks run against, or undefined when the model has none. */
export function fitnessAlias(json: any): string | undefined {
    const value = json?.model?.properties?.[CMDB_PROPERTY];
    if (typeof value !== 'string') {
        return undefined;
    }
    const alias = value.trim();
    return alias.length > 0 ? alias : undefined;
}

/** Whether the workspace is configured for the checks: an alias and both credentials. */
function fitnessTarget(json: any): { path: string; url: string } | undefined {
    const alias = fitnessAlias(json);
    if (!alias) {
        return undefined;
    }
    const configuration = workspace.getConfiguration();
    if (!configuration.get<string>('archops.api.key') || !configuration.get<string>('archops.api.secret')) {
        return undefined;
    }
    const apiUrl = configuration.get<string>('archops.api.url');
    if (!apiUrl) {
        return undefined;
    }
    const query = `?app=${encodeURIComponent(alias)}&branch=${BRANCH}`;
    return { path: RUN_ALL_WORKSPACE_PATH, url: `${apiUrl.replace(/\/+$/, '')}${RUN_ALL_WORKSPACE_PATH}${query}` };
}

/** Counts the outcome of every started check by its verdict, not by technical success. */
export function summarize(response: any): string {
    const results = Object.entries(response?.results ?? {}) as [string, any][];
    const passed: string[] = [];
    const violated: string[] = [];
    const failed: string[] = [];
    for (const [code, result] of results) {
        if (result?.success === false) failed.push(code);
        else if (result?.check_result?.is_check === false) violated.push(code);
        else passed.push(code);
    }
    const skipped = (response?.skipped ?? []).map((entry: any) => entry?.code).filter(Boolean);
    return `passed ${passed.length}, violated ${violated.length}${violated.length > 0 ? ` (${violated.join(', ')})` : ''}, `
        + `failed ${failed.length}${failed.length > 0 ? ` (${failed.join(', ')})` : ''}, skipped ${skipped.length}`;
}

/**
 * Runs the fitness checks for a workspace JSON through the gateway. The method keeps
 * nothing, so the call is free of side effects for the product. Returns the result to
 * show, or undefined when the workspace is not configured for the checks - a workspace
 * without the `workspace_cmdb` property is skipped silently. The caller's `signal`
 * cancels the request when a newer workspace replaces it.
 */
export async function runFitnessChecks(json: any, signal?: AbortSignal): Promise<FitnessResult | undefined> {
    const target = fitnessTarget(json);
    if (!target) {
        return undefined;
    }
    const body = JSON.stringify(json);
    const headers: Record<string, string> = {
        ...generateHmac('POST', target.path, body, 'application/json'),
        'Content-Type': 'application/json'
    };
    const response = await fetch(target.url, {
        method: 'POST',
        headers,
        body,
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]) : AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
    const text = await response.text();
    if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`);
    }
    const parsed = JSON.parse(text);
    return {
        alias: fitnessAlias(json)!,
        name: typeof json?.name === 'string' ? json.name : undefined,
        branch: typeof parsed?.branch === 'string' ? parsed.branch : BRANCH,
        docId: typeof parsed?.docId === 'number' ? parsed.docId : undefined,
        response: parsed
    };
}

/**
 * The single runner of the checks: one request at a time, and a new generation cancels
 * the request still in flight. A check takes seconds while a workspace can change at
 * every keystroke, so the newest document always wins and no older result reaches the
 * view. Cancelled requests are expected and stay silent; only real failures are logged.
 */
export class FitnessChecks {
    private controller: AbortController | undefined;
    private sequence = 0;

    constructor(
        private readonly load: (uri: string) => Promise<any>,
        private readonly onResult: (result: FitnessResult) => void
    ) {}

    /** Starts the checks for a workspace, cancelling whatever is still running. */
    public start(uri: string): void {
        this.controller?.abort();
        const controller = new AbortController();
        this.controller = controller;
        void this.execute(uri, controller, ++this.sequence);
    }

    private async execute(uri: string, controller: AbortController, sequence: number): Promise<void> {
        try {
            const json = await this.load(uri);
            if (!json || controller.signal.aborted) return;
            const result = await runFitnessChecks(json, controller.signal);
            if (!result || controller.signal.aborted || sequence !== this.sequence) return;
            console.log(`[C4 Fitness] ${uri}: ${summarize(result.response)}`);
            this.onResult(result);
        } catch (error) {
            if (controller.signal.aborted) return;
            console.warn(`[C4 Fitness] ${uri}: check failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
}

/**
 * Runs the checks when a DSL file is saved, not on every generation: a save is the point
 * where the workspace is considered final, while typing produces a new JSON at every
 * keystroke. A saved fragment belongs to the root document it is included from, so the
 * checks run against that root's JSON. The document the user is looking at is checked
 * once the project opens, so the panel is not empty until the first save.
 */
export function registerFitnessChecks(client: C4LanguageClient, view: FitnessResultsView): void {
    const checks = new FitnessChecks(
        async (uri: string) => {
            const res: any = await client.sendRequest('c4/getFullContentForUri', { uri });
            return res?.json;
        },
        result => view.update(result)
    );

    const runFor = async (uri: string): Promise<void> => {
        try {
            const res: any = await client.sendRequest('c4/getRootUri', { uri });
            if (res?.rootUri) {
                checks.start(res.rootUri);
            }
        } catch (error) {
            console.warn(`[C4 Fitness] root lookup failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    };

    const isDsl = (uri: { path: string }): boolean => uri.path.toLowerCase().endsWith('.dsl');

    workspace.onDidSaveTextDocument(document => {
        if (isDsl(document.uri)) {
            void runFor(document.uri.toString());
        }
    });

    const active = window.activeTextEditor?.document.uri;
    if (active && isDsl(active)) {
        void runFor(active.toString());
    }
}
