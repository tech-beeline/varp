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

import { DOMParser } from '@xmldom/xmldom';

export interface DrawioLayoutOptions {
	/** Element ids whose position is derived from their children (e.g. deployment nodes). */
	skipElementIds?: Set<string>;
}

/**
 * Applies element positions and sizes plus relationship vertices from a drawio diagram
 * to a view.
 *
 * The drawio file is expected to come from the diagram export: elements are `object`
 * elements with id = element id and a nested `mxGeometry`, relationships are `object`
 * elements with id = "<relationship id>-<order>" and `<Array as="points">` vertices.
 * Deployment nodes are clusters whose position is derived from their children, so the
 * caller passes their ids in `skipElementIds`.
 *
 * Only coordinates and sizes are applied. The page (dimensions and paper size) is left
 * to {@link fitViewToContent}, which sizes it exactly like the graphviz auto-layout.
 */
export function applyDrawioLayout(view: any, mx: string, options: DrawioLayoutOptions = {}): void {
	const skipElementIds = options.skipElementIds ?? new Set<string>();

	const geometries = new Map<string, { x: number; y: number; width: number; height: number }>();
	const vertices = new Map<string, { x: number; y: number }[]>();

	const document = new DOMParser().parseFromString(mx, 'text/xml');
	const objects = document.getElementsByTagName('object');
	for (let i = 0; i < objects.length; i++) {
		const object = objects.item(i);
		if (!object) continue;
		const id = object.getAttribute('id');
		if (!id) continue;

		const geometry = object.getElementsByTagName('mxGeometry').item(0);
		if (!geometry) continue;
		geometries.set(id, {
			x: attribute(geometry, 'x'),
			y: attribute(geometry, 'y'),
			width: attribute(geometry, 'width'),
			height: attribute(geometry, 'height')
		});

		const points = waypoints(geometry);
		if (points.length > 0) vertices.set(id, points);
	}

	for (const elementView of view.elements ?? []) {
		if (skipElementIds.has(elementView.id)) continue;
		const geometry = geometries.get(elementView.id);
		if (!geometry) continue;
		elementView.x = Math.trunc(geometry.x);
		elementView.y = Math.trunc(geometry.y);
		elementView.width = Math.round(geometry.width);
		elementView.height = Math.round(geometry.height);
	}

	for (const relationshipView of view.relationships ?? []) {
		const points = vertices.get(`${relationshipView.id}-${relationshipView.order ?? '0'}`);
		if (!points) continue;
		relationshipView.vertices = points.map((point) => ({ ...point }));
	}
}

/** Waypoints of a relationship geometry, i.e. the `<mxPoint>` children of its `<Array>`. */
function waypoints(geometry: any): { x: number; y: number }[] {
	const points = geometry.getElementsByTagName('mxPoint');
	const list: { x: number; y: number }[] = [];
	for (let i = 0; i < points.length; i++) {
		const point = points.item(i);
		if (point?.parentNode?.nodeName !== 'Array') continue;
		list.push({ x: Math.trunc(attribute(point, 'x')), y: Math.trunc(attribute(point, 'y')) });
	}
	return list;
}

function attribute(node: any, name: string): number {
	const value = Number.parseFloat(node?.getAttribute(name) ?? '');
	return Number.isFinite(value) ? value : 0;
}

/** View collections of a workspace JSON, as used by the generator. */
const VIEW_COLLECTIONS = [
	'systemLandscapeViews', 'systemContextViews', 'containerViews', 'componentViews',
	'deploymentViews', 'dynamicViews', 'customViews', 'filteredViews', 'imageViews'
];

/**
 * Applies a drawio file's layout to the view with the given key in a workspace JSON,
 * and returns that view. Deployment nodes are clusters whose position comes from their
 * children, so their ids are passed to {@link applyDrawioLayout} to be skipped. Returns
 * undefined when the view is not found.
 */
export function applyDrawioLayoutToView(json: any, viewKey: string, mx: string): any | undefined {
	const view = findViewByKey(json, viewKey);
	if (!view) return undefined;
	applyDrawioLayout(view, mx, { skipElementIds: deploymentNodeIds(json?.model) });
	return view;
}

function findViewByKey(json: any, viewKey: string): any | undefined {
	for (const collection of VIEW_COLLECTIONS) {
		const list = json?.views?.[collection];
		if (!Array.isArray(list)) continue;
		const view = list.find((candidate: any) => candidate && candidate.key === viewKey);
		if (view) return view;
	}
	return undefined;
}

/** Ids of all deployment nodes in a workspace model (they are positioned from children). */
function deploymentNodeIds(model: any): Set<string> {
	const ids = new Set<string>();
	const visit = (node: any): void => {
		if (!node || typeof node !== 'object') return;
		if (node.id !== undefined) ids.add(String(node.id));
		for (const child of node.children ?? []) visit(child);
	};
	for (const node of model?.deploymentNodes ?? []) visit(node);
	return ids;
}
