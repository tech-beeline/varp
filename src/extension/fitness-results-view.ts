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

import type { WebviewView, WebviewViewProvider } from 'vscode';

/** Result of one fitness check run, as far as the view needs it. */
export interface FitnessResult {
    alias: string;
    name?: string;
    branch?: string;
    docId?: number;
    response: any;
}

/** Escapes text taken from the workspace or from the checks before it goes into HTML. */
function escapeHtml(value: unknown): string {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/** One check, classified by its verdict rather than by the technical success flag. */
interface CheckRow {
    code: string;
    status: string;
    detail: string;
}

/** A check the service did not run, with the reason it reports. */
interface SkippedRow {
    code: string;
    reason: string;
}

function classify(response: any): { violated: CheckRow[]; failed: CheckRow[]; passed: CheckRow[]; skipped: SkippedRow[] } {
    const violated: CheckRow[] = [];
    const failed: CheckRow[] = [];
    const passed: CheckRow[] = [];
    for (const [code, result] of Object.entries(response?.results ?? {}) as [string, any][]) {
        const checkResult = result?.check_result;
        const counted = checkResult?.countDetail !== undefined
            ? `${checkResult.successDetail ?? 0}/${checkResult.countDetail}`
            : '';
        const row: CheckRow = { code, status: result?.status ?? '', detail: counted };
        if (result?.success === false) failed.push(row);
        else if (checkResult?.is_check === false) violated.push(row);
        else passed.push(row);
    }
    const skipped = (response?.skipped ?? [])
        .filter((entry: any) => entry?.code)
        .map((entry: any) => ({ code: entry.code, reason: entry.reason ?? '' }));
    return { violated, failed, passed, skipped };
}

/** A collapsed section: the panel shows the title with its count and opens on demand. */
function collapsible(title: string, count: number, inner: string): string {
    return `<details>
        <summary>${escapeHtml(title)} <span class="count">${count}</span></summary>
        ${inner}
    </details>`;
}

function section(title: string, kind: string, rows: CheckRow[]): string {
    if (rows.length === 0) return '';
    const items = rows.map(row => `<li class="${kind}">
            <span class="code">${escapeHtml(row.code)}</span>
            ${row.status ? `<span class="badge">${escapeHtml(row.status)}</span>` : ''}
            ${row.detail ? `<span class="detail">${escapeHtml(row.detail)}</span>` : ''}
        </li>`).join('\n');
    return collapsible(title, rows.length, `<ul>
${items}
    </ul>`);
}

/**
 * Renders the check results as a standalone HTML document. Without a result the view
 * explains that nothing has run yet; a workspace without the product alias is never
 * checked, so it stays in that state.
 */
export function renderFitnessResults(result: FitnessResult | undefined): string {
    const style = `
        body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); padding: 8px 12px; }
        header { display: flex; flex-wrap: wrap; gap: 4px 12px; align-items: baseline; border-bottom: 1px solid var(--vscode-panel-border); padding-bottom: 8px; }
        .alias { font-weight: 600; }
        .muted, .detail { color: var(--vscode-descriptionForeground); }
        summary { cursor: pointer; font-size: 1em; text-transform: uppercase; letter-spacing: .04em; margin: 16px 0 6px; }
        .count { color: var(--vscode-descriptionForeground); font-weight: 400; }
        ul { list-style: none; margin: 0; padding: 0; }
        li { padding: 6px 0 6px 10px; border-left: 3px solid transparent; margin-bottom: 2px; }
        li.violated { border-left-color: var(--vscode-editorError-foreground); }
        li.failed { border-left-color: var(--vscode-editorWarning-foreground); }
        li.passed { border-left-color: var(--vscode-charts-green, var(--vscode-testing-iconPassed)); }
        .code { font-family: var(--vscode-editor-font-family); font-weight: 600; }
        .badge { margin-left: 8px; font-size: .85em; color: var(--vscode-descriptionForeground); }
        .detail { margin-left: 8px; font-size: .9em; }
        .message { margin: 4px 0 0; white-space: pre-wrap; }
        .empty { color: var(--vscode-descriptionForeground); }
    `;
    const head = `<meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';">
    <style>${style}</style>`;

    if (!result) {
        return `<!DOCTYPE html><html lang="en"><head>${head}</head>
<body><p class="empty">No fitness checks have run for this workspace yet.</p></body></html>`;
    }

    const { violated, failed, passed, skipped } = classify(result.response);
    const counts = `passed ${passed.length} &middot; violated ${violated.length} &middot; failed ${failed.length} &middot; skipped ${skipped.length}`;
    const meta = [result.name, result.branch ? `branch ${result.branch}` : '', result.docId ? `doc ${result.docId}` : '']
        .filter(Boolean).map(escapeHtml).join(' &middot; ');
    const skippedSection = skipped.length > 0
        ? collapsible('Skipped', skipped.length, `<ul>${skipped
            .map(row => `<li><span class="code">${escapeHtml(row.code)}</span>${
                row.reason ? `<p class="message">${escapeHtml(row.reason)}</p>` : ''}</li>`).join('')}</ul>`)
        : '';

    return `<!DOCTYPE html><html lang="en"><head>${head}</head>
<body>
    <header>
        <span class="alias">${escapeHtml(result.alias)}</span>
        <span class="muted">${meta}</span>
        <span class="muted">${counts}</span>
    </header>
    ${section('Passed', 'passed', passed)}
    ${section('Violated', 'violated', violated)}
    ${section('Failed to run', 'failed', failed)}
    ${skippedSection}
</body></html>`;
}

/** Hosts the results in the panel view next to the built-in ones. */
export class FitnessResultsView implements WebviewViewProvider {
    public static readonly viewType = 'fitness-results';

    private view: WebviewView | undefined;
    private result: FitnessResult | undefined;

    public resolveWebviewView(view: WebviewView): void {
        this.view = view;
        view.webview.options = { enableScripts: false };
        this.render();
    }

    /** Shows the newest result. The panel view is only rendered while it is visible. */
    public update(result: FitnessResult): void {
        this.result = result;
        this.render();
    }

    private render(): void {
        if (this.view) {
            this.view.webview.html = renderFitnessResults(this.result);
        }
    }
}
