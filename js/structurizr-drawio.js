/**
 * Экспорт Structurizr диаграммы в формат DrawIO (.drawio / .mxfile)
 * Выполняется в webview (браузер), после того как JointJS выполнил layout
 * и координаты элементов записаны в view.elements
 *
 * Аналог MxExporter.java
 */

structurizr.drawio = {};

structurizr.drawio._isDarkMode = function() {
    if (typeof structurizr.ui !== 'undefined' && typeof structurizr.ui.isDarkMode === 'function') {
        return structurizr.ui.isDarkMode();
    }
    return false;
};

structurizr.drawio._escapeXml = function(text) {
    if (text === undefined || text === null) return '';
    var amp = '&' + 'amp;';
    var lt = '&' + 'lt;';
    var gt = '&' + 'gt;';
    var quot = '&' + 'quot;';
    var apos = '&' + '#39;';
    return String(text)
        .replace(/&/g, amp)
        .replace(/</g, lt)
        .replace(/>/g, gt)
        .replace(/"/g, quot)
        .replace(/'/g, apos);
};

structurizr.drawio._uuid = function() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        var r = Math.random() * 16 | 0;
        var v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
};

structurizr.drawio._fontHeight = function(fontName, fontSize) {
    return Math.round(fontSize * 1.2);
};

structurizr.drawio._hasColor = function(color) {
    return color && color !== '' && color !== 'none' && color !== '#00000000' && color !== '#ffffff00';
};

structurizr.drawio.exportCurrent = function(workspace, viewKey, callback) {
    var darkMode = structurizr.drawio._isDarkMode();
    var view = workspace.findViewByKey(viewKey);
    if (!view) { callback(null, 'View not found: ' + viewKey); return; }
    if (view.type === 'Filtered') { callback(null, 'Filtered views are not supported for export'); return; }
    structurizr.drawio.exportView(view, workspace, darkMode, function(xml) {
        if (xml) { callback({ key: view.key, name: structurizr.ui.getTitleForView ? structurizr.ui.getTitleForView(view) : view.key, xml: xml }); }
        else { callback(null, 'Failed to generate XML'); }
    });
};

structurizr.drawio.exportView = function(view, workspace, darkMode, callback) {
    if (typeof darkMode === 'function') { callback = darkMode; darkMode = structurizr.drawio._isDarkMode(); }
    var needsLayout = false;
    if (view.elements) {
        for (var i = 0; i < view.elements.length; i++) {
            if (view.elements[i].x === undefined || view.elements[i].x === 0) { needsLayout = true; break; }
        }
    }
    if (needsLayout && structurizr.diagram) {
        structurizr.diagram.changeView(view.key, function() {
            callback(structurizr.drawio._generateXml(view, workspace, darkMode));
        });
    } else {
        callback(structurizr.drawio._generateXml(view, workspace, darkMode));
    }
};

structurizr.drawio._generateXml = function(view, workspace, darkMode) {
    var lines = [];
    var diagramName = structurizr.ui.getTitleForView ? structurizr.ui.getTitleForView(view) : view.key;
    var pageWidth = view.dimensions ? view.dimensions.width : 2000;
    var pageHeight = view.dimensions ? view.dimensions.height : 2000;
    var rootId = structurizr.drawio._uuid();
    var parentId = structurizr.drawio._uuid();

    lines.push('<mxfile host="Electron" agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) draw.io/28.0.6 Chrome/138.0.7204.100 Electron/37.2.3 Safari/537.36" version="28.0.6">');
    lines.push('  <diagram name="' + structurizr.drawio._escapeXml(diagramName) + '" id="' + view.key + '">');
    lines.push('    <mxGraphModel dx="0" dy="0" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="' + pageWidth + '" pageHeight="' + pageHeight + '" math="0" shadow="0">');
    lines.push('      <root>');
    lines.push('        <mxCell id="' + rootId + '"/>');
    lines.push('        <mxCell id="' + parentId + '" parent="' + rootId + '"/>');

    var boundaries = structurizr.drawio._collectBoundaries(view, workspace, darkMode);

    if (view.elements) {
        for (var i = 0; i < view.elements.length; i++) {
            var ev = view.elements[i];
            var el = workspace.findElementById(ev.id);
            if (!el || el.type === 'DeploymentNode') continue;
            structurizr.drawio._writeElement(lines, el, ev, view, workspace, parentId, darkMode);
        }
    }

    if (view.relationships) {
        for (var i = 0; i < view.relationships.length; i++) {
            structurizr.drawio._writeRelationship(lines, view.relationships[i], view, workspace, parentId, darkMode);
        }
    }

    for (var i = 0; i < boundaries.length; i++) {
        structurizr.drawio._writeBoundary(lines, boundaries[i], parentId);
    }

    lines.push('      </root>');
    lines.push('    </mxGraphModel>');
    lines.push('  </diagram>');
    lines.push('</mxfile>');
    return lines.join('\n');
};

// ========== ЭЛЕМЕНТЫ ==========

structurizr.drawio._writeElement = function(lines, element, elementView, view, workspace, parentId, darkMode) {
    var es = structurizr.ui.findElementStyle(element, darkMode);
    var x = elementView.x || 0;
    var y = elementView.y || 0;
    var name = element.name || '';
    var description = element.description || '';
    var color = es.color || '#444444';
    var stroke = es.stroke || (!darkMode ? '#444444' : '#cccccc');
    var background = es.background || (!darkMode ? '#ffffff' : '#111111');
    var nameFontSize = (es.fontSize || 24) + 10;
    var metadataFontSize = (es.fontSize || 24) - 5;
    var descFontSize = es.fontSize || 24;
    var shape = es.shape || 'Box';
    var width = es.width || 450;
    var height = es.height || 300;
    var sw = es.strokeWidth || 2;
    var id = element.id;

    if (shape === 'Hexagon') { height = Math.round(0.89 * width); }

    var real = element;
    if (element.type === 'SoftwareSystemInstance') { var ss = workspace.findElementById(element.softwareSystemId); real = ss || element; }
    else if (element.type === 'ContainerInstance') { var c = workspace.findElementById(element.containerId); real = c || element; }

    var tech = real.technology || element.technology || '';
    var terminology = structurizr.workspace.getTerminologyFor(element);
    var c4Type = terminology || element.type;

    var props = '';
    var apos = '&' + '#39;';
    if (element.properties) {
        var p = [];
        for (var k in element.properties) {
            if (element.properties.hasOwnProperty(k)) { p.push(k + "='" + (element.properties[k] || '').replace(/'/g, apos) + "'"); }
        }
        props = p.join(' ');
    }

    var label = '<font style="font-size:' + nameFontSize + 'px"><b>' + structurizr.drawio._escapeXml(name) + '</b></font>';
    if (tech) { label += '<div>[' + structurizr.drawio._escapeXml(c4Type) + ': ' + structurizr.drawio._escapeXml(tech) + ']</div>'; }
    else { label += '<div>[' + structurizr.drawio._escapeXml(c4Type) + ']</div>'; }
    if (description) { label += '<br><div><font style="font-size:' + descFontSize + 'px" color="' + color + '">' + structurizr.drawio._escapeXml(description) + '</font></div>'; }

    var c4Name = structurizr.drawio._escapeXml(name);
    var c4Desc = structurizr.drawio._escapeXml(description);
    var c4Tech = structurizr.drawio._escapeXml(tech);
    var c4TypeEsc = structurizr.drawio._escapeXml(c4Type);
    var labelEsc = structurizr.drawio._escapeXml(label);

    var cellStyle = 'whiteSpace=wrap;html=1;fontSize=' + metadataFontSize + ';labelBackgroundColor=none;fillColor=' + background + ';fontColor=' + color + ';align=center;arcSize=10;strokeColor=' + stroke + ';metaEdit=1;resizable=0;points=[[0.25,0,0],[0.5,0,0],[0.75,0,0],[1,0.25,0],[1,0.5,0],[1,0.75,0],[0.75,1,0],[0.5,1,0],[0.25,1,0],[0,0.75,0],[0,0.5,0],[0,0.25,0]];';

    if (shape === 'Person') {
        lines.push('        <object placeholders="1" c4Name="' + c4Name + '" c4Type="Person" c4Description="' + c4Desc + '" label="' + labelEsc + '" id="' + id + '" ' + props + '>');
        lines.push('          <mxCell style="shape=mxgraph.c4.person2;rounded=0;' + cellStyle + '" vertex="1" parent="' + parentId + '">');
        lines.push('            <mxGeometry x="' + x + '" y="' + y + '" width="' + width + '" height="' + height + '" as="geometry"/>');
        lines.push('          </mxCell>');
        lines.push('        </object>');
    } else if (shape === 'Hexagon') {
        lines.push('        <object placeholders="1" c4Name="' + c4Name + '" c4Type="' + c4TypeEsc + '" c4Technology="' + c4Tech + '" c4Description="' + c4Desc + '" label="' + labelEsc + '" id="' + id + '" ' + props + '>');
        lines.push('          <mxCell style="shape=hexagon;size=120;perimeter=hexagonPerimeter2;fixedSize=1;rounded=1;' + cellStyle + '" vertex="1" parent="' + parentId + '">');
        lines.push('            <mxGeometry x="' + x + '" y="' + y + '" width="' + width + '" height="' + height + '" as="geometry"/>');
        lines.push('          </mxCell>');
        lines.push('        </object>');
    } else if (shape === 'Cylinder') {
        lines.push('        <object placeholders="1" c4Name="' + c4Name + '" c4Type="' + c4TypeEsc + '" c4Technology="' + c4Tech + '" c4Description="' + c4Desc + '" label="' + labelEsc + '" id="' + id + '" ' + props + '>');
        lines.push('          <mxCell style="shape=cylinder3;size=15;boundedLbl=1;rounded=0;' + cellStyle + '" vertex="1" parent="' + parentId + '">');
        lines.push('            <mxGeometry x="' + x + '" y="' + y + '" width="' + width + '" height="' + height + '" as="geometry"/>');
        lines.push('          </mxCell>');
        lines.push('        </object>');
    } else if (shape === 'Pipe') {
        lines.push('        <object placeholders="1" c4Name="' + c4Name + '" c4Type="' + c4TypeEsc + '" c4Technology="' + c4Tech + '" c4Description="' + c4Desc + '" label="' + labelEsc + '" id="' + id + '" ' + props + '>');
        lines.push('          <mxCell style="shape=cylinder3;size=15;direction=south;boundedLbl=1;rounded=0;' + cellStyle + '" vertex="1" parent="' + parentId + '">');
        lines.push('            <mxGeometry x="' + x + '" y="' + y + '" width="' + width + '" height="' + height + '" as="geometry"/>');
        lines.push('          </mxCell>');
        lines.push('        </object>');
    } else if (shape === 'Circle') {
        width = Math.max(width, height); height = width;
        lines.push('        <object placeholders="1" c4Name="' + c4Name + '" c4Type="' + c4TypeEsc + '" c4Technology="' + c4Tech + '" c4Description="' + c4Desc + '" label="' + labelEsc + '" id="' + id + '" ' + props + '>');
        lines.push('          <mxCell style="ellipse;aspect=fixed;rounded=0;' + cellStyle + '" vertex="1" parent="' + parentId + '">');
        lines.push('            <mxGeometry x="' + x + '" y="' + y + '" width="' + width + '" height="' + height + '" as="geometry"/>');
        lines.push('          </mxCell>');
        lines.push('        </object>');
    } else if (shape === 'Ellipse') {
        lines.push('        <object placeholders="1" c4Name="' + c4Name + '" c4Type="' + c4TypeEsc + '" c4Technology="' + c4Tech + '" c4Description="' + c4Desc + '" label="' + labelEsc + '" id="' + id + '" ' + props + '>');
        lines.push('          <mxCell style="ellipse;rounded=0;' + cellStyle + '" vertex="1" parent="' + parentId + '">');
        lines.push('            <mxGeometry x="' + x + '" y="' + y + '" width="' + width + '" height="' + height + '" as="geometry"/>');
        lines.push('          </mxCell>');
        lines.push('        </object>');
    } else if (shape === 'WebBrowser') {
        lines.push('        <object placeholders="1" c4Name="' + c4Name + '" c4Type="' + c4TypeEsc + '" c4Technology="' + c4Tech + '" c4Description="' + c4Desc + '" label="' + labelEsc + '" id="' + id + '" ' + props + '>');
        lines.push('          <mxCell style="shape=mxgraph.c4.webBrowserContainer2;boundedLbl=1;rounded=0;' + cellStyle + '" vertex="1" parent="' + parentId + '">');
        lines.push('            <mxGeometry x="' + x + '" y="' + y + '" width="' + width + '" height="' + height + '" as="geometry"/>');
        lines.push('          </mxCell>');
        lines.push('        </object>');
    } else if (shape === 'Robot') {
        lines.push('        <object placeholders="1" c4Name="' + c4Name + '" c4Type="' + c4TypeEsc + '" c4Technology="' + c4Tech + '" c4Description="' + c4Desc + '" label="' + labelEsc + '" id="' + id + '" ' + props + '>');
        lines.push('          <mxCell style="shape=mxgraph.c4.robot2;rounded=0;' + cellStyle + '" vertex="1" parent="' + parentId + '">');
        lines.push('            <mxGeometry x="' + x + '" y="' + y + '" width="' + width + '" height="' + height + '" as="geometry"/>');
        lines.push('          </mxCell>');
        lines.push('        </object>');
    } else if (shape === 'Folder') {
        lines.push('        <object placeholders="1" c4Name="' + c4Name + '" c4Type="' + c4TypeEsc + '" c4Technology="' + c4Tech + '" c4Description="' + c4Desc + '" label="' + labelEsc + '" id="' + id + '" ' + props + '>');
        lines.push('          <mxCell style="shape=mxgraph.c4.folder;rounded=0;' + cellStyle + '" vertex="1" parent="' + parentId + '">');
        lines.push('            <mxGeometry x="' + x + '" y="' + y + '" width="' + width + '" height="' + height + '" as="geometry"/>');
        lines.push('          </mxCell>');
        lines.push('        </object>');
    } else if (shape === 'MobileDevicePortrait') {
        lines.push('        <object placeholders="1" c4Name="' + c4Name + '" c4Type="' + c4TypeEsc + '" c4Technology="' + c4Tech + '" c4Description="' + c4Desc + '" label="' + labelEsc + '" id="' + id + '" ' + props + '>');
        lines.push('          <mxCell style="shape=mxgraph.c4.mobilePhonePortrait;rounded=0;' + cellStyle + '" vertex="1" parent="' + parentId + '">');
        lines.push('            <mxGeometry x="' + x + '" y="' + y + '" width="' + width + '" height="' + height + '" as="geometry"/>');
        lines.push('          </mxCell>');
        lines.push('        </object>');
    } else if (shape === 'MobileDeviceLandscape') {
        lines.push('        <object placeholders="1" c4Name="' + c4Name + '" c4Type="' + c4TypeEsc + '" c4Technology="' + c4Tech + '" c4Description="' + c4Desc + '" label="' + labelEsc + '" id="' + id + '" ' + props + '>');
        lines.push('          <mxCell style="shape=mxgraph.c4.mobilePhoneLandscape;rounded=0;' + cellStyle + '" vertex="1" parent="' + parentId + '">');
        lines.push('            <mxGeometry x="' + x + '" y="' + y + '" width="' + width + '" height="' + height + '" as="geometry"/>');
        lines.push('          </mxCell>');
        lines.push('        </object>');
    } else if (shape === 'Box') {
        lines.push('        <object placeholders="1" c4Name="' + c4Name + '" c4Type="' + c4TypeEsc + '" c4Technology="' + c4Tech + '" c4Description="' + c4Desc + '" label="' + labelEsc + '" id="' + id + '" ' + props + '>');
        lines.push('          <mxCell style="rounded=0;' + cellStyle + '" vertex="1" parent="' + parentId + '">');
        lines.push('            <mxGeometry x="' + x + '" y="' + y + '" width="' + width + '" height="' + height + '" as="geometry"/>');
        lines.push('          </mxCell>');
        lines.push('        </object>');
    } else {
        // RoundedBox (default)
        lines.push('        <object placeholders="1" c4Name="' + c4Name + '" c4Type="' + c4TypeEsc + '" c4Technology="' + c4Tech + '" c4Description="' + c4Desc + '" label="' + labelEsc + '" id="' + id + '" ' + props + '>');
        lines.push('          <mxCell style="rounded=1;' + cellStyle + '" vertex="1" parent="' + parentId + '">');
        lines.push('            <mxGeometry x="' + x + '" y="' + y + '" width="' + width + '" height="' + height + '" as="geometry"/>');
        lines.push('          </mxCell>');
        lines.push('        </object>');
    }
};

// ========== ОТНОШЕНИЯ ==========

structurizr.drawio._writeRelationship = function(lines, rv, view, workspace, parentId, darkMode) {
    var rel = workspace.findRelationshipById(rv.id);
    if (!rel) return;
    var rs = structurizr.ui.findRelationshipStyle(rel, darkMode);
    var color = rs.color || (!darkMode ? '#444444' : '#cccccc');
    var descFontSize = rs.fontSize || 24;
    var strokeWidth = rs.thickness || 2;
    var routing = rs.routing || 'Direct';
    var style = rs.style || 'Solid';
    var source = rel.sourceId, dest = rel.destinationId;
    if (rv.response) { source = rel.destinationId; dest = rel.sourceId; }
    var desc = rv.description || rel.description || '';
    if (rv.order) { desc = rv.order + '. ' + desc; }
    var tech = rel.technology || '';
    var id = rv.id + '-' + (rv.order || '0');

    var label = '';
    if (desc) {
        if (tech) { label = '<div style="text-align: left"><div style="text-align: center"><b>' + structurizr.drawio._escapeXml(desc) + '</b></div><div style="text-align: center">[' + structurizr.drawio._escapeXml(tech) + ']</div></div>'; }
        else { label = '<div style="text-align: left"><div style="text-align: center"><b>' + structurizr.drawio._escapeXml(desc) + '</b></div></div>'; }
    }

    var dashed = '0', dashPattern = '1 8';
    if (style === 'Dotted') { dashed = '1'; dashPattern = '1 8'; }
    else if (style === 'Dashed') { dashed = '1'; dashPattern = '12 12'; }
    var curved = routing === 'Curved' ? '1' : '0';
    var edgeStyle = routing === 'Orthogonal' ? 'orthogonalEdgeStyle' : 'none';
    var c4Desc = structurizr.drawio._escapeXml(desc);
    var c4Tech = structurizr.drawio._escapeXml(tech);
    var labelEsc = structurizr.drawio._escapeXml(label);

    lines.push('        <object placeholders="1" c4Type="Relationship" c4Technology="' + c4Tech + '" c4Description="' + c4Desc + '" label="' + labelEsc + '" id="' + id + '">');
    lines.push('          <mxCell style="endSize=20;startSize=20;jumpStyle=arc;jumpSize=16;elbow=vertical;endFill=1;whiteSpace=wrap;endArrow=block;html=1;fontSize=' + descFontSize + ';fontColor=' + color + ';align=center;arcSize=10;strokeColor=' + color + ';strokeWidth=' + strokeWidth + ';metaEdit=1;resizable=0;dashed=' + dashed + ';dashPattern=' + dashPattern + ';rounded=0;curved=' + curved + ';edgeStyle=' + edgeStyle + ';" parent="' + parentId + '" edge="1" source="' + source + '" target="' + dest + '">');
    var vertices = rv.vertices;
    if (vertices && vertices.length > 0) {
        lines.push('            <mxGeometry relative="1" as="geometry">');
        lines.push('              <Array as="points">');
        for (var v = 0; v < vertices.length; v++) { lines.push('                <mxPoint x="' + vertices[v].x + '" y="' + vertices[v].y + '"/>'); }
        lines.push('              </Array>');
        lines.push('            </mxGeometry>');
    } else { lines.push('            <mxGeometry relative="1" as="geometry"/>'); }
    lines.push('          </mxCell>');
    lines.push('        </object>');
};

// ========== ГРАНИЦЫ ==========

/**
 * Сбор всех границ в правильном порядке:
 * 1. Сначала собираем group boundaries (сырые данные по элементам)
 * 2. Обновляем group boundaries (добавляем margin)
 * 3. Создаём SS/Container boundaries с учётом group boundaries
 * 4. Добавляем всё в финальный массив
 *
 * Аналог MxExporter.java writeFooter():
 *   - updateGroupBoundary, writeGroupBoundary,
 *   - writeSoftwareSystemBoundary, writeContainerBoundary,
 *   - writeDeploymentNodeBoundary
 */
structurizr.drawio._collectBoundaries = function(view, workspace, darkMode) {
    var boundaries = [];
    var elementsOnDiagram = {};
    if (view.elements) {
        for (var i = 0; i < view.elements.length; i++) {
            var ev = view.elements[i];
            var el = workspace.findElementById(ev.id);
            if (el) { elementsOnDiagram[ev.id] = { element: el, view: ev }; }
        }
    }

    // 1. Собираем все group boundaries (сырые, без margin)
    var rawGroups = structurizr.drawio._collectRawGroupBoundaries(view, workspace, elementsOnDiagram, darkMode);

    // 2. Обновляем (рекурсивно) — добавляем clusterMargin + место для текста
    for (var key in rawGroups) {
        if (!rawGroups.hasOwnProperty(key)) continue;
        structurizr.drawio._updateGroupBoundary(rawGroups[key], view, workspace, darkMode);
    }

    // Превращаем rawGroups в плоский массив для использования
    var groupBoundariesList = [];
    var flattenGroups = function(g) {
        groupBoundariesList.push(g);
        if (g.children) {
            for (var ci = 0; ci < g.children.length; ci++) { flattenGroups(g.children[ci]); }
        }
    };
    for (var key in rawGroups) {
        if (!rawGroups.hasOwnProperty(key)) continue;
        flattenGroups(rawGroups[key]);
    }

    // 3. SS boundary — с учётом group boundaries
    if (view.type === 'Container' && view.softwareSystemId) {
        var ssEls = [];
        for (var id in elementsOnDiagram) {
            if (!elementsOnDiagram.hasOwnProperty(id)) continue;
            var e = elementsOnDiagram[id].element;
            if (e.parentId === view.softwareSystemId || e.id === view.softwareSystemId) ssEls.push(id);
        }
        var b = structurizr.drawio._createBoundaryForElements(ssEls, elementsOnDiagram, view, workspace, darkMode, groupBoundariesList);
        if (b) {
            var ssEl = workspace.findElementById(view.softwareSystemId);
            b.name = ssEl ? ssEl.name : 'Software System';
            b.id = view.softwareSystemId;
            b.c4Type = 'SystemScopeBoundary';
            b.label = '<font style="font-size:' + b.fontSize + 'px"><b><div style="text-align: left">' + structurizr.drawio._escapeXml(b.name) + '</div></b></font><div style="text-align: left">[Software System]</div>';
            boundaries.push(b);
        }
    }

    // 4. Container boundary
    if (view.type === 'Component' && view.containerId) {
        var cEls = [];
        for (var id in elementsOnDiagram) {
            if (!elementsOnDiagram.hasOwnProperty(id)) continue;
            var e = elementsOnDiagram[id].element;
            if (e.parentId === view.containerId || e.id === view.containerId) cEls.push(id);
        }
        var b = structurizr.drawio._createBoundaryForElements(cEls, elementsOnDiagram, view, workspace, darkMode, groupBoundariesList);
        if (b) {
            var cEl = workspace.findElementById(view.containerId);
            b.name = cEl ? cEl.name : 'Container';
            b.id = view.containerId;
            b.c4Type = 'ContainerScopeBoundary';
            b.label = '<font style="font-size:' + b.fontSize + 'px"><b><div style="text-align: left">' + structurizr.drawio._escapeXml(b.name) + '</div></b></font><div style="text-align: left">[Container]</div>';
            boundaries.push(b);
        }
    }

    // 5. Deployment node boundaries
    structurizr.drawio._collectDeploymentNodeBoundaries(view, workspace, elementsOnDiagram, boundaries, darkMode);

    // 6. Добавляем group boundaries поверх
    for (var gi = 0; gi < groupBoundariesList.length; gi++) {
        boundaries.push(groupBoundariesList[gi]);
    }

    return boundaries;
};

/**
 * Обновление group boundary: добавляет clusterMargin + место для текста
 * Аналог updateGroupBoundary в MxExporter.java
 */
structurizr.drawio._updateGroupBoundary = function(gb, view, workspace, darkMode) {
    // Рекурсивно обновляем вложенные группы
    if (gb.children && gb.children.length > 0) {
        for (var i = 0; i < gb.children.length; i++) {
            structurizr.drawio._updateGroupBoundary(gb.children[i], view, workspace, darkMode);
            gb.minX = Math.min(gb.minX, gb.children[i].minX);
            gb.minY = Math.min(gb.minY, gb.children[i].minY);
            gb.maxX = Math.max(gb.maxX, gb.children[i].maxX);
            gb.maxY = Math.max(gb.maxY, gb.children[i].maxY);
        }
    }

    var cm = 25;
    var fontSize = gb.fontSize || 24;
    var metaFs = fontSize - 5;

    gb.minX -= cm;
    gb.minY -= cm;
    gb.maxX += cm;
    gb.maxY += cm;
    gb.maxY += structurizr.drawio._fontHeight('Helvetica', fontSize);
    gb.maxY += structurizr.drawio._fontHeight('Helvetica', metaFs);
};

/**
 * Сбор сырых group boundaries (до добавления margin)
 * Возвращает Map: fullName -> { name, fullName, children, minX, minY, maxX, maxY, fontSize, ... }
 */
structurizr.drawio._collectRawGroupBoundaries = function(view, workspace, elementsOnDiagram, darkMode) {
    var groupSep = (workspace.model && workspace.model.properties) ? workspace.model.properties['structurizr.groupSeparator'] : '';
    var groups = {};

    for (var id in elementsOnDiagram) {
        if (!elementsOnDiagram.hasOwnProperty(id)) continue;
        var info = elementsOnDiagram[id], el = info.element;
        if (!el.group) continue;
        var names = groupSep ? el.group.split(groupSep) : [el.group];
        var path = '';
        for (var gi = 0; gi < names.length; gi++) {
            path += (path ? groupSep : '') + names[gi];
            if (!groups[path]) {
                groups[path] = {
                    name: names[gi],
                    fullName: path,
                    children: [],
                    minX: Infinity,
                    minY: Infinity,
                    maxX: -Infinity,
                    maxY: -Infinity,
                    fontSize: 24
                };
            }
        }
    }

    // Строим дерево: parent -> children
    // Сначала все группы, потом связи
    var groupKeys = Object.keys(groups).sort(function(a, b) { return a.length - b.length; });
    for (var i = 0; i < groupKeys.length; i++) {
        var key = groupKeys[i];
        var g = groups[key];
        // Ищем родителя
        var lastSep = key.lastIndexOf(groupSep || '.');
        if (lastSep > 0) {
            var parentKey = key.substring(0, lastSep);
            var parent = groups[parentKey];
            if (parent) {
                parent.children.push(g);
            }
        }
    }

    // Обновляем min/max по элементам (аналог startGroupBoundary в Java)
    for (var id in elementsOnDiagram) {
        if (!elementsOnDiagram.hasOwnProperty(id)) continue;
        var info = elementsOnDiagram[id], el = info.element, ev = info.view;
        if (!el.group) continue;
        var es = structurizr.ui.findElementStyle(el, darkMode);
        var w = es.width || 450;
        var h = (es.shape === 'Hexagon') ? Math.round(0.89 * w) : (es.height || 300);
        var x = ev.x || 0, y = ev.y || 0;
        var names = groupSep ? el.group.split(groupSep) : [el.group];
        var path = '';
        for (var gi = 0; gi < names.length; gi++) {
            path += (path ? groupSep : '') + names[gi];
            var g = groups[path];
            if (g) {
                g.minX = Math.min(g.minX, x);
                g.minY = Math.min(g.minY, y);
                g.maxX = Math.max(g.maxX, x + w);
                g.maxY = Math.max(g.maxY, y + h);
            }
        }
    }

    // Применяем стили к каждой группе (по аналогии с writeGroupBoundary/getGroupStyle)
    var proxy = { type: 'Group', tags: 'Group' };
    for (var key in groups) {
        if (!groups.hasOwnProperty(key)) continue;
        var g = groups[key];
        proxy.tags = 'Group, Group:' + g.fullName;
        var es = structurizr.ui.findElementStyle(proxy, darkMode);
        g.textColor = (es.color && structurizr.drawio._hasColor(es.color)) ? es.color : '#333333';
        g.strokeColor = (es.stroke && structurizr.drawio._hasColor(es.stroke)) ? es.stroke : '#666666';
        g.strokeWidth = es.strokeWidth || 4;
        g.fontSize = es.fontSize || 24;
        g.dashPattern = '1 2';
        g.isGroup = true;
        g.label = '';
        g.id = 'group-' + key.replace(/[^a-zA-Z0-9]/g, '-');
    }

    return groups;
};

/**
 * Создание границы для набора элементов с учётом дополнительных границ (например, group boundaries)
 * Аналог writeSoftwareSystemBoundary / writeContainerBoundary в Java
 */
structurizr.drawio._createBoundaryForElements = function(elementIds, elementsOnDiagram, view, workspace, darkMode, extraBoundaries) {
    var hasElements = elementIds && elementIds.length > 0;
    var hasExtra = extraBoundaries && extraBoundaries.length > 0;
    if (!hasElements && !hasExtra) return null;

    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    var cm = 25, fontSize = 24, metaFs = 19;

    // Сначала учитываем элементы
    if (hasElements) {
        for (var i = 0; i < elementIds.length; i++) {
            var info = elementsOnDiagram[elementIds[i]];
            if (!info) continue;
            var es = structurizr.ui.findElementStyle(info.element, darkMode);
            var w = es.width || 450;
            var h = (es.shape === 'Hexagon') ? Math.round(0.89 * w) : (es.height || 300);
            var x = info.view.x || 0, y = info.view.y || 0;
            minX = Math.min(minX, x); minY = Math.min(minY, y);
            maxX = Math.max(maxX, x + w); maxY = Math.max(maxY, y + h);
        }
    }

    // Учитываем extra границы (group boundaries) — как в Java writeSoftwareSystemBoundary:
    // for(GroupBoundary gb : groupBoundaries) { minX = Math.min(minX, gb.minX); ... }
    if (hasExtra) {
        for (var ei = 0; ei < extraBoundaries.length; ei++) {
            var eb = extraBoundaries[ei];
            minX = Math.min(minX, eb.minX);
            minY = Math.min(minY, eb.minY);
            maxX = Math.max(maxX, eb.maxX);
            maxY = Math.max(maxY, eb.maxY);
        }
    }

    if (minX === Infinity) return null;

    // Берём стиль из первого элемента (как в Java)
    var strokeColor = '#666666', textColor = '#333333', strokeWidth = 4;
    if (hasElements && elementIds.length > 0) {
        var first = elementsOnDiagram[elementIds[0]];
        if (first) {
            var es = structurizr.ui.findElementStyle(first.element, darkMode);
            if (es.color) textColor = es.color;
            if (es.stroke) strokeColor = es.stroke;
            if (es.strokeWidth) strokeWidth = es.strokeWidth;
        }
    }

    minX -= cm; minY -= cm; maxX += cm; maxY += cm;
    maxY += structurizr.drawio._fontHeight('Helvetica', fontSize);
    maxY += structurizr.drawio._fontHeight('Helvetica', metaFs);

    return {
        id: 'boundary-' + ((hasElements ? elementIds[0] : 'scope') || 'unknown'),
        name: 'Boundary',
        minX: minX, minY: minY, maxX: maxX, maxY: maxY,
        textColor: textColor, strokeColor: strokeColor, strokeWidth: strokeWidth,
        fontSize: fontSize, dashPattern: '8 8', isGroup: false, label: ''
    };
};

structurizr.drawio._collectDeploymentNodeBoundaries = function(view, workspace, elementsOnDiagram, boundaries, darkMode) {
    for (var id in elementsOnDiagram) {
        if (!elementsOnDiagram.hasOwnProperty(id)) continue;
        var info = elementsOnDiagram[id];
        if (info.element.type === 'DeploymentNode') {
            structurizr.drawio._processDeploymentNode(info.element, view, workspace, elementsOnDiagram, boundaries, darkMode);
        }
    }
};

structurizr.drawio._processDeploymentNode = function(dn, view, workspace, elementsOnDiagram, boundaries, darkMode) {
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, cm = 25;
    if (dn.children) {
        for (var ci = 0; ci < dn.children.length; ci++) {
            structurizr.drawio._processDeploymentNode(dn.children[ci], view, workspace, elementsOnDiagram, boundaries, darkMode);
        }
    }
    function findView(eid) { if (!view.elements) return null; for (var i = 0; i < view.elements.length; i++) { if (view.elements[i].id === eid) return view.elements[i]; } return null; }
    if (dn.softwareSystemInstances) { for (var si = 0; si < dn.softwareSystemInstances.length; si++) { var ssi = dn.softwareSystemInstances[si], ev = findView(ssi.id); if (ev && ev.x !== undefined) { var es = structurizr.ui.findElementStyle(ssi, darkMode); var w = es.width || 450, h = (es.shape === 'Hexagon') ? Math.round(0.89 * w) : (es.height || 300); minX = Math.min(minX, ev.x); minY = Math.min(minY, ev.y); maxX = Math.max(maxX, ev.x + w); maxY = Math.max(maxY, ev.y + h); } } }
    if (dn.containerInstances) { for (var ci2 = 0; ci2 < dn.containerInstances.length; ci2++) { var ci = dn.containerInstances[ci2], ev = findView(ci.id); if (ev && ev.x !== undefined) { var es = structurizr.ui.findElementStyle(ci, darkMode); var w = es.width || 450, h = (es.shape === 'Hexagon') ? Math.round(0.89 * w) : (es.height || 300); minX = Math.min(minX, ev.x); minY = Math.min(minY, ev.y); maxX = Math.max(maxX, ev.x + w); maxY = Math.max(maxY, ev.y + h); } } }
    if (dn.infrastructureNodes) { for (var ii = 0; ii < dn.infrastructureNodes.length; ii++) { var inode = dn.infrastructureNodes[ii], ev = findView(inode.id); if (ev && ev.x !== undefined) { var es = structurizr.ui.findElementStyle(inode, darkMode); var w = es.width || 450, h = (es.shape === 'Hexagon') ? Math.round(0.89 * w) : (es.height || 300); minX = Math.min(minX, ev.x); minY = Math.min(minY, ev.y); maxX = Math.max(maxX, ev.x + w); maxY = Math.max(maxY, ev.y + h); } } }
    if (minX === Infinity) return;
    var es = structurizr.ui.findElementStyle(dn, darkMode);
    var tc = (es.color && structurizr.drawio._hasColor(es.color)) ? es.color : '#444444';
    var sc = (es.stroke && structurizr.drawio._hasColor(es.stroke)) ? es.stroke : '#666666';
    var sw = es.strokeWidth || 4, fs = es.fontSize || 24, mfs = fs - 5;
    minX -= cm; minY -= cm; maxX += cm; maxY += cm;
    maxY += structurizr.drawio._fontHeight('Helvetica', fs);
    maxY += structurizr.drawio._fontHeight('Helvetica', mfs);
    var tech = dn.technology || '';
    var label = '<font style="font-size:' + fs + 'px"><b><div style="text-align: left">' + structurizr.drawio._escapeXml(dn.name || '') + '</div></b></font><div style="text-align: left">[' + (tech ? 'DeploymentNode: ' + structurizr.drawio._escapeXml(tech) : 'DeploymentNode') + ']</div>';
    boundaries.push({ id: dn.id, name: dn.name || '', minX: minX, minY: minY, maxX: maxX, maxY: maxY,
        textColor: tc, strokeColor: sc, strokeWidth: sw, fontSize: fs,
        dashPattern: '8 8', isGroup: false, label: label, technology: tech,
        c4Type: 'DeploymentNodeScopeBoundary' });
};

structurizr.drawio._writeBoundary = function(lines, boundary, parentId) {
    var w = boundary.maxX - boundary.minX, h = boundary.maxY - boundary.minY;
    var dashPattern = boundary.dashPattern || '8 8';
    var label = boundary.label;
    if (!label) {
        if (boundary.isGroup) {
            label = '<font style="font-size:' + boundary.fontSize + 'px"><b><div style="text-align: left">' + structurizr.drawio._escapeXml(boundary.name) + '</div></b></font><div style="text-align: left">[Group]</div>';
        } else {
            label = '<font style="font-size:' + boundary.fontSize + 'px"><b><div style="text-align: left">' + structurizr.drawio._escapeXml(boundary.name) + '</div></b></font><div style="text-align: left">[' + structurizr.drawio._escapeXml(boundary.nameFull || 'Scope') + ']</div>';
        }
    }
    var style = 'rounded=1;fontSize=' + boundary.fontSize + ';whiteSpace=wrap;html=1;dashed=1;arcSize=20;fillColor=none;strokeColor=' + boundary.strokeColor + ';fontColor=' + boundary.textColor + ';strokeWidth=' + boundary.strokeWidth + ';labelBackgroundColor=none;align=left;verticalAlign=bottom;labelBorderColor=none;spacingTop=0;spacing=10;dashPattern=' + dashPattern + ';metaEdit=1;rotatable=0;perimeter=rectanglePerimeter;noLabel=0;labelPadding=0;allowArrows=0;connectable=0;expand=0;recursiveResize=0;editable=1;pointerEvents=0;absoluteArcSize=1;points=[[0.25,0,0],[0.5,0,0],[0.75,0,0],[1,0.25,0],[1,0.5,0],[1,0.75,0],[0.75,1,0],[0.5,1,0],[0.25,1,0],[0,0.75,0],[0,0.5,0],[0,0.25,0]];';
    var c4Type = boundary.c4Type || 'ScopeBoundary';
    lines.push('        <object placeholders="1" c4Name="' + structurizr.drawio._escapeXml(boundary.name) + '" c4Type="' + c4Type + '" label="' + structurizr.drawio._escapeXml(label) + '" id="' + boundary.id + '">');
    lines.push('          <mxCell style="' + style + '" vertex="1" parent="' + parentId + '">');
    lines.push('            <mxGeometry x="' + boundary.minX + '" y="' + boundary.minY + '" width="' + w + '" height="' + h + '" as="geometry"/>');
    lines.push('          </mxCell>');
    lines.push('        </object>');
};