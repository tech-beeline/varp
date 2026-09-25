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

import { describe, expect, it } from 'vitest';
import { applyDrawioLayout } from './c4-drawio-layout';

const MX = `<?xml version="1.0" encoding="UTF-8"?>
<mxfile host="app.diagrams.net">
  <diagram name="V" id="V">
    <mxGraphModel dx="0" dy="0" grid="1" gridSize="10" pageWidth="1600" pageHeight="1200">
      <root>
        <mxCell id="0"/>
        <mxCell id="1" parent="0"/>
        <object c4Name="A" id="A">
          <mxCell style="rounded=1;" parent="1" vertex="1">
            <mxGeometry x="100" y="200" width="400" height="300" as="geometry"/>
          </mxCell>
        </object>
        <object c4Name="B" id="B">
          <mxCell style="rounded=1;" parent="1" vertex="1">
            <mxGeometry x="600" y="250" width="400" height="300" as="geometry"/>
          </mxCell>
        </object>
        <object c4Type="Relationship" id="R-1">
          <mxCell edge="1" parent="1" source="A" target="B">
            <mxGeometry relative="1" as="geometry">
              <Array as="points">
                <mxPoint x="300" y="400"/>
                <mxPoint x="500" y="450"/>
              </Array>
            </mxGeometry>
          </mxCell>
        </object>
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>`;

describe('applyDrawioLayout', () => {
	it('applies element positions and relationship vertices, then centres everything', () => {
		const view: any = {
			elements: [{ id: 'A', x: 0, y: 0 }, { id: 'B', x: 0, y: 0 }],
			relationships: [{ id: 'R', order: '1' }]
		};

		applyDrawioLayout(view, MX);

		// Bounds: (100,200)-(1000,550); page 1400x950; delta (250,300).
		expect(view.elements[0]).toMatchObject({ id: 'A', x: 250, y: 300 });
		expect(view.elements[1]).toMatchObject({ id: 'B', x: 750, y: 350 });
		expect(view.relationships[0].vertices).toEqual([{ x: 450, y: 500 }, { x: 650, y: 550 }]);
		expect(view.dimensions).toEqual({ width: 1400, height: 950 });
		expect(view.paperSize).toBe('A6_Landscape');
	});

	it('leaves skipped (cluster) elements out of the bounds but shifts them with the rest', () => {
		const view: any = {
			elements: [{ id: 'A', x: 0, y: 0 }, { id: 'D', x: 0, y: 0 }],
			relationships: []
		};

		applyDrawioLayout(view, MX, { skipElementIds: new Set(['D']) });

		expect(view.elements[0]).toMatchObject({ id: 'A', x: 250, y: 300 });
		// The cluster keeps its own position, only moved by the centring shift.
		expect(view.elements[1]).toMatchObject({ id: 'D', x: 150, y: 100 });
	});

	it('does nothing when no element geometry matches', () => {
		const view: any = { elements: [{ id: 'X', x: 7, y: 9 }], relationships: [] };
		applyDrawioLayout(view, MX);
		expect(view.elements[0]).toMatchObject({ x: 7, y: 9 });
		expect(view.dimensions).toBeUndefined();
	});
});
