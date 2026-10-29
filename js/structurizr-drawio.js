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

/**
 * Text of an HTML label: XML-escaped, with newlines turned into line breaks so a
 * multi-line text keeps its lines (structurizr-diagram.js draws the description
 * and metadata as SVG text, where newlines are line breaks).
 */
structurizr.drawio._labelText = function(text) {
    return structurizr.drawio._escapeXml(text).replace(/(\r\n|\r|\n)/g, '<br>');
};

/**
 * Title text: XML-escaped, with newlines replaced by spaces
 * (structurizr.util.removeNewlineCharacters).
 */
structurizr.drawio._titleText = function(text) {
    return structurizr.drawio._escapeXml(text).replace(/(\r\n|\r|\n)/g, ' ');
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

/**
 * Font family of every text, taken from the renderer
 * (structurizr-diagram.js font.name). drawio accepts a CSS font stack here and
 * quotes each entry itself (mxUtils.parseCssFontFamily).
 */
structurizr.drawio._fontFamily = function() {
    return (structurizr.ui && structurizr.ui.DEFAULT_FONT_NAME)
        ? structurizr.ui.DEFAULT_FONT_NAME
        : 'Tahoma, Verdana, Helvetica, Arial';
};

/** drawio style fragment that pins the font family. */
structurizr.drawio._fontStyle = function() {
    return 'fontFamily=' + structurizr.drawio._fontFamily() + ';';
};

structurizr.drawio._hasColor = function(color) {
    return color && color !== '' && color !== 'none' && color !== '#00000000' && color !== '#ffffff00';
};

/**
 * Blends a colour towards white (light mode) or black (dark mode)
 * (structurizr.util.shadeColor).
 */
structurizr.drawio._shadeColor = function(color, percentAsInteger, darkMode) {
    if (!/^#[0-9a-fA-F]{6}$/.test(String(color))) return color;
    if (darkMode === true) percentAsInteger = -percentAsInteger;

    var percent = 0;
    if (percentAsInteger !== 0) {
        percent = (percentAsInteger > 90) ? 0.9 : (percentAsInteger / 100);
    }

    var f = parseInt(color.slice(1), 16);
    var t = percent < 0 ? 0 : 255;
    var p = percent < 0 ? percent * -1 : percent;
    var R = f >> 16, G = f >> 8 & 0x00FF, B = f & 0x0000FF;
    return '#' + (0x1000000 + (Math.round((t - R) * p) + R) * 0x10000 + (Math.round((t - G) * p) + G) * 0x100 + (Math.round((t - B) * p) + B)).toString(16).slice(1);
};

/** Applies an element style opacity to a colour: shadeColor(color, 100 - opacity). */
structurizr.drawio._applyOpacity = function(color, elementStyle, darkMode) {
    var opacity = (elementStyle && elementStyle.opacity !== undefined) ? elementStyle.opacity : 100;
    return structurizr.drawio._shadeColor(color, 100 - opacity, darkMode);
};

/**
 * drawio dash pattern for a border or relationship style
 * (structurizr-diagram.js dashArrayForElement/dashArrayForRelationship).
 */
structurizr.drawio._dashPattern = function(style, width) {
    var w = width || 2;
    if (style === 'Dashed') return (w * 4) + ' ' + (w * 4);
    if (style === 'Dotted') return w + ' ' + (w * 2);
    return '';
};

/** Shapes drawn with rounded corners (structurizr-diagram.js shapeHasRoundedCorners). */
structurizr.drawio._shapeHasRoundedCorners = function(shape) {
    return ['RoundedBox', 'Folder', 'WebBrowser', 'Window', 'Terminal', 'Shell',
        'MobileDevicePortrait', 'MobileDeviceLandscape', 'Component'].indexOf(shape) > -1;
};

/**
 * Border of a boundary: dash pattern and corner radius taken from the element style,
 * with a style for the Boundary tag taking precedence
 * (structurizr-diagram.js createBoundary).
 */
structurizr.drawio._boundaryBorder = function(elementStyle, element, darkMode) {
    var override = element
        ? structurizr.ui.findElementStyle({ type: 'Boundary', tags: 'Boundary, Boundary:' + element.type }, darkMode)
        : undefined;
    var border = (override && override.border !== undefined) ? override.border : (elementStyle ? elementStyle.border : undefined);
    var shape = (override && override.shape !== undefined) ? override.shape : (elementStyle ? elementStyle.shape : undefined);

    return {
        dashPattern: structurizr.drawio._dashPattern(border, elementStyle ? elementStyle.strokeWidth : undefined),
        cornerRadius: structurizr.drawio._shapeHasRoundedCorners(shape) ? 20 : 0
    };
};

/**
 * View property, falling back to the view set properties
 * (structurizr-diagram.js getViewOrViewSetProperty).
 */
structurizr.drawio._viewOrViewSetProperty = function(view, workspace, name, defaultValue) {
    var value = defaultValue;
    var views = workspace ? workspace.views : undefined;
    var configuration = (views && views.configuration) ? views.configuration : undefined;
    if (configuration && configuration.properties && configuration.properties[name]) {
        value = configuration.properties[name];
    }
    if (view && view.properties && view.properties[name]) {
        value = view.properties[name];
    }
    return value;
};

/** Rendered height of a text block: one line plus 20% leading per extra line. */
structurizr.drawio._textBlockHeight = function(text, fontSize) {
    if (!text) return 0;
    var trimmed = String(text).trim();
    if (trimmed.length === 0) return 0;
    var lines = trimmed.split('\n').length;
    return fontSize + ((lines - 1) * (fontSize * 1.2));
};

/** Workspace last-modified date and version (structurizr-diagram.js createDiagramMetadata). */
structurizr.drawio._diagramMetadataText = function(workspace) {
    var views = workspace ? workspace.views : undefined;
    var configuration = (views && views.configuration) ? views.configuration : undefined;
    var properties = (configuration && configuration.properties) ? configuration.properties : {};
    var options = {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
        hour: 'numeric', minute: 'numeric',
        timeZone: properties['structurizr.timezone'],
        timeZoneName: 'long'
    };
    var locale = properties['structurizr.locale'];

    if (workspace && workspace.id === 0) {
        return new Date().toLocaleString(locale, options);
    }

    var text = '';
    if (workspace && workspace.lastModifiedDate) {
        text = new Date(workspace.lastModifiedDate).toLocaleString(locale, options);
    }
    if (workspace && workspace.version) {
        text += (text ? ' | ' : '') + 'Version: ' + workspace.version;
    }
    return text;
};

/** Title, description and metadata shown under the diagram. */
structurizr.drawio._diagramMetadata = function(view, workspace, darkMode) {
    var titleStyle = structurizr.ui.findElementStyle({ type: undefined, tags: 'Diagram:Title' }, darkMode);
    var descriptionStyle = structurizr.ui.findElementStyle({ type: undefined, tags: 'Diagram:Description' }, darkMode);
    var metadataStyle = structurizr.ui.findElementStyle({ type: undefined, tags: 'Diagram:Metadata' }, darkMode);

    var showTitle = structurizr.drawio._viewOrViewSetProperty(view, workspace, 'structurizr.title', 'true') === 'true';
    var showDescription = structurizr.drawio._viewOrViewSetProperty(view, workspace, 'structurizr.description', 'true') === 'true';
    var showMetadata = structurizr.drawio._viewOrViewSetProperty(view, workspace, 'structurizr.metadata', 'true') === 'true';

    return {
        title: (showTitle && structurizr.ui.getTitleForView) ? (structurizr.ui.getTitleForView(view) || '') : '',
        description: (showDescription && view.description) ? view.description : '',
        metadata: showMetadata ? structurizr.drawio._diagramMetadataText(workspace) : '',
        titleFontSize: titleStyle.fontSize || 36,
        descriptionFontSize: descriptionStyle.fontSize || 24,
        metadataFontSize: metadataStyle.fontSize || 24,
        titleColor: titleStyle.color || '#444444',
        descriptionColor: descriptionStyle.color || '#444444',
        metadataColor: metadataStyle.color || '#444444'
    };
};

/** Boundary label: the name plus an optional metadata line (already bracketed). */
structurizr.drawio._boundaryLabel = function(name, metadata, fontSize) {
    var label = '<font style="font-size:' + fontSize + 'px"><b><div style="text-align: left">' + structurizr.drawio._escapeXml(name) + '</div></b></font>';
    if (metadata) {
        label += '<div style="text-align: left">' + structurizr.drawio._escapeXml(metadata) + '</div>';
    }
    return label;
};

/** Opening and closing metadata symbols (structurizr-ui.js openingMetadataSymbols). */
structurizr.drawio._metadataSymbols = function(workspace) {
    var opening = {
        SquareBrackets: '[', RoundBrackets: '(', CurlyBrackets: '{',
        AngleBrackets: '<', DoubleAngleBrackets: '<<', None: ''
    };
    var closing = {
        SquareBrackets: ']', RoundBrackets: ')', CurlyBrackets: '}',
        AngleBrackets: '>', DoubleAngleBrackets: '>>', None: ''
    };

    var views = workspace ? workspace.views : undefined;
    var configuration = (views && views.configuration) ? views.configuration : undefined;
    var name = (configuration && configuration.metadataSymbols) ? configuration.metadataSymbols : 'SquareBrackets';

    return {
        open: (opening[name] !== undefined) ? opening[name] : '[',
        close: (closing[name] !== undefined) ? closing[name] : ']'
    };
};

/**
 * Metadata line including its brackets (structurizr-ui.js getMetadataForElement).
 * A custom element shows its own metadata instead of a type; an empty string means
 * the element has no metadata line.
 */
structurizr.drawio._metadataText = function(element, type, technology, workspace) {
    var symbols = structurizr.drawio._metadataSymbols(workspace);
    if (element && element.type === 'Custom') {
        return element.metadata ? (symbols.open + element.metadata + symbols.close) : '';
    }
    if (!type) return '';
    return technology
        ? (symbols.open + type + ': ' + technology + symbols.close)
        : (symbols.open + type + symbols.close);
};

/**
 * Name of the software system a container instance comes from, when it does not
 * belong to the system a deployment view is scoped to
 * (structurizr-diagram.js formatMetaData).
 */
structurizr.drawio._foreignContainerInstanceSystem = function(element, view, workspace) {
    if (!element || element.type !== 'ContainerInstance') return '';
    if (!view || view.type !== 'Deployment') return '';
    var container = workspace.findElementById(element.containerId);
    if (!container) return '';
    if (view.softwareSystemId !== undefined && container.parentId === view.softwareSystemId) return '';
    var softwareSystem = workspace.findElementById(container.parentId);
    return softwareSystem ? softwareSystem.name : '';
};

/**
 * URL of an element or relationship: the explicit url, or a property whose value
 * is an HTTP URL (structurizr-diagram.js addDoubleClickHandlerForElement).
 */
structurizr.drawio._urlFor = function(item) {
    if (!item) return '';
    if (item.url) return item.url;
    if (item.properties) {
        for (var name in item.properties) {
            if (!item.properties.hasOwnProperty(name)) continue;
            var value = String(item.properties[name]);
            if (value.indexOf('http://') === 0 || value.indexOf('https://') === 0) return value;
        }
    }
    return '';
};

/** A relationship inherits the URL of the relationship it is linked to. */
structurizr.drawio._relationshipUrl = function(relationship, workspace) {
    var seen = {};
    var current = relationship;
    while (current) {
        var url = structurizr.drawio._urlFor(current);
        if (url) return url;
        var linked = current.linkedRelationshipId;
        if (!linked || seen[String(linked)]) return '';
        seen[String(linked)] = true;
        current = workspace.findRelationshipById(linked);
    }
    return '';
};

/** drawio link attribute for a cell, or an empty string when there is no URL. */
structurizr.drawio._linkAttribute = function(url) {
    return url ? (' link="' + structurizr.drawio._escapeXml(url) + '"') : '';
};

/**
 * Metadata line for a boundary (for example "[Software System]" or
 * "[Deployment Node: Linux]"), or an empty string when the element style
 * sets 'metadata false'.
 */
structurizr.drawio._boundaryMetadata = function(element, terminology, technology, workspace, darkMode) {
    if (element && structurizr.ui.findElementStyle(element, darkMode).metadata === false) {
        return '';
    }
    var type = (element ? structurizr.workspace.getTerminologyFor(element) : '') || terminology;
    return structurizr.drawio._metadataText(element, type, technology, workspace);
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
    lines.push('  <diagram name="' + structurizr.drawio._escapeXml(diagramName) + '" id="' + structurizr.drawio._escapeXml(view.key) + '">');
    lines.push('    <mxGraphModel dx="0" dy="0" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="' + pageWidth + '" pageHeight="' + pageHeight + '" math="0" shadow="0">');
    lines.push('      <root>');
    lines.push('        <mxCell id="' + rootId + '"/>');
    lines.push('        <mxCell id="' + parentId + '" parent="' + rootId + '"/>');

    var boundaries = structurizr.drawio._collectBoundaries(view, workspace, darkMode);

    // Текстовый блок диаграммы лежит в самом низу стека (SVG: toBack), поэтому
    // он идёт раньше границ и элементов.
    structurizr.drawio._writeDiagramMetadata(lines, view, workspace, darkMode, boundaries, parentId);

    // Границы идут первыми, то есть оказываются позади: в SVG элементы и связи
    // поднимаются наверх (structurizr-diagram.js, toFront), поэтому рамки
    // SS/container/deployment/групп должны лежать под элементами.
    for (var i = 0; i < boundaries.length; i++) {
        structurizr.drawio._writeBoundary(lines, boundaries[i], parentId, workspace);
    }

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
    // Opacity washes the colours towards the canvas colour (structurizr-diagram.js
    // renderElementInternals).
    var color = structurizr.drawio._applyOpacity(es.color || '#444444', es, darkMode);
    var stroke = structurizr.drawio._applyOpacity(es.stroke || (!darkMode ? '#444444' : '#cccccc'), es, darkMode);
    var background = structurizr.drawio._applyOpacity(es.background || (!darkMode ? '#ffffff' : '#111111'), es, darkMode);
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

    var linkAttr = structurizr.drawio._linkAttribute(structurizr.drawio._urlFor(element));

    var props = '';
    if (element.properties) {
        var p = [];
        for (var k in element.properties) {
            if (!element.properties.hasOwnProperty(k)) continue;
            // A property named 'link' would duplicate the link attribute drawio reads.
            if (linkAttr && k === 'link') continue;
            var propValue = element.properties[k];
            if (propValue === undefined || propValue === null) continue;
            p.push(structurizr.drawio._escapeXml(k) + "='" + structurizr.drawio._escapeXml(String(propValue)) + "'");
        }
        props = p.join(' ');
    }

    // Style flags: 'metadata false' hides the [type: technology] line, 'description false'
    // hides the description (structurizr-diagram.js formatMetaData/formatDescription).
    var showMetadata = es.metadata !== false;
    var showDescription = es.description !== false;
    var label = '<font style="font-size:' + nameFontSize + 'px"><b>' + structurizr.drawio._escapeXml(name) + '</b></font>';
    if (showMetadata) {
        var metadataText = structurizr.drawio._metadataText(element, c4Type, tech, workspace);
        var fromSystem = structurizr.drawio._foreignContainerInstanceSystem(element, view, workspace);
        var metadataLabel = '';
        if (fromSystem) { metadataLabel += structurizr.drawio._escapeXml('from ' + fromSystem) + '<br>'; }
        if (metadataText) { metadataLabel += structurizr.drawio._escapeXml(metadataText); }
        if (metadataLabel) { label += '<div>' + metadataLabel + '</div>'; }
    }
    if (showDescription && description) { label += '<br><div><font style="font-size:' + descFontSize + 'px" color="' + color + '">' + structurizr.drawio._escapeXml(description) + '</font></div>'; }

    var c4Name = structurizr.drawio._escapeXml(name);
    var c4Desc = structurizr.drawio._escapeXml(description);
    var c4Tech = structurizr.drawio._escapeXml(tech);
    var c4TypeEsc = structurizr.drawio._escapeXml(c4Type);
    var labelEsc = structurizr.drawio._escapeXml(label);

    var dashPattern = structurizr.drawio._dashPattern(es.border, sw);
    var cellStyle = 'whiteSpace=wrap;html=1;' + structurizr.drawio._fontStyle() + 'fontSize=' + metadataFontSize + ';labelBackgroundColor=none;fillColor=' + background + ';fontColor=' + color + ';align=center;arcSize=10;strokeColor=' + stroke + ';dashed=' + (dashPattern ? '1' : '0') + ';dashPattern=' + (dashPattern || '1 0') + ';metaEdit=1;resizable=0;points=[[0.25,0,0],[0.5,0,0],[0.75,0,0],[1,0.25,0],[1,0.5,0],[1,0.75,0],[0.75,1,0],[0.5,1,0],[0.25,1,0],[0,0.75,0],[0,0.5,0],[0,0.25,0]];';

    if (shape === 'Person') {
        lines.push('        <object placeholders="1" c4Name="' + c4Name + '" c4Type="' + c4TypeEsc + '" c4Description="' + c4Desc + '" label="' + labelEsc + '" id="' + id + '" ' + props + linkAttr + '>');
        lines.push('          <mxCell style="shape=mxgraph.c4.person2;rounded=0;' + cellStyle + '" vertex="1" parent="' + parentId + '">');
        lines.push('            <mxGeometry x="' + x + '" y="' + y + '" width="' + width + '" height="' + height + '" as="geometry"/>');
        lines.push('          </mxCell>');
        lines.push('        </object>');
    } else if (shape === 'Hexagon') {
        lines.push('        <object placeholders="1" c4Name="' + c4Name + '" c4Type="' + c4TypeEsc + '" c4Technology="' + c4Tech + '" c4Description="' + c4Desc + '" label="' + labelEsc + '" id="' + id + '" ' + props + linkAttr + '>');
        lines.push('          <mxCell style="shape=hexagon;size=120;perimeter=hexagonPerimeter2;fixedSize=1;rounded=1;' + cellStyle + '" vertex="1" parent="' + parentId + '">');
        lines.push('            <mxGeometry x="' + x + '" y="' + y + '" width="' + width + '" height="' + height + '" as="geometry"/>');
        lines.push('          </mxCell>');
        lines.push('        </object>');
    } else if (shape === 'Cylinder') {
        lines.push('        <object placeholders="1" c4Name="' + c4Name + '" c4Type="' + c4TypeEsc + '" c4Technology="' + c4Tech + '" c4Description="' + c4Desc + '" label="' + labelEsc + '" id="' + id + '" ' + props + linkAttr + '>');
        lines.push('          <mxCell style="shape=cylinder3;size=15;boundedLbl=1;rounded=0;' + cellStyle + '" vertex="1" parent="' + parentId + '">');
        lines.push('            <mxGeometry x="' + x + '" y="' + y + '" width="' + width + '" height="' + height + '" as="geometry"/>');
        lines.push('          </mxCell>');
        lines.push('        </object>');
    } else if (shape === 'Pipe') {
        lines.push('        <object placeholders="1" c4Name="' + c4Name + '" c4Type="' + c4TypeEsc + '" c4Technology="' + c4Tech + '" c4Description="' + c4Desc + '" label="' + labelEsc + '" id="' + id + '" ' + props + linkAttr + '>');
        lines.push('          <mxCell style="shape=cylinder3;size=15;direction=south;boundedLbl=1;rounded=0;' + cellStyle + '" vertex="1" parent="' + parentId + '">');
        lines.push('            <mxGeometry x="' + x + '" y="' + y + '" width="' + width + '" height="' + height + '" as="geometry"/>');
        lines.push('          </mxCell>');
        lines.push('        </object>');
    } else if (shape === 'Circle') {
        width = Math.max(width, height); height = width;
        lines.push('        <object placeholders="1" c4Name="' + c4Name + '" c4Type="' + c4TypeEsc + '" c4Technology="' + c4Tech + '" c4Description="' + c4Desc + '" label="' + labelEsc + '" id="' + id + '" ' + props + linkAttr + '>');
        lines.push('          <mxCell style="ellipse;aspect=fixed;rounded=0;' + cellStyle + '" vertex="1" parent="' + parentId + '">');
        lines.push('            <mxGeometry x="' + x + '" y="' + y + '" width="' + width + '" height="' + height + '" as="geometry"/>');
        lines.push('          </mxCell>');
        lines.push('        </object>');
    } else if (shape === 'Ellipse') {
        lines.push('        <object placeholders="1" c4Name="' + c4Name + '" c4Type="' + c4TypeEsc + '" c4Technology="' + c4Tech + '" c4Description="' + c4Desc + '" label="' + labelEsc + '" id="' + id + '" ' + props + linkAttr + '>');
        lines.push('          <mxCell style="ellipse;rounded=0;' + cellStyle + '" vertex="1" parent="' + parentId + '">');
        lines.push('            <mxGeometry x="' + x + '" y="' + y + '" width="' + width + '" height="' + height + '" as="geometry"/>');
        lines.push('          </mxCell>');
        lines.push('        </object>');
    } else if (shape === 'WebBrowser') {
        lines.push('        <object placeholders="1" c4Name="' + c4Name + '" c4Type="' + c4TypeEsc + '" c4Technology="' + c4Tech + '" c4Description="' + c4Desc + '" label="' + labelEsc + '" id="' + id + '" ' + props + linkAttr + '>');
        lines.push('          <mxCell style="shape=mxgraph.c4.webBrowserContainer2;boundedLbl=1;rounded=0;' + cellStyle + '" vertex="1" parent="' + parentId + '">');
        lines.push('            <mxGeometry x="' + x + '" y="' + y + '" width="' + width + '" height="' + height + '" as="geometry"/>');
        lines.push('          </mxCell>');
        lines.push('        </object>');
    } else if (shape === 'Robot') {
        // drawio has no robot shape, so it falls back to a rounded box.
        lines.push('        <object placeholders="1" c4Name="' + c4Name + '" c4Type="' + c4TypeEsc + '" c4Technology="' + c4Tech + '" c4Description="' + c4Desc + '" label="' + labelEsc + '" id="' + id + '" ' + props + linkAttr + '>');
        lines.push('          <mxCell style="rounded=1;' + cellStyle + '" vertex="1" parent="' + parentId + '">');
        lines.push('            <mxGeometry x="' + x + '" y="' + y + '" width="' + width + '" height="' + height + '" as="geometry"/>');
        lines.push('          </mxCell>');
        lines.push('        </object>');
    } else if (shape === 'Folder') {
        lines.push('        <object placeholders="1" c4Name="' + c4Name + '" c4Type="' + c4TypeEsc + '" c4Technology="' + c4Tech + '" c4Description="' + c4Desc + '" label="' + labelEsc + '" id="' + id + '" ' + props + linkAttr + '>');
        lines.push('          <mxCell style="shape=folder;rounded=0;' + cellStyle + '" vertex="1" parent="' + parentId + '">');
        lines.push('            <mxGeometry x="' + x + '" y="' + y + '" width="' + width + '" height="' + height + '" as="geometry"/>');
        lines.push('          </mxCell>');
        lines.push('        </object>');
    } else if (shape === 'MobileDevicePortrait') {
        // drawio has no mobile device shape, so it falls back to a rounded box.
        lines.push('        <object placeholders="1" c4Name="' + c4Name + '" c4Type="' + c4TypeEsc + '" c4Technology="' + c4Tech + '" c4Description="' + c4Desc + '" label="' + labelEsc + '" id="' + id + '" ' + props + linkAttr + '>');
        lines.push('          <mxCell style="rounded=1;' + cellStyle + '" vertex="1" parent="' + parentId + '">');
        lines.push('            <mxGeometry x="' + x + '" y="' + y + '" width="' + width + '" height="' + height + '" as="geometry"/>');
        lines.push('          </mxCell>');
        lines.push('        </object>');
    } else if (shape === 'MobileDeviceLandscape') {
        // drawio has no mobile device shape, so it falls back to a rounded box.
        lines.push('        <object placeholders="1" c4Name="' + c4Name + '" c4Type="' + c4TypeEsc + '" c4Technology="' + c4Tech + '" c4Description="' + c4Desc + '" label="' + labelEsc + '" id="' + id + '" ' + props + linkAttr + '>');
        lines.push('          <mxCell style="rounded=1;' + cellStyle + '" vertex="1" parent="' + parentId + '">');
        lines.push('            <mxGeometry x="' + x + '" y="' + y + '" width="' + width + '" height="' + height + '" as="geometry"/>');
        lines.push('          </mxCell>');
        lines.push('        </object>');
    } else if (shape === 'Diamond') {
        lines.push('        <object placeholders="1" c4Name="' + c4Name + '" c4Type="' + c4TypeEsc + '" c4Technology="' + c4Tech + '" c4Description="' + c4Desc + '" label="' + labelEsc + '" id="' + id + '" ' + props + linkAttr + '>');
        lines.push('          <mxCell style="shape=rhombus;rounded=0;' + cellStyle + '" vertex="1" parent="' + parentId + '">');
        lines.push('            <mxGeometry x="' + x + '" y="' + y + '" width="' + width + '" height="' + height + '" as="geometry"/>');
        lines.push('          </mxCell>');
        lines.push('        </object>');
    } else if (shape === 'Box') {
        lines.push('        <object placeholders="1" c4Name="' + c4Name + '" c4Type="' + c4TypeEsc + '" c4Technology="' + c4Tech + '" c4Description="' + c4Desc + '" label="' + labelEsc + '" id="' + id + '" ' + props + linkAttr + '>');
        lines.push('          <mxCell style="rounded=0;' + cellStyle + '" vertex="1" parent="' + parentId + '">');
        lines.push('            <mxGeometry x="' + x + '" y="' + y + '" width="' + width + '" height="' + height + '" as="geometry"/>');
        lines.push('          </mxCell>');
        lines.push('        </object>');
    } else {
        // RoundedBox (default)
        lines.push('        <object placeholders="1" c4Name="' + c4Name + '" c4Type="' + c4TypeEsc + '" c4Technology="' + c4Tech + '" c4Description="' + c4Desc + '" label="' + labelEsc + '" id="' + id + '" ' + props + linkAttr + '>');
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
    var color = structurizr.drawio._applyOpacity(rs.color || (!darkMode ? '#444444' : '#cccccc'), rs, darkMode);
    var descFontSize = rs.fontSize || 24;
    var strokeWidth = rs.thickness || 2;
    var routing = rs.routing || 'Direct';
    var style = rs.style || 'Solid';
    // A relationship view overrides the style (structurizr-diagram.js:3577-3580).
    var jump = (rv.jump !== undefined) ? rv.jump : rs.jump;
    var position = (rv.position !== undefined) ? rv.position : rs.position;
    var labelWidth = rs.width;
    var source = rel.sourceId, dest = rel.destinationId;
    if (rv.response) { source = rel.destinationId; dest = rel.sourceId; }
    var desc = rv.description || rel.description || '';
    if (rv.order) { desc = rv.order + '. ' + desc; }
    var tech = rel.technology || '';
    var id = rv.id + '-' + (rv.order || '0');

    // Style flags: 'metadata false' hides the technology, 'description false' hides the
    // description; the two are rendered independently (structurizr-diagram.js:3554,3561).
    var showMetadata = rs.metadata !== false;
    var showDescription = rs.description !== false;
    var visibleDesc = showDescription ? desc : '';
    var symbols = structurizr.drawio._metadataSymbols(workspace);
    var visibleTech = showMetadata && tech ? (symbols.open + tech + symbols.close) : '';
    var label = '';
    if (visibleDesc && visibleTech) {
        label = '<div style="text-align: left"><div style="text-align: center"><b>' + structurizr.drawio._escapeXml(visibleDesc) + '</b></div><div style="text-align: center">' + structurizr.drawio._escapeXml(visibleTech) + '</div></div>';
    } else if (visibleDesc) {
        label = '<div style="text-align: left"><div style="text-align: center"><b>' + structurizr.drawio._escapeXml(visibleDesc) + '</b></div></div>';
    } else if (visibleTech) {
        label = '<div style="text-align: left"><div style="text-align: center">' + structurizr.drawio._escapeXml(visibleTech) + '</div></div>';
    }

    // Dashes are derived from the line style and thickness (structurizr-diagram.js
    // dashArrayForRelationship), not fixed per style.
    var dashPattern = structurizr.drawio._dashPattern(style, strokeWidth);
    var dashed = dashPattern ? '1' : '0';
    var curved = routing === 'Curved' ? '1' : '0';
    var edgeStyle = routing === 'Orthogonal' ? 'orthogonalEdgeStyle' : 'none';
    // Jump overs are off unless the style or the relationship view turns them on
    // (structurizr-diagram.js setJump), and the jump size follows the thickness.
    var jumpStyle = (jump === true) ? ('arc;jumpSize=' + (5 * strokeWidth)) : 'none';
    // Label position runs from the source (0) to the target (100); drawio places the
    // label at (geometry.x / 2 + 0.5) of the edge length (mxGraphView.getPoint).
    var labelX = (position !== undefined && position !== null) ? (2 * (Number(position) / 100) - 1) : 0;
    var c4Desc = structurizr.drawio._escapeXml(desc);
    var c4Tech = structurizr.drawio._escapeXml(tech);
    var labelEsc = structurizr.drawio._escapeXml(label);

    var linkAttr = structurizr.drawio._linkAttribute(structurizr.drawio._relationshipUrl(rel, workspace));
    lines.push('        <object placeholders="1" c4Type="Relationship" c4Technology="' + c4Tech + '" c4Description="' + c4Desc + '" label="' + labelEsc + '" id="' + id + '"' + linkAttr + '>');
    var widthStyle = labelWidth ? ('labelWidth=' + labelWidth + ';') : '';
    lines.push('          <mxCell style="endSize=20;startSize=20;jumpStyle=' + jumpStyle + ';elbow=vertical;endFill=1;whiteSpace=wrap;endArrow=block;html=1;' + structurizr.drawio._fontStyle() + 'fontSize=' + descFontSize + ';fontColor=' + color + ';align=center;arcSize=10;strokeColor=' + color + ';strokeWidth=' + strokeWidth + ';' + widthStyle + 'metaEdit=1;resizable=0;dashed=' + dashed + ';dashPattern=' + (dashPattern || '1 0') + ';rounded=0;curved=' + curved + ';edgeStyle=' + edgeStyle + ';" parent="' + parentId + '" edge="1" source="' + source + '" target="' + dest + '">');
    var vertices = rv.vertices;
    if (vertices && vertices.length > 0) {
        lines.push('            <mxGeometry x="' + labelX + '" y="0" relative="1" as="geometry">');
        lines.push('              <Array as="points">');
        for (var v = 0; v < vertices.length; v++) { lines.push('                <mxPoint x="' + vertices[v].x + '" y="' + vertices[v].y + '"/>'); }
        lines.push('              </Array>');
        lines.push('            </mxGeometry>');
    } else { lines.push('            <mxGeometry x="' + labelX + '" y="0" relative="1" as="geometry"/>'); }
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

    // 2. Обновляем только корневые группы: _updateGroupBoundary сама рекурсит в детей,
    // поэтому обход всех ключей применил бы margin к дочерней группе дважды.
    for (var key in rawGroups) {
        if (!rawGroups.hasOwnProperty(key)) continue;
        if (rawGroups[key].parent) continue;
        structurizr.drawio._updateGroupBoundary(rawGroups[key], view, workspace, darkMode);
    }

    // Плоский список для вывода: обход от корней, родитель раньше детей, каждая
    // группа ровно один раз — тот же порядок отрисовки, что и в SVG.
    var groupBoundariesList = [];
    var flattenGroups = function(g) {
        groupBoundariesList.push(g);
        if (g.children) {
            for (var ci = 0; ci < g.children.length; ci++) { flattenGroups(g.children[ci]); }
        }
    };
    for (var key in rawGroups) {
        if (!rawGroups.hasOwnProperty(key)) continue;
        if (rawGroups[key].parent) continue;
        flattenGroups(rawGroups[key]);
    }

    // Границы SS/container охватывают группы только своих элементов (в SVG каждая
    // группа вкладывается в границу того элемента, которому принадлежит).
    var groupsForElements = function(elementIds) {
        var wanted = {};
        for (var wi = 0; wi < elementIds.length; wi++) { wanted[elementIds[wi]] = true; }
        return groupBoundariesList.filter(function(g) {
            for (var ei = 0; ei < g.elementIds.length; ei++) {
                if (wanted[g.elementIds[ei]]) return true;
            }
            return false;
        });
    };

    // 3. SS boundary — с учётом group boundaries
    if (view.type === 'Container' && view.softwareSystemId) {
        var ssEls = [];
        for (var id in elementsOnDiagram) {
            if (!elementsOnDiagram.hasOwnProperty(id)) continue;
            var e = elementsOnDiagram[id].element;
            if (e.parentId === view.softwareSystemId || e.id === view.softwareSystemId) ssEls.push(id);
        }
        var b = structurizr.drawio._createBoundaryForElements(ssEls, elementsOnDiagram, view, workspace, darkMode, groupsForElements(ssEls));
        if (b) {
            var ssEl = workspace.findElementById(view.softwareSystemId);
            b.name = ssEl ? ssEl.name : 'Software System';
            b.id = view.softwareSystemId;
            b.c4Type = 'SystemScopeBoundary';
            b.label = structurizr.drawio._boundaryLabel(b.name, structurizr.drawio._boundaryMetadata(ssEl, 'Software System', null, workspace, darkMode), b.fontSize);
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
        var b = structurizr.drawio._createBoundaryForElements(cEls, elementsOnDiagram, view, workspace, darkMode, groupsForElements(cEls));
        if (b) {
            var cEl = workspace.findElementById(view.containerId);
            b.name = cEl ? cEl.name : 'Container';
            b.id = view.containerId;
            b.c4Type = 'ContainerScopeBoundary';
            b.label = structurizr.drawio._boundaryLabel(b.name, structurizr.drawio._boundaryMetadata(cEl, 'Container', null, workspace, darkMode), b.fontSize);
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
    // A view can turn all groups off with the "structurizr.groups" property
    // (structurizr-diagram.js includeGroup).
    if (view.properties && view.properties['structurizr.groups'] === 'false') {
        return {};
    }

    // The diagram nests groups only when the model defines structurizr.groupSeparator
    // (see structurizr-diagram.js useNestedGroups). Without the property a group name is
    // a single flat name, even when it contains the default separator character.
    var groupSep = (workspace.model && workspace.model.properties)
        ? workspace.model.properties['structurizr.groupSeparator']
        : undefined;
    var useNestedGroups = typeof groupSep === 'string' && groupSep.length > 0;
    var groups = {};

    // Split a group path into its segments; a flat name stays whole.
    var splitGroup = function(group) {
        return useNestedGroups ? String(group).split(groupSep) : [group];
    };

    for (var id in elementsOnDiagram) {
        if (!elementsOnDiagram.hasOwnProperty(id)) continue;
        var info = elementsOnDiagram[id], el = info.element;
        if (!el.group) continue;
        var names = splitGroup(el.group);
        var path = '';
        for (var gi = 0; gi < names.length; gi++) {
            if (!names[gi]) continue; // skip empty segments
            path += (path ? groupSep : '') + names[gi];
            if (!groups[path]) {
                groups[path] = {
                    name: names[gi],
                    fullName: path,
                    children: [],
                    parent: null,
                    elementIds: [],
                    minX: Infinity,
                    minY: Infinity,
                    maxX: -Infinity,
                    maxY: -Infinity,
                    fontSize: 24
                };
            }
        }
    }

    // Строим дерево: parent -> children. Плоские имена групп не вкладываются.
    if (useNestedGroups) {
        var groupKeys = Object.keys(groups).sort(function(a, b) { return a.length - b.length; });
        for (var i = 0; i < groupKeys.length; i++) {
            var key = groupKeys[i];
            var g = groups[key];
            // Ищем родителя по последнему вхождению разделителя.
            var lastSep = key.lastIndexOf(groupSep);
            if (lastSep > 0) {
                var parentKey = key.substring(0, lastSep);
                var parent = groups[parentKey];
                if (parent) {
                    parent.children.push(g);
                    g.parent = parent;
                }
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
        var names = splitGroup(el.group);
        var path = '';
        for (var gi = 0; gi < names.length; gi++) {
            if (!names[gi]) continue; // skip empty segments
            path += (path ? groupSep : '') + names[gi];
            var g = groups[path];
            if (g) {
                g.elementIds.push(id);
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
        g.textColor = structurizr.drawio._applyOpacity((es.color && structurizr.drawio._hasColor(es.color)) ? es.color : '#333333', es, darkMode);
        g.strokeColor = structurizr.drawio._applyOpacity((es.stroke && structurizr.drawio._hasColor(es.stroke)) ? es.stroke : '#666666', es, darkMode);
        g.strokeWidth = es.strokeWidth || 4;
        g.fontSize = es.fontSize || 24;
        // A group is Dotted by default (structurizr-ui.js default border for the Group type),
        // and square unless its style asks for a rounded box.
        g.dashPattern = structurizr.drawio._dashPattern(es.border, g.strokeWidth);
        g.cornerRadius = (es.shape === 'RoundedBox') ? 20 : 0;
        g.isGroup = true;
        g.c4Type = 'GroupScopeBoundary';
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
    var strokeColor = '#666666', textColor = '#333333', strokeWidth = 4, dashPattern = '', cornerRadius = 0;
    if (hasElements && elementIds.length > 0) {
        var first = elementsOnDiagram[elementIds[0]];
        if (first) {
            var es = structurizr.ui.findElementStyle(first.element, darkMode);
            if (es.color) textColor = es.color;
            if (es.stroke) strokeColor = es.stroke;
            if (es.strokeWidth) strokeWidth = es.strokeWidth;
            textColor = structurizr.drawio._applyOpacity(textColor, es, darkMode);
            strokeColor = structurizr.drawio._applyOpacity(strokeColor, es, darkMode);
            var border = structurizr.drawio._boundaryBorder(es, first.element, darkMode);
            dashPattern = border.dashPattern;
            cornerRadius = border.cornerRadius;
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
        fontSize: fontSize, dashPattern: dashPattern, cornerRadius: cornerRadius, isGroup: false, label: ''
    };
};

structurizr.drawio._collectDeploymentNodeBoundaries = function(view, workspace, elementsOnDiagram, boundaries, darkMode) {
    // Deployment nodes appear in view.elements as a flat list, but the model
    // nodes themselves carry nested `children`. Emitting a boundary per flat
    // entry duplicates ids for nested nodes. Instead we walk only the root
    // deployment nodes (those not referenced as a `child` on the diagram) and
    // descend recursively, so every id is emitted exactly once (post-order),
    // matching the Java MxExporter's stack-based boundary tree. View elements
    // have no parentId (only {id,x,y}), so we derive nesting from `children`.
    var dnMap = {};
    var nested = {};
    for (var id in elementsOnDiagram) {
        if (!elementsOnDiagram.hasOwnProperty(id)) continue;
        var info = elementsOnDiagram[id];
        if (info.element && info.element.type === 'DeploymentNode') {
            dnMap[id] = info.element;
            var kids = info.element.children;
            if (kids) {
                for (var ki = 0; ki < kids.length; ki++) {
                    if (kids[ki] && kids[ki].id !== undefined) nested[String(kids[ki].id)] = true;
                }
            }
        }
    }
    var seenBoundaryIds = {};
    var emitRoot = function(dn) {
        // Descend children first (post-order) and collect their bounding boxes,
        // so a parent that contains only nested deployment nodes (no direct
        // instances) still gets a frame that encompasses its children — mirrors
        // the Java MxExporter's updateDeploymentNodeBoundary aggregation.
        if (!dn || seenBoundaryIds[String(dn.id)]) return null;
        var childBoxes = [];
        if (dn.children) {
            for (var ci = 0; ci < dn.children.length; ci++) {
                var box = emitRoot(dn.children[ci]);
                if (box) childBoxes.push(box);
            }
        }
        return structurizr.drawio._processDeploymentNode(dn, view, workspace, elementsOnDiagram, boundaries, darkMode, seenBoundaryIds, childBoxes);
    };
    // Root nodes: deployment nodes not nested as a child of another on the diagram.
    for (var rid in dnMap) {
        if (!dnMap.hasOwnProperty(rid)) continue;
        if (nested[String(dnMap[rid].id)]) continue; // nested child -> handled by its root
        emitRoot(dnMap[rid]);
    }
};

structurizr.drawio._processDeploymentNode = function(dn, view, workspace, elementsOnDiagram, boundaries, darkMode, seenBoundaryIds, childBoxes) {
    var dnId = String(dn && dn.id);
    if (dnId && seenBoundaryIds[dnId]) return null;
    if (dnId) seenBoundaryIds[dnId] = true;

    // Descending into dn.children is handled by the caller (emitRoot), which walks
    // the tree post-order and passes each child's computed box via childBoxes, so
    // a parent with only nested deployment nodes still encloses them.
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, cm = 25;
    function findView(eid) { if (!view.elements) return null; for (var i = 0; i < view.elements.length; i++) { if (view.elements[i].id === eid) return view.elements[i]; } return null; }
    if (childBoxes) {
        for (var cb = 0; cb < childBoxes.length; cb++) {
            var ch = childBoxes[cb];
            minX = Math.min(minX, ch.minX); minY = Math.min(minY, ch.minY);
            maxX = Math.max(maxX, ch.maxX); maxY = Math.max(maxY, ch.maxY);
        }
    }
    if (dn.softwareSystemInstances) { for (var si = 0; si < dn.softwareSystemInstances.length; si++) { var ssi = dn.softwareSystemInstances[si], ev = findView(ssi.id); if (ev && ev.x !== undefined) { var es = structurizr.ui.findElementStyle(ssi, darkMode); var w = es.width || 450, h = (es.shape === 'Hexagon') ? Math.round(0.89 * w) : (es.height || 300); minX = Math.min(minX, ev.x); minY = Math.min(minY, ev.y); maxX = Math.max(maxX, ev.x + w); maxY = Math.max(maxY, ev.y + h); } } }
    if (dn.containerInstances) { for (var ci2 = 0; ci2 < dn.containerInstances.length; ci2++) { var ci = dn.containerInstances[ci2], ev = findView(ci.id); if (ev && ev.x !== undefined) { var es = structurizr.ui.findElementStyle(ci, darkMode); var w = es.width || 450, h = (es.shape === 'Hexagon') ? Math.round(0.89 * w) : (es.height || 300); minX = Math.min(minX, ev.x); minY = Math.min(minY, ev.y); maxX = Math.max(maxX, ev.x + w); maxY = Math.max(maxY, ev.y + h); } } }
    if (dn.infrastructureNodes) { for (var ii = 0; ii < dn.infrastructureNodes.length; ii++) { var inode = dn.infrastructureNodes[ii], ev = findView(inode.id); if (ev && ev.x !== undefined) { var es = structurizr.ui.findElementStyle(inode, darkMode); var w = es.width || 450, h = (es.shape === 'Hexagon') ? Math.round(0.89 * w) : (es.height || 300); minX = Math.min(minX, ev.x); minY = Math.min(minY, ev.y); maxX = Math.max(maxX, ev.x + w); maxY = Math.max(maxY, ev.y + h); } } }
    if (minX === Infinity) return null;
    var es = structurizr.ui.findElementStyle(dn, darkMode);
    var tc = structurizr.drawio._applyOpacity((es.color && structurizr.drawio._hasColor(es.color)) ? es.color : '#444444', es, darkMode);
    var sc = structurizr.drawio._applyOpacity((es.stroke && structurizr.drawio._hasColor(es.stroke)) ? es.stroke : '#666666', es, darkMode);
    var sw = es.strokeWidth || 4, fs = es.fontSize || 24, mfs = fs - 5;
    minX -= cm; minY -= cm; maxX += cm; maxY += cm;
    maxY += structurizr.drawio._fontHeight('Helvetica', fs);
    maxY += structurizr.drawio._fontHeight('Helvetica', mfs);
    var tech = dn.technology || '';
    var label = structurizr.drawio._boundaryLabel(dn.name || '', structurizr.drawio._boundaryMetadata(dn, 'Deployment Node', tech, workspace, darkMode), fs);
    var border = structurizr.drawio._boundaryBorder(es, dn, darkMode);
    boundaries.push({ id: dnId, name: dn.name || '', minX: minX, minY: minY, maxX: maxX, maxY: maxY,
        textColor: tc, strokeColor: sc, strokeWidth: sw, fontSize: fs,
        dashPattern: border.dashPattern, cornerRadius: border.cornerRadius, isGroup: false, label: label, technology: tech,
        c4Type: 'DeploymentNodeScopeBoundary' });
    return { id: dnId, minX: minX, minY: minY, maxX: maxX, maxY: maxY };
};

/** Bounding box of the drawn elements and boundaries. */
structurizr.drawio._contentBounds = function(view, workspace, darkMode, boundaries) {
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    if (view.elements) {
        for (var i = 0; i < view.elements.length; i++) {
            var ev = view.elements[i];
            var el = workspace.findElementById(ev.id);
            if (!el) continue;
            var es = structurizr.ui.findElementStyle(el, darkMode);
            var w = es.width || 450;
            var h = (es.shape === 'Hexagon') ? Math.round(0.89 * w) : (es.height || 300);
            var x = ev.x || 0, y = ev.y || 0;
            minX = Math.min(minX, x); minY = Math.min(minY, y);
            maxX = Math.max(maxX, x + w); maxY = Math.max(maxY, y + h);
        }
    }
    if (boundaries) {
        for (var b = 0; b < boundaries.length; b++) {
            minX = Math.min(minX, boundaries[b].minX); minY = Math.min(minY, boundaries[b].minY);
            maxX = Math.max(maxX, boundaries[b].maxX); maxY = Math.max(maxY, boundaries[b].maxY);
        }
    }
    if (minX === Infinity) { minX = 0; minY = 0; maxX = 0; maxY = 0; }
    return { minX: minX, minY: minY, maxX: maxX, maxY: maxY };
};

/**
 * Title, description and metadata text at the bottom-left of the diagram
 * (structurizr-diagram.js createDiagramMetadata/repositionDiagramMetadata).
 */
structurizr.drawio._writeDiagramMetadata = function(lines, view, workspace, darkMode, boundaries, parentId) {
    var block = structurizr.drawio._diagramMetadata(view, workspace, darkMode);
    var padding = 10;
    // The title renders on a single line, so its height ignores newlines.
    var titleText = String(block.title || '').replace(/(\r\n|\r|\n)/g, ' ');
    var titleHeight = block.title ? structurizr.drawio._textBlockHeight(titleText, block.titleFontSize) + padding : 0;
    var descriptionHeight = block.description ? structurizr.drawio._textBlockHeight(block.description, block.descriptionFontSize) + padding : 0;
    var metadataHeight = block.metadata ? structurizr.drawio._textBlockHeight(block.metadata, block.metadataFontSize) + padding : 0;
    var total = titleHeight + descriptionHeight + metadataHeight;
    if (total === 0) return;

    var label = '';
    if (block.title) {
        label += '<font style="font-size:' + block.titleFontSize + 'px" color="' + block.titleColor + '">' + structurizr.drawio._titleText(block.title) + '</font>';
    }
    if (block.description) {
        label += (label ? '<br>' : '') + '<font style="font-size:' + block.descriptionFontSize + 'px" color="' + block.descriptionColor + '">' + structurizr.drawio._labelText(block.description) + '</font>';
    }
    if (block.metadata) {
        label += (label ? '<br>' : '') + '<font style="font-size:' + block.metadataFontSize + 'px" color="' + block.metadataColor + '">' + structurizr.drawio._labelText(block.metadata) + '</font>';
    }
    if (!label) return;

    var x = 20;
    var width;
    var y;
    if (view.dimensions && view.dimensions.height) {
        y = view.dimensions.height - padding - total;
        width = Math.max(0, (view.dimensions.width || 2000) - 2 * x);
    } else {
        var bounds = structurizr.drawio._contentBounds(view, workspace, darkMode, boundaries);
        y = bounds.maxY + 40;
        width = Math.max(bounds.maxX - bounds.minX, 400);
    }

    // The text does not wrap: a long line runs past the cell, as in SVG.
    var style = 'text;html=1;' + structurizr.drawio._fontStyle() + 'strokeColor=none;fillColor=none;align=left;verticalAlign=top;whiteSpace=nowrap;rounded=0;resizable=0;metaEdit=1;pointerEvents=0;';
    lines.push('        <mxCell style="' + style + '" value="' + structurizr.drawio._escapeXml(label) + '" vertex="1" parent="' + parentId + '">');
    lines.push('          <mxGeometry x="' + x + '" y="' + y + '" width="' + width + '" height="' + total + '" as="geometry"/>');
    lines.push('        </mxCell>');
};

structurizr.drawio._writeBoundary = function(lines, boundary, parentId, workspace) {
    var w = boundary.maxX - boundary.minX, h = boundary.maxY - boundary.minY;
    // A boundary is solid unless its element style asks for a dashed or dotted border,
    // and square unless the style asks for a rounded box.
    var dashPattern = boundary.dashPattern || '';
    var dashed = dashPattern ? '1' : '0';
    var cornerRadius = boundary.cornerRadius || 0;
    var label = boundary.label;
    if (!label) {
        if (boundary.isGroup) {
            // Group boundaries carry no metadata line (structurizr-diagram.js createBoundaryForGroup).
            label = structurizr.drawio._boundaryLabel(boundary.name, '', boundary.fontSize);
        } else {
            label = structurizr.drawio._boundaryLabel(boundary.name, structurizr.drawio._metadataText(null, boundary.nameFull || 'Scope', null, workspace), boundary.fontSize);
        }
    }
    var style = 'rounded=' + (cornerRadius ? '1' : '0') + ';' + structurizr.drawio._fontStyle() + 'fontSize=' + boundary.fontSize + ';whiteSpace=wrap;html=1;dashed=' + dashed + ';arcSize=' + cornerRadius + ';fillColor=none;strokeColor=' + boundary.strokeColor + ';fontColor=' + boundary.textColor + ';strokeWidth=' + boundary.strokeWidth + ';labelBackgroundColor=none;align=left;verticalAlign=bottom;labelBorderColor=none;spacingTop=0;spacing=10;dashPattern=' + (dashPattern || '1 0') + ';metaEdit=1;rotatable=0;perimeter=rectanglePerimeter;noLabel=0;labelPadding=0;allowArrows=0;connectable=0;expand=0;recursiveResize=0;editable=1;pointerEvents=0;absoluteArcSize=1;points=[[0.25,0,0],[0.5,0,0],[0.75,0,0],[1,0.25,0],[1,0.5,0],[1,0.75,0],[0.75,1,0],[0.5,1,0],[0.25,1,0],[0,0.75,0],[0,0.5,0],[0,0.25,0]];';
    var c4Type = boundary.c4Type || 'ScopeBoundary';
    lines.push('        <object placeholders="1" c4Name="' + structurizr.drawio._escapeXml(boundary.name) + '" c4Type="' + c4Type + '" label="' + structurizr.drawio._escapeXml(label) + '" id="' + boundary.id + '">');
    lines.push('          <mxCell style="' + style + '" vertex="1" parent="' + parentId + '">');
    lines.push('            <mxGeometry x="' + boundary.minX + '" y="' + boundary.minY + '" width="' + w + '" height="' + h + '" as="geometry"/>');
    lines.push('          </mxCell>');
    lines.push('        </object>');
};