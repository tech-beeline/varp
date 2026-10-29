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
import { applyDrawioLayout, applyDrawioLayoutToView } from './c4-drawio-layout';

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
	it('applies element positions and relationship vertices verbatim', () => {
		const view: any = {
			elements: [{ id: 'A', x: 0, y: 0 }, { id: 'B', x: 0, y: 0 }],
			relationships: [{ id: 'R', order: '1' }]
		};

		applyDrawioLayout(view, MX);

		expect(view.elements[0]).toMatchObject({ id: 'A', x: 100, y: 200, width: 400, height: 300 });
		expect(view.elements[1]).toMatchObject({ id: 'B', x: 600, y: 250, width: 400, height: 300 });
		expect(view.relationships[0].vertices).toEqual([{ x: 300, y: 400 }, { x: 500, y: 450 }]);
		// The page is sized later by fitViewToContent, not by the reader.
		expect(view.dimensions).toBeUndefined();
	});

	it('leaves skipped (cluster) elements untouched', () => {
		const view: any = {
			elements: [{ id: 'A', x: 0, y: 0 }, { id: 'D', x: 0, y: 0 }],
			relationships: []
		};

		applyDrawioLayout(view, MX, { skipElementIds: new Set(['D']) });

		expect(view.elements[0]).toMatchObject({ id: 'A', x: 100, y: 200 });
		// The cluster keeps its own position: it is positioned from its children.
		expect(view.elements[1]).toMatchObject({ id: 'D', x: 0, y: 0 });
	});

	it('does nothing when no element geometry matches', () => {
		const view: any = { elements: [{ id: 'X', x: 7, y: 9 }], relationships: [] };
		applyDrawioLayout(view, MX);
		expect(view.elements[0]).toMatchObject({ x: 7, y: 9 });
	});

	it('applies a layout to a view inside a workspace JSON and skips deployment nodes', () => {
		const json = {
			model: {
				deploymentNodes: [{ id: '10', children: [{ id: '11' }] }]
			},
			views: {
				deploymentViews: [{
					key: 'deployment',
					elements: [{ id: '1', x: 0, y: 0 }, { id: '10', x: 0, y: 0 }, { id: '11', x: 0, y: 0 }],
					relationships: []
				}]
			}
		};
		const mx = `<?xml version="1.0" encoding="UTF-8"?>
<mxfile><diagram>
  <mxGraphModel pageWidth="1000" pageHeight="800"><root>
    <object id="1"><mxCell vertex="1"><mxGeometry x="50" y="60" width="400" height="300" as="geometry"/></mxCell></object>
    <object id="10"><mxCell vertex="1"><mxGeometry x="900" y="900" width="200" height="200" as="geometry"/></mxCell></object>
    <object id="11"><mxCell vertex="1"><mxGeometry x="950" y="950" width="200" height="200" as="geometry"/></mxCell></object>
  </root></mxGraphModel>
</diagram></mxfile>`;

		const view = applyDrawioLayoutToView(json, 'deployment', mx);

		expect(view).toBeDefined();
		expect(view.elements[0]).toMatchObject({ id: '1', x: 50, y: 60 });
		// Deployment nodes are clusters: their geometry in the file is ignored.
		expect(view.elements[1]).toMatchObject({ id: '10', x: 0, y: 0 });
		expect(view.elements[2]).toMatchObject({ id: '11', x: 0, y: 0 });
		expect(applyDrawioLayoutToView(json, 'missing', mx)).toBeUndefined();
	});

	it('applies negative coordinates as-is', () => {
		const mx = `<?xml version="1.0" encoding="UTF-8"?>
<mxfile><diagram>
  <mxGraphModel pageWidth="800" pageHeight="600"><root>
    <object id="A"><mxCell vertex="1"><mxGeometry x="-300" y="-100" width="400" height="300" as="geometry"/></mxCell></object>
  </root></mxGraphModel>
</diagram></mxfile>`;
		const view: any = { elements: [{ id: 'A', x: 0, y: 0 }], relationships: [] };

		applyDrawioLayout(view, mx);

		expect(view.elements[0]).toMatchObject({ id: 'A', x: -300, y: -100, width: 400, height: 300 });
	});
});
