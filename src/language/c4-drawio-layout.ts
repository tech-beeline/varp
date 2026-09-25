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

/** Paper sizes in pixels at 300dpi, in the order the reference declares them. */
const PAPER_SIZES: { name: string; orientation: 'Portrait' | 'Landscape'; width: number; height: number }[] = [
	{ name: 'A6_Portrait', orientation: 'Portrait', width: 1240, height: 1748 },
	{ name: 'A6_Landscape', orientation: 'Landscape', width: 1748, height: 1240 },
	{ name: 'A5_Portrait', orientation: 'Portrait', width: 1748, height: 2480 },
	{ name: 'A5_Landscape', orientation: 'Landscape', width: 2480, height: 1748 },
	{ name: 'A4_Portrait', orientation: 'Portrait', width: 2480, height: 3508 },
	{ name: 'A4_Landscape', orientation: 'Landscape', width: 3508, height: 2480 },
	{ name: 'A3_Portrait', orientation: 'Portrait', width: 3508, height: 4961 },
	{ name: 'A3_Landscape', orientation: 'Landscape', width: 4961, height: 3508 },
	{ name: 'A2_Portrait', orientation: 'Portrait', width: 4961, height: 7016 },
	{ name: 'A2_Landscape', orientation: 'Landscape', width: 7016, height: 4961 },
	{ name: 'A1_Portrait', orientation: 'Portrait', width: 7016, height: 9933 },
	{ name: 'A1_Landscape', orientation: 'Landscape', width: 9933, height: 7016 },
	{ name: 'A0_Portrait', orientation: 'Portrait', width: 9933, height: 14043 },
	{ name: 'A0_Landscape', orientation: 'Landscape', width: 14043, height: 9933 },
	{ name: 'Letter_Portrait', orientation: 'Portrait', width: 2550, height: 3300 },
	{ name: 'Letter_Landscape', orientation: 'Landscape', width: 3300, height: 2550 },
	{ name: 'Legal_Portrait', orientation: 'Portrait', width: 2550, height: 4200 },
	{ name: 'Legal_Landscape', orientation: 'Landscape', width: 4200, height: 2550 },
	{ name: 'Slide_4_3', orientation: 'Landscape', width: 3306, height: 2480 },
	{ name: 'Slide_16_9', orientation: 'Landscape', width: 3508, height: 1973 },
	{ name: 'Slide_16_10', orientation: 'Landscape', width: 3508, height: 2193 }
];

export interface DrawioLayoutOptions {
	/** Empty border kept around the diagram (pixels). */
	margin?: number;
	/** Update the view dimensions and paper size from the imported bounds. */
	changePaperSize?: boolean;
	/** Element ids whose position is derived from their children (e.g. deployment nodes). */
	skipElementIds?: Set<string>;
}

interface Geometry {
	x: number;
	y: number;
	width: number;
	height: number;
}

/**
 * Applies element positions and relationship vertices from a drawio diagram to a view.
 *
 * The drawio file is expected to come from the diagram export: elements are `object`
 * elements with id = element id and a nested `mxGeometry`, relationships are `object`
 * elements with id = "<relationship id>-<order>" and `mxPoint` vertices. Deployment
 * nodes are clusters whose position is derived from their children, so the caller
 * passes their ids in `skipElementIds`. Everything is moved relative to (0,0) and then
 * centred in the computed page.
 */
export function applyDrawioLayout(view: any, mx: string, options: DrawioLayoutOptions = {}): void {
	const margin = options.margin ?? 400;
	const changePaperSize = options.changePaperSize ?? true;
	const skipElementIds = options.skipElementIds ?? new Set<string>();

	const geometries = new Map<string, Geometry>();
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

		const points = geometry.getElementsByTagName('mxPoint');
		if (points.length > 0) {
			const list: { x: number; y: number }[] = [];
			for (let p = 0; p < points.length; p++) {
				const point = points.item(p);
				list.push({ x: Math.trunc(attribute(point, 'x')), y: Math.trunc(attribute(point, 'y')) });
			}
			vertices.set(id, list);
		}
	}

	let minimumX = Number.POSITIVE_INFINITY;
	let minimumY = Number.POSITIVE_INFINITY;
	let maximumX = Number.NEGATIVE_INFINITY;
	let maximumY = Number.NEGATIVE_INFINITY;

	for (const elementView of view.elements ?? []) {
		if (skipElementIds.has(elementView.id)) continue;
		const geometry = geometries.get(elementView.id);
		if (!geometry) continue;

		elementView.x = Math.trunc(geometry.x);
		elementView.y = Math.trunc(geometry.y);
		minimumX = Math.min(elementView.x, minimumX);
		minimumY = Math.min(elementView.y, minimumY);
		maximumX = Math.max(elementView.x + geometry.width, maximumX);
		maximumY = Math.max(elementView.y + geometry.height, maximumY);
	}

	for (const relationshipView of view.relationships ?? []) {
		const points = vertices.get(`${relationshipView.id}-${relationshipView.order ?? '0'}`);
		if (!points) continue;
		relationshipView.vertices = points.map((point) => ({ ...point }));
	}

	if (!Number.isFinite(minimumX)) return;

	const pageWidth = Math.max(margin, maximumX + margin);
	const pageHeight = Math.max(margin, maximumY + margin);

	if (changePaperSize) {
		view.dimensions = { width: pageWidth, height: pageHeight };
		const paperSize = selectPaperSize(pageWidth, pageHeight);
		if (paperSize) view.paperSize = paperSize;
	}

	const deltaX = Math.trunc((pageWidth - maximumX + minimumX) / 2);
	const deltaY = Math.trunc((pageHeight - maximumY + minimumY) / 2);

	for (const elementView of view.elements ?? []) {
		elementView.x -= minimumX;
		elementView.y -= minimumY;
	}
	for (const relationshipView of view.relationships ?? []) {
		for (const vertex of relationshipView.vertices ?? []) {
			vertex.x -= minimumX;
			vertex.y -= minimumY;
		}
	}
	for (const elementView of view.elements ?? []) {
		elementView.x += deltaX;
		elementView.y += deltaY;
	}
	for (const relationshipView of view.relationships ?? []) {
		for (const vertex of relationshipView.vertices ?? []) {
			vertex.x += deltaX;
			vertex.y += deltaY;
		}
	}
}

/** The first paper size (in declaration order) that fits the page, or undefined. */
function selectPaperSize(width: number, height: number): string | undefined {
	const orientation = width > height ? 'Landscape' : 'Portrait';
	for (const size of PAPER_SIZES) {
		if (size.orientation === orientation && size.width > width && size.height > height) {
			return size.name;
		}
	}
	return undefined;
}

function attribute(node: any, name: string): number {
	const value = Number.parseFloat(node?.getAttribute(name) ?? '');
	return Number.isFinite(value) ? value : 0;
}
