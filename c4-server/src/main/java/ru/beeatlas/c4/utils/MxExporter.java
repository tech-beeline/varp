/*
    Copyright 2025 VimpelCom PJSC

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

package ru.beeatlas.c4.utils;

import java.util.ArrayDeque;
import java.util.Collection;
import java.util.Collections;
import java.util.Deque;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.Stack;
import java.util.UUID;
import java.util.stream.Collectors;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import com.structurizr.export.AbstractDiagramExporter;
import com.structurizr.export.Diagram;
import com.structurizr.export.IndentingWriter;
import com.structurizr.model.*;
import com.structurizr.util.StringUtils;
import com.structurizr.view.DeploymentView;
import com.structurizr.view.ElementStyle;
import com.structurizr.view.ElementView;
import com.structurizr.view.LineStyle;
import com.structurizr.view.ModelView;
import com.structurizr.view.RelationshipStyle;
import com.structurizr.view.RelationshipView;
import com.structurizr.view.Routing;
import com.structurizr.view.Shape;
import com.structurizr.view.Vertex;
import org.apache.commons.text.StringSubstitutor;

import static org.apache.commons.text.StringEscapeUtils.escapeHtml4;

/**
 * Exports Structurizr views to .drawio mxfile format.
 */
public class MxExporter extends AbstractDiagramExporter {

    private static final float HEXAGON_RATIO = 0.89f;

    private static final Logger logger = LoggerFactory.getLogger(MxExporter.class);

    private static final String DEFAULT_FONT = "Helvetica";
    private static final int BOUNDARY_FONT_SIZE = 24;
    private static final int BOUNDARYMETA_FONT_SIZE = BOUNDARY_FONT_SIZE - 5;
    private final String rootId = UUID.randomUUID().toString();
    private final String parentId = UUID.randomUUID().toString();

    private class GroupBoundary {
        public GroupBoundary(String name, String fullName) {
            this.name = name;
            this.fullName = fullName;
        }
        public String name;
        public String fullName;
        public Map<String, GroupBoundary> groupBoundaries = new HashMap<>();
        public int minX = Integer.MAX_VALUE;
        public int minY = Integer.MAX_VALUE;
        public int maxX = Integer.MIN_VALUE;
        public int maxY = Integer.MIN_VALUE;
    }

    private class SoftwareSystemBoundary {
        SoftwareSystem softwareSystem;
        public Set<GroupBoundary> groupBoundaries = new HashSet<>();
        public List<Element> elements = new LinkedList<>();
        public SoftwareSystemBoundary(SoftwareSystem softwareSystem) {
            this.softwareSystem = softwareSystem;
        }
    }

    private class DeploymentNodeBoundary {
        public int minX = Integer.MAX_VALUE;
        public int minY = Integer.MAX_VALUE;
        public int maxX = Integer.MIN_VALUE;
        public int maxY = Integer.MIN_VALUE;
        public DeploymentNode deploymentNode;
        public Set<GroupBoundary> groupBoundaries = new HashSet<>();
        public List<Element> elements = new LinkedList<>();
        public List<DeploymentNodeBoundary> deploymentNodes = new LinkedList<>();
        public DeploymentNodeBoundary(DeploymentNode deploymentNode) {
            this.deploymentNode = deploymentNode;
        }
    }

    private class ContainerBoundary {
        Container container;
        public Set<GroupBoundary> groupBoundaries = new HashSet<>();
        public List<Element> elements = new LinkedList<>();
        public ContainerBoundary(Container container) {
            this.container = container;
        }
    }

    private HashMap<String, GroupBoundary> groupBoundaries = new HashMap<>();
    private LinkedList<SoftwareSystemBoundary> softwareSystemBoundaries = new LinkedList<>();
    private LinkedList<ContainerBoundary> containerBoundaries = new LinkedList<>();
    private LinkedList<DeploymentNodeBoundary> deploymentNodeBoundaries = new LinkedList<>();
    private Deque<DeploymentNodeBoundary> deploymentNodeBoundaryStack = new ArrayDeque<>();

    private int clusterInternalMargin = 25;

    public MxExporter() {
    }

    public void setClusterInternalMargin(int clusterInternalMargin) {
        this.clusterInternalMargin = clusterInternalMargin;
    }

    @Override
    protected void writeHeader(ModelView view, IndentingWriter writer) {
        writer.writeLine("<mxfile host=\"Electron\" agent=\"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) draw.io/28.0.6 Chrome/138.0.7204.100 Electron/37.2.3 Safari/537.36\" version=\"28.0.6\">");
        writer.indent();
        Map<String, String> values = new HashMap<>();
        values.put("id", view.getKey());
        values.put("name", view.getName());
        values.put("pageWidth", String.valueOf(view.getDimensions().getWidth()));
        values.put("pageHeight", String.valueOf(view.getDimensions().getHeight()));
        values.put("rootId", rootId);
        values.put("parentId", parentId);
        StringSubstitutor stringSubstitutor = new StringSubstitutor(values);
        writer.writeLine(stringSubstitutor.replace("<diagram name='${name}' id='${id}'>"));
        writer.indent();
        writer.writeLine(stringSubstitutor.replace("<mxGraphModel dx='0' dy='0' grid='1' gridSize='10' guides='1' tooltips='1' connect='1' arrows='1' fold='1' page='1' pageScale='1' pageWidth='${pageWidth}' pageHeight='${pageHeight}' math='0' shadow='0'>"));
        writer.indent();
        writer.writeLine("<root>");
        writer.indent();
        writer.writeLine(stringSubstitutor.replace("<mxCell id='${rootId}'/>"));
        writer.writeLine(stringSubstitutor.replace("<mxCell id='${parentId}' parent='${rootId}'/>"));
    }

    private void updateGroupBoundary(GroupBoundary groupBoundary, ModelView view) {
        for(GroupBoundary gb : groupBoundary.groupBoundaries.values()) {
            updateGroupBoundary(gb, view);
        }
        for(GroupBoundary gb : groupBoundary.groupBoundaries.values()) {
            groupBoundary.minX = Math.min(groupBoundary.minX, gb.minX);
            groupBoundary.minY = Math.min(groupBoundary.minY, gb.minY);
            groupBoundary.maxX = Math.max(groupBoundary.maxX, gb.maxX);
            groupBoundary.maxY = Math.max(groupBoundary.maxY, gb.maxY);
        }

        int fontSize = BOUNDARY_FONT_SIZE;
        int metadataFontSize = BOUNDARYMETA_FONT_SIZE;

        ElementStyle es = getGroupStyle(groupBoundary, view);

        if (es != null) {
            if(es.getFontSize() != null) {
                fontSize = es.getFontSize();
                metadataFontSize = fontSize - 5;
            }
        }

        groupBoundary.minX -= clusterInternalMargin;
        groupBoundary.minY -= clusterInternalMargin;
        groupBoundary.maxX += clusterInternalMargin;
        groupBoundary.maxY += clusterInternalMargin;
        groupBoundary.maxY += C4Utils.getFontHeight(DEFAULT_FONT, fontSize);
        groupBoundary.maxY += C4Utils.getFontHeight(DEFAULT_FONT, metadataFontSize);
    }

    private ElementStyle getGroupStyle(GroupBoundary group, ModelView view) {
        // is there a style for the group?
        ElementStyle groupStyle = view.getViewSet().getConfiguration().getStyles().findElementStyle("Group:" + group.fullName);

        if (groupStyle == null || StringUtils.isNullOrEmpty(groupStyle.getColor())) {
            // no, so is there a default group style?
            groupStyle = view.getViewSet().getConfiguration().getStyles().findElementStyle("Group");
        }
        return groupStyle;
    }

    private void writeGroupBoundary(GroupBoundary group, ModelView view, IndentingWriter writer) {

        for(GroupBoundary gb : group.groupBoundaries.values()) {
            writeGroupBoundary(gb, view, writer);
        }

        ElementStyle es = getGroupStyle(group, view);

        String color = "#333333";
        String stroke = "#666666";
        int strokeWidth = 4;
        int fontSize = BOUNDARY_FONT_SIZE;
        int metadataFontSize = BOUNDARYMETA_FONT_SIZE;

        if (es != null) {
            if(!StringUtils.isNullOrEmpty(es.getColor())) {
                color = es.getColor();
            }
            if(!StringUtils.isNullOrEmpty(es.getStroke())) {
                stroke = es.getStroke();
            }
            if(es.getStrokeWidth() != null) {
                strokeWidth = es.getStrokeWidth();
            }
            if(es.getFontSize() != null) {
                fontSize = es.getFontSize();
                metadataFontSize = fontSize - 5;
            }
        }

        Map<String, String> values = new HashMap<>();
        values.put("id", String.valueOf(UUID.randomUUID()));
        values.put("c4Name", group.name);
        values.put("fontSize", String.valueOf(fontSize));
        String label = new StringSubstitutor(values).replace("<font style=\"font-size:${fontSize}px\"><b><div style=\"text-align: left\">%c4Name%</div></b></font><div style=\"text-align: left\">[%c4Application%]</div>");
        values.put("label", escapeHtml4(label));
        values.put("metadataFontSize", String.valueOf(metadataFontSize));
        values.put("stroke", stroke);
        values.put("color", color);
        values.put("strokeWidth", String.valueOf(strokeWidth));
        values.put("x", String.valueOf(group.minX));
        values.put("y", String.valueOf(group.minY));
        values.put("width", String.valueOf(group.maxX - group.minX));
        values.put("height", String.valueOf(group.maxY - group.minY));
        values.put("parentId", parentId);
        
        StringSubstitutor stringSubstitutor = new StringSubstitutor(values);
        writer.writeLine(stringSubstitutor.replace("<object placeholders='1' c4Name='${c4Name}' c4Type='GroupScopeBoundary' c4Application='Group' label='${label}' id='${id}'>"));
        writer.indent();
        writer.writeLine(stringSubstitutor.replace("<mxCell style='rounded=1;fontSize=${fontSize};whiteSpace=wrap;html=1;dashed=1;arcSize=20;fillColor=none;strokeColor=${stroke};fontColor=%{color};strokeWidth=${strokeWidth};labelBackgroundColor=none;align=left;verticalAlign=bottom;labelBorderColor=none;spacingTop=0;spacing=10;dashPattern=1 2;metaEdit=1;rotatable=0;perimeter=rectanglePerimeter;noLabel=0;labelPadding=0;allowArrows=0;connectable=0;expand=0;recursiveResize=0;editable=1;pointerEvents=0;absoluteArcSize=1;points=[[0.25,0,0],[0.5,0,0],[0.75,0,0],[1,0.25,0],[1,0.5,0],[1,0.75,0],[0.75,1,0],[0.5,1,0],[0.25,1,0],[0,0.75,0],[0,0.5,0],[0,0.25,0]];' vertex='1' parent='${parentId}'>"));
        writer.indent();
        writer.writeLine(stringSubstitutor.replace("<mxGeometry x='${x}' y='${y}' width='${width}' height='${height}' as='geometry' />"));
        writer.outdent();
        writer.writeLine("</mxCell>");
        writer.outdent();
        writer.writeLine("</object>");
    }

    private void writeSoftwareSystemBoundary(SoftwareSystemBoundary softwareSystemBoundary, ModelView view, IndentingWriter writer) {
        int minX = Integer.MAX_VALUE;
        int minY = Integer.MAX_VALUE;
        int maxX = Integer.MIN_VALUE;
        int maxY = Integer.MIN_VALUE;
        for(Element e : softwareSystemBoundary.elements) {
            ElementView ev = view.getElementView(e);
            if (e instanceof StaticStructureElementInstance elementInstance) {
                e = elementInstance.getElement();
            }
            ElementStyle es = view.getViewSet().getConfiguration().getStyles().findElementStyle(e);            
            minX = Math.min(minX, ev.getX());
            minY = Math.min(minY, ev.getY());
            maxX = Math.max(maxX, ev.getX() + es.getWidth());
            int height = (es.getShape() == Shape.Hexagon) ? (int) (HEXAGON_RATIO * es.getWidth()) : es.getHeight();
            maxY = Math.max(maxY, ev.getY() + height);
        }

        for(GroupBoundary gb : softwareSystemBoundary.groupBoundaries) {
            minX = Math.min(minX, gb.minX);
            minY = Math.min(minY, gb.minY);
            maxX = Math.max(maxX, gb.maxX);
            maxY = Math.max(maxY, gb.maxY);
        }

        int fontSize = BOUNDARY_FONT_SIZE;
        int metadataFontSize = BOUNDARYMETA_FONT_SIZE;

        minX -= clusterInternalMargin;
        minY -= clusterInternalMargin;
        maxX += clusterInternalMargin;
        maxY += clusterInternalMargin;
        maxY += C4Utils.getFontHeight(DEFAULT_FONT, fontSize);
        maxY += C4Utils.getFontHeight(DEFAULT_FONT, metadataFontSize);

        String color = "#333333";
        String stroke = "#666666";
        int strokeWidth = 4;
        ElementStyle es = view.getViewSet().getConfiguration().getStyles().findElementStyle(softwareSystemBoundary.softwareSystem);
        if(!StringUtils.isNullOrEmpty(es.getColor())) {
            color = es.getColor();
        }        
        if(!StringUtils.isNullOrEmpty(es.getStroke())) {
            stroke = es.getStroke();
        }
        if(es.getStrokeWidth() != null) {
            strokeWidth = es.getStrokeWidth();
        }
        
        Map<String, String> values = new HashMap<>();
        values.put("id", softwareSystemBoundary.softwareSystem.getId());
        values.put("c4Name", softwareSystemBoundary.softwareSystem.getName());
        values.put("fontSize", String.valueOf(fontSize));
        values.put("metadataFontSize", String.valueOf(metadataFontSize));
        values.put("stroke", stroke);
        values.put("color", color);
        values.put("strokeWidth", String.valueOf(strokeWidth));
        values.put("x", String.valueOf(minX));
        values.put("y", String.valueOf(minY));
        values.put("width", String.valueOf(maxX - minX));
        values.put("height", String.valueOf(maxY - minY));
        values.put("parentId", parentId);
        String label = new StringSubstitutor(values).replace("<font style=\"font-size:${fontSize}px\"><b><div style=\"text-align: left\">%c4Name%</div></b></font><div style=\"text-align: left\">[%c4Application%]</div>");
        values.put("label", escapeHtml4(label));

        StringSubstitutor stringSubstitutor = new StringSubstitutor(values);
        writer.writeLine(stringSubstitutor.replace("<object placeholders='1' c4Name='${c4Name}' c4Type='SystemScopeBoundary' c4Application='Software System' label='${label}' id='${id}'>"));
        writer.indent();
        writer.writeLine(stringSubstitutor.replace("<mxCell style='rounded=1;fontSize=${fontSize};whiteSpace=wrap;html=1;dashed=1;arcSize=20;fillColor=none;strokeColor=${stroke};fontColor=%{color};strokeWidth=${strokeWidth};labelBackgroundColor=none;align=left;verticalAlign=bottom;labelBorderColor=none;spacingTop=0;spacing=10;dashPattern=8 8;metaEdit=1;rotatable=0;perimeter=rectanglePerimeter;noLabel=0;labelPadding=0;allowArrows=0;connectable=0;expand=0;recursiveResize=0;editable=1;pointerEvents=0;absoluteArcSize=1;points=[[0.25,0,0],[0.5,0,0],[0.75,0,0],[1,0.25,0],[1,0.5,0],[1,0.75,0],[0.75,1,0],[0.5,1,0],[0.25,1,0],[0,0.75,0],[0,0.5,0],[0,0.25,0]];' vertex='1' parent='${parentId}'>"));
        writer.indent();
        writer.writeLine(stringSubstitutor.replace("<mxGeometry x='${x}' y='${y}' width='${width}' height='${height}' as='geometry' />"));
        writer.outdent();
        writer.writeLine("</mxCell>");
        writer.outdent();
        writer.writeLine("</object>");
    }

    private void writeContainerBoundary(ContainerBoundary containerBoundary, ModelView view, IndentingWriter writer) {
        int minX = Integer.MAX_VALUE;
        int minY = Integer.MAX_VALUE;
        int maxX = Integer.MIN_VALUE;
        int maxY = Integer.MIN_VALUE;
        for(Element e : containerBoundary.elements) {
            ElementView ev = view.getElementView(e);
            if (e instanceof StaticStructureElementInstance elementInstance) {
                e = elementInstance.getElement();
            }
            ElementStyle es = view.getViewSet().getConfiguration().getStyles().findElementStyle(e);
            minX = Math.min(minX, ev.getX());
            minY = Math.min(minY, ev.getY());
            maxX = Math.max(maxX, ev.getX() + es.getWidth());
            int height = (es.getShape() == Shape.Hexagon) ? (int) (HEXAGON_RATIO * es.getWidth()) : es.getHeight();
            maxY = Math.max(maxY, ev.getY() + height);
        }

        for(GroupBoundary gb : containerBoundary.groupBoundaries) {
            minX = Math.min(minX, gb.minX);
            minY = Math.min(minY, gb.minY);
            maxX = Math.max(maxX, gb.maxX);
            maxY = Math.max(maxY, gb.maxY);
        }

        int fontSize = BOUNDARY_FONT_SIZE;
        int metadataFontSize = BOUNDARYMETA_FONT_SIZE;

        minX -= clusterInternalMargin;
        minY -= clusterInternalMargin;
        maxX += clusterInternalMargin;
        maxY += clusterInternalMargin;
        maxY += C4Utils.getFontHeight(DEFAULT_FONT, fontSize);
        maxY += C4Utils.getFontHeight(DEFAULT_FONT, metadataFontSize);

        String color = "#333333";
        String stroke = "#666666";
        int strokeWidth = 4;
        ElementStyle es = view.getViewSet().getConfiguration().getStyles().findElementStyle(containerBoundary.container);
        if(!StringUtils.isNullOrEmpty(es.getColor())) {
            color = es.getColor();
        }
        if(!StringUtils.isNullOrEmpty(es.getStroke())) {
            stroke = es.getStroke();
        }
        if(es.getStrokeWidth() != null) {
            strokeWidth = es.getStrokeWidth();
        }

        Map<String, String> values = new HashMap<>();
        values.put("id", containerBoundary.container.getId());
        values.put("c4Name", containerBoundary.container.getName());
        values.put("fontSize", String.valueOf(fontSize));
        String label = new StringSubstitutor(values).replace("<font style=\"font-size:${fontSize}px\"><b><div style=\"text-align: left\">%c4Name%</div></b></font><div style=\"text-align: left\">[%c4Application%]</div>");
        values.put("label", escapeHtml4(label));
        values.put("metadataFontSize", String.valueOf(metadataFontSize));
        values.put("stroke", stroke);
        values.put("color", color);
        values.put("strokeWidth", String.valueOf(strokeWidth));
        values.put("x", String.valueOf(minX));
        values.put("y", String.valueOf(minY));
        values.put("width", String.valueOf(maxX - minX));
        values.put("height", String.valueOf(maxY - minY));
        values.put("parentId", parentId);
        
        StringSubstitutor stringSubstitutor = new StringSubstitutor(values);
        writer.writeLine(stringSubstitutor.replace("<object placeholders='1' c4Name='${c4Name}' c4Type='ContainerScopeBoundary' c4Application='Container' label='${label}' id='${id}'>"));
        writer.indent();
        writer.writeLine(stringSubstitutor.replace("<mxCell style='rounded=1;fontSize=${fontSize};whiteSpace=wrap;html=1;dashed=1;arcSize=20;fillColor=none;strokeColor=${stroke};fontColor=%{color};strokeWidth=${strokeWidth};labelBackgroundColor=none;align=left;verticalAlign=bottom;labelBorderColor=none;spacingTop=0;spacing=10;dashPattern=8 8;metaEdit=1;rotatable=0;perimeter=rectanglePerimeter;noLabel=0;labelPadding=0;allowArrows=0;connectable=0;expand=0;recursiveResize=0;editable=1;pointerEvents=0;absoluteArcSize=1;points=[[0.25,0,0],[0.5,0,0],[0.75,0,0],[1,0.25,0],[1,0.5,0],[1,0.75,0],[0.75,1,0],[0.5,1,0],[0.25,1,0],[0,0.75,0],[0,0.5,0],[0,0.25,0]];' vertex='1' parent='${parentId}'>"));
        writer.indent();
        writer.writeLine(stringSubstitutor.replace("<mxGeometry x='${x}' y='${y}' width='${width}' height='${height}' as='geometry' />"));
        writer.outdent();
        writer.writeLine("</mxCell>");
        writer.outdent();
        writer.writeLine("</object>");
    }

    @Override
    protected void writeFooter(ModelView view, IndentingWriter writer) {
        for(GroupBoundary gb : groupBoundaries.values()) {
            updateGroupBoundary(gb, view);
        }
        for(GroupBoundary gb : groupBoundaries.values()) {
            writeGroupBoundary(gb, view, writer);
        }
        for(SoftwareSystemBoundary ssb : softwareSystemBoundaries) {
            writeSoftwareSystemBoundary(ssb, view, writer);
        }
        for(ContainerBoundary cb : containerBoundaries) {
            writeContainerBoundary(cb, view, writer);
        }
        for(DeploymentNodeBoundary dnb : deploymentNodeBoundaries) {
            updateDeploymentNodeBoundary(dnb, view);
        }
        for(DeploymentNodeBoundary dnb : deploymentNodeBoundaries) {
            writeDeploymentNodeBoundary(dnb, view, writer);
        }        
        writer.outdent();
        writer.writeLine("</root>");
        writer.outdent();
        writer.writeLine("</mxGraphModel>");
        writer.outdent();
        writer.writeLine("</diagram>");
        writer.outdent();
        writer.writeLine("</mxfile>");
    }

    @Override
    protected void startEnterpriseBoundary(ModelView view, String enterpriseName, IndentingWriter writer) {
    }

    @Override
    protected void endEnterpriseBoundary(ModelView view, IndentingWriter writer) {
    }

    @Override
    protected void startGroupBoundary(ModelView view, String group, IndentingWriter writer) {
        String groupSeparator = view.getModel().getProperties().getOrDefault(GROUP_SEPARATOR_PROPERTY_NAME, "");
        String[] groups = (groupSeparator.isEmpty()) ? Collections.singletonList(group).toArray(String[]::new) : group.split(groupSeparator);
        String fullName = "";
        Map<String, GroupBoundary> groupBoundariesRoot = groupBoundaries;
        for(String groupName : groups) {
            GroupBoundary gb = groupBoundariesRoot.get(groupName);
            fullName += groupName;
            if(gb == null) {
                gb = new GroupBoundary(groupName, fullName);
                SoftwareSystemBoundary softwareSystemBoundary = softwareSystemBoundaries.peekLast();
                if(softwareSystemBoundary != null) {
                    softwareSystemBoundary.groupBoundaries.add(gb);
                }
                ContainerBoundary containerBoundary = containerBoundaries.peekLast();
                if(containerBoundary != null) {
                    containerBoundary.groupBoundaries.add(gb);
                }
                if(deploymentNodeBoundaryStack.isEmpty() == false) {
                    DeploymentNodeBoundary deploymentNodeBoundary = deploymentNodeBoundaryStack.peek();
                    deploymentNodeBoundary.groupBoundaries.add(gb);
                }
                groupBoundariesRoot.put(groupName, gb);
            }
            fullName += groupSeparator;
            groupBoundariesRoot = gb.groupBoundaries;
        }

        for (ElementView ev : view.getElements()) {
            GroupableElement ge = (GroupableElement)ev.getElement();
            if(ge.getGroup() == null) {
                continue;
            }
            Element e = ev.getElement();
            if (e instanceof StaticStructureElementInstance elementInstance) {
                e = elementInstance.getElement();
            }
            ElementStyle es = view.getViewSet().getConfiguration().getStyles().findElementStyle(e);            
            Shape shape = es.getShape();
            groups = (groupSeparator.isEmpty()) ? Collections.singletonList(ge.getGroup()).toArray(String[]::new) : ge.getGroup().split(groupSeparator);
            groupBoundariesRoot = groupBoundaries;
            for(String groupName : groups) {
                GroupBoundary gb = groupBoundariesRoot.get(groupName);
                if(gb == null) {
                    break;
                }
                gb.minX = Math.min(gb.minX, ev.getX());
                gb.minY = Math.min(gb.minY, ev.getY());
                gb.maxX = Math.max(gb.maxX, ev.getX() + es.getWidth());
                int height = (shape == Shape.Hexagon) ? (int) (HEXAGON_RATIO * es.getWidth()) : es.getHeight();
                gb.maxY = Math.max(gb.maxY, ev.getY() + height);
                groupBoundariesRoot = gb.groupBoundaries;
            }
        }
    }

    @Override
    protected void endGroupBoundary(ModelView view, IndentingWriter writer) {
    }

    @Override
    protected void startSoftwareSystemBoundary(ModelView view, SoftwareSystem softwareSystem, IndentingWriter writer) {
        SoftwareSystemBoundary softwareSystemBoundary = new SoftwareSystemBoundary(softwareSystem);
        softwareSystemBoundaries.add(softwareSystemBoundary);
    }

    @Override
    protected void endSoftwareSystemBoundary(ModelView view, IndentingWriter writer) {
    }

    @Override
    protected void startContainerBoundary(ModelView view, Container container, IndentingWriter writer) {
        ContainerBoundary containerBoundary = new ContainerBoundary(container);
        containerBoundaries.add(containerBoundary);
    }

    @Override
    protected void endContainerBoundary(ModelView view, IndentingWriter writer) {
    }

    @Override
    protected void startDeploymentNodeBoundary(DeploymentView view, DeploymentNode deploymentNode, IndentingWriter writer) {
        DeploymentNodeBoundary newDeploymentNodeBoundary = new DeploymentNodeBoundary(deploymentNode);
        
        if(deploymentNodeBoundaryStack.isEmpty() == true) {
            deploymentNodeBoundaries.add(newDeploymentNodeBoundary);
        } else {
            DeploymentNodeBoundary deploymentNodeBoundary = deploymentNodeBoundaryStack.peek();
            deploymentNodeBoundary.deploymentNodes.add(newDeploymentNodeBoundary);
        }

        deploymentNodeBoundaryStack.push(newDeploymentNodeBoundary);
    }

    @Override
    protected void endDeploymentNodeBoundary(ModelView view, IndentingWriter writer) {
        deploymentNodeBoundaryStack.pop();
    }

    private void writeDeploymentNodeBoundary(DeploymentNodeBoundary deploymentNodeBoundary, ModelView view, IndentingWriter writer) {
        for(DeploymentNodeBoundary dnb : deploymentNodeBoundary.deploymentNodes) {
            writeDeploymentNodeBoundary(dnb, view, writer);
        }

        String color = "#444444";
        String stroke = "#666666";
        int strokeWidth = 4;
        int fontSize = BOUNDARY_FONT_SIZE;
        int metadataFontSize = BOUNDARYMETA_FONT_SIZE;

        ElementStyle es = view.getViewSet().getConfiguration().getStyles().findElementStyle(deploymentNodeBoundary.deploymentNode);

        if(es != null) {
            if(!StringUtils.isNullOrEmpty(es.getColor())) {
                color = es.getColor();
            }
            if(!StringUtils.isNullOrEmpty(es.getStroke())) {
                stroke = es.getStroke();
            } 
            if(es.getStrokeWidth() != null) {
                strokeWidth = es.getStrokeWidth();
            }
        }

        Map<String, String> values = new HashMap<>();
        values.put("id", deploymentNodeBoundary.deploymentNode.getId());
        values.put("c4Name", deploymentNodeBoundary.deploymentNode.getName());
        values.put("fontSize", String.valueOf(fontSize));
        values.put("metadataFontSize", String.valueOf(metadataFontSize));
        values.put("stroke", stroke);
        values.put("color", color);
        values.put("strokeWidth", String.valueOf(strokeWidth));
        values.put("x", String.valueOf(deploymentNodeBoundary.minX));
        values.put("y", String.valueOf(deploymentNodeBoundary.minY));
        values.put("width", String.valueOf(deploymentNodeBoundary.maxX - deploymentNodeBoundary.minX));
        values.put("height", String.valueOf(deploymentNodeBoundary.maxY - deploymentNodeBoundary.minY));
        values.put("parentId", parentId);
        String label = new StringSubstitutor(values).replace("<font style=\"font-size:${fontSize}px\"><b><div style=\"text-align: left\">%c4Name%</div></b></font><div style=\"text-align: left\">[%c4Application%]</div>");
        values.put("label", escapeHtml4(label));

        StringSubstitutor stringSubstitutor = new StringSubstitutor(values);
        writer.writeLine(stringSubstitutor.replace("<object placeholders='1' c4Name='${c4Name}' c4Type='DeploymentNodeScopeBoundary' c4Application='DeploymentNode' label='${label}' id='${id}'>"));
        writer.indent();
        writer.writeLine(stringSubstitutor.replace("<mxCell style='rounded=1;fontSize=${fontSize};whiteSpace=wrap;html=1;dashed=1;arcSize=20;fillColor=none;strokeColor=${stroke};fontColor=%{color};strokeWidth=${strokeWidth};labelBackgroundColor=none;align=left;verticalAlign=bottom;labelBorderColor=none;spacingTop=0;spacing=10;dashPattern=8 8;metaEdit=1;rotatable=0;perimeter=rectanglePerimeter;noLabel=0;labelPadding=0;allowArrows=0;connectable=0;expand=0;recursiveResize=0;editable=1;pointerEvents=0;absoluteArcSize=1;points=[[0.25,0,0],[0.5,0,0],[0.75,0,0],[1,0.25,0],[1,0.5,0],[1,0.75,0],[0.75,1,0],[0.5,1,0],[0.25,1,0],[0,0.75,0],[0,0.5,0],[0,0.25,0]];' vertex='1' parent='${parentId}'>"));
        writer.indent();
        writer.writeLine(stringSubstitutor.replace("<mxGeometry x='${x}' y='${y}' width='${width}' height='${height}' as='geometry' />"));
        writer.outdent();
        writer.writeLine("</mxCell>");
        writer.outdent();
        writer.writeLine("</object>");
    }

    private void updateDeploymentNodeBoundary(DeploymentNodeBoundary deploymentNodeBoundary, ModelView view) {
        for(DeploymentNodeBoundary dnb : deploymentNodeBoundary.deploymentNodes) {
            updateDeploymentNodeBoundary(dnb, view);
            deploymentNodeBoundary.minX = Math.min(deploymentNodeBoundary.minX, dnb.minX);
            deploymentNodeBoundary.minY = Math.min(deploymentNodeBoundary.minY, dnb.minY);
            deploymentNodeBoundary.maxX = Math.max(deploymentNodeBoundary.maxX, dnb.maxX);
            deploymentNodeBoundary.maxY = Math.max(deploymentNodeBoundary.maxY, dnb.maxY);
        }
        for(Element e : deploymentNodeBoundary.elements) {
            ElementView ev = view.getElementView(e);
            if (e instanceof StaticStructureElementInstance elementInstance) {
                e = elementInstance.getElement();
            }
            ElementStyle es = view.getViewSet().getConfiguration().getStyles().findElementStyle(e);
            deploymentNodeBoundary.minX = Math.min(deploymentNodeBoundary.minX, ev.getX());
            deploymentNodeBoundary.minY = Math.min(deploymentNodeBoundary.minY, ev.getY());
            deploymentNodeBoundary.maxX = Math.max(deploymentNodeBoundary.maxX, ev.getX() + es.getWidth());
            int height = (es.getShape() == Shape.Hexagon) ? (int) (HEXAGON_RATIO * es.getWidth()) : es.getHeight();
            deploymentNodeBoundary.maxY = Math.max(deploymentNodeBoundary.maxY, ev.getY() + height);
        }
        for(GroupBoundary gb : deploymentNodeBoundary.groupBoundaries) {
            deploymentNodeBoundary.minX = Math.min(deploymentNodeBoundary.minX, gb.minX);
            deploymentNodeBoundary.minY = Math.min(deploymentNodeBoundary.minY, gb.minY);
            deploymentNodeBoundary.maxX = Math.max(deploymentNodeBoundary.maxX, gb.maxX);
            deploymentNodeBoundary.maxY = Math.max(deploymentNodeBoundary.maxY, gb.maxY);
        }

        int fontSize = BOUNDARY_FONT_SIZE;
        int metadataFontSize = BOUNDARYMETA_FONT_SIZE;

        deploymentNodeBoundary.minX -= clusterInternalMargin;
        deploymentNodeBoundary.minY -= clusterInternalMargin;
        deploymentNodeBoundary.maxX += clusterInternalMargin;
        deploymentNodeBoundary.maxY += clusterInternalMargin;
        deploymentNodeBoundary.maxY += C4Utils.getFontHeight(DEFAULT_FONT, fontSize);
        deploymentNodeBoundary.maxY += C4Utils.getFontHeight(DEFAULT_FONT, metadataFontSize);
    }

    @Override
    protected void writeElement(ModelView view, Element element, IndentingWriter writer) {
        SoftwareSystemBoundary softwareSystemBoundary = softwareSystemBoundaries.peekLast();
        if(softwareSystemBoundary != null) {
            softwareSystemBoundary.elements.add(element);
        }
        ContainerBoundary containerBoundary = containerBoundaries.peekLast();
        if(containerBoundary != null) {
            containerBoundary.elements.add(element);
        }
        if(deploymentNodeBoundaryStack.isEmpty() == false) {
            DeploymentNodeBoundary deploymentNodeBoundary = deploymentNodeBoundaryStack.peek();
            deploymentNodeBoundary.elements.add(element);
        }

        ElementStyle es = view.getViewSet().getConfiguration().getStyles().findElementStyle(element);
        ElementView ev = view.getElementView(element);
        String id = element.getId();

        if (element instanceof StaticStructureElementInstance elementInstance) {
            element = elementInstance.getElement();
        }

        int nameFontSize = es.getFontSize() + 10;
        int metadataFontSize = es.getFontSize() - 5;
        int descriptionFontSize = es.getFontSize();
        String color = es.getColor();
        String stroke = es.getStroke();
        String background = es.getBackground();

        Shape shape = view.getViewSet().getConfiguration().getStyles().findElementStyle(element).getShape();
        String name = escapeHtml4(element.getName());
        if(name == null) {
            name = "";
        }        
        String description = escapeHtml4(element.getDescription());
        if(description == null) {
            description = "";
        }

        Map<String, String> values = new HashMap<>();
        values.put("id", id);
        values.put("c4Name", name);
        values.put("nameFontSize", String.valueOf(nameFontSize));
        values.put("metadataFontSize", String.valueOf(metadataFontSize));
        values.put("descriptionFontSize", String.valueOf(descriptionFontSize));
        values.put("color", color);
        values.put("background", background);
        values.put("stroke", stroke);
        values.put("x", String.valueOf(ev.getX()));
        values.put("y", String.valueOf(ev.getY()));
        values.put("width", String.valueOf(es.getWidth()));
        values.put("height", String.valueOf(es.getHeight()));
        values.put("parentId", parentId);
        values.put("c4Description", description == null ? "" : description);

        if(element instanceof Person person) {
            if(!person.getProperties().isEmpty()) {
                String properties = propertiesToString(person.getProperties());
                values.put("properties", properties);
            }
            person(writer, values);
        } else if(element instanceof Container container) {
            String technology = escapeHtml4(container.getTechnology());
            if(technology == null) {
                technology = "";
            }
            values.put("c4Type", "Container");
            values.put("c4Technology", technology);
            if(!container.getProperties().isEmpty()) {
                String properties = propertiesToString(container.getProperties());
                values.put("properties", properties);
            }
            elementShape(shape, writer, values);
        } else if(element instanceof SoftwareSystem softwareSystem) {
            values.put("c4Type", "Software System");
            if(!softwareSystem.getProperties().isEmpty()) {
                String properties = propertiesToString(softwareSystem.getProperties());
                values.put("properties", properties);
            }
            elementShape(shape, writer, values);
        } else if(element instanceof Component component) {
            String technology = escapeHtml4(component.getTechnology());
            if(technology == null) {
                technology = "";
            }            
            values.put("c4Type", "Component");
            values.put("c4Technology", technology);
            if(!component.getProperties().isEmpty()) {
                String properties = propertiesToString(component.getProperties());
                values.put("properties", properties);
            }            
            elementShape(shape, writer, values);
        }
    }

    private String propertiesToString(Map<String, String> properties) {
        return properties.entrySet().stream()
            .map(entry -> entry.getKey() + "='" + entry.getValue() + "'")
            .collect(Collectors.joining(" "));
    }

    private void elementShape(Shape shape, IndentingWriter writer, Map<String, String> values) {
        switch(shape) {
            case Hexagon: hexagon(writer, values);
            break;
            case Box: box(writer, values);
            break;
            case Cylinder: cylinder(writer, values);
            break;
            case Pipe: pipe(writer, values);
            break;
            case WebBrowser: webBrowser(writer, values);
            break;
            case RoundedBox:
            case Circle:
            case Ellipse:
            case Diamond:
            case Person:
            case Robot:
            case Folder:
            case Window:
            case MobileDevicePortrait:
            case MobileDeviceLandscape:
            case Component:
            default:
            roundedBox(writer, values);
        }
    }

    private void person(IndentingWriter writer, Map<String, String> values) {
        String label = "<font style=\"font-size:${nameFontSize}px\"><b>%c4Name%</b></font><div>[%c4Type%]</div><br><div><font style=\"font-size:${descriptionFontSize}px\" color=\"${color}\">%c4Description%</font></div>";
        label = new StringSubstitutor(values).replace(label);
        values.put("label", escapeHtml4(label));        
        StringSubstitutor stringSubstitutor = new StringSubstitutor(values);
        writer.writeLine(stringSubstitutor.replace("<object placeholders='1' c4Name='${c4Name}' c4Type='Person' c4Description='${c4Description}' label='${label}' id='${id}' ${properties} >"));
        writer.indent();
        writer.writeLine(stringSubstitutor.replace("<mxCell style='shape=mxgraph.c4.person2;rounded=0;whiteSpace=wrap;html=1;fontSize=${metadataFontSize};labelBackgroundColor=none;fillColor=${background};fontColor=${color};align=center;arcSize=10;strokeColor=${stroke};metaEdit=1;resizable=0;points=[[0.25,0,0],[0.5,0,0],[0.75,0,0],[1,0.25,0],[1,0.5,0],[1,0.75,0],[0.75,1,0],[0.5,1,0],[0.25,1,0],[0,0.75,0],[0,0.5,0],[0,0.25,0]];' vertex='1' parent='${parentId}'>"));
        writer.indent();
        writer.writeLine(stringSubstitutor.replace("<mxGeometry x='${x}' y='${y}' width='${width}' height='${height}' as='geometry' />"));
        writer.outdent();
        writer.writeLine("</mxCell>");
        writer.outdent();
        writer.writeLine("</object>");
    }

    private void box(IndentingWriter writer, Map<String, String> values) {
        String technology = values.get("c4Technology");
        String label = (StringUtils.isNullOrEmpty(technology))
                ? "<font style=\"font-size:${nameFontSize}px\"><b>%c4Name%</b></font><div>[%c4Type%]</div><br><div><font style=\"font-size:${descriptionFontSize}px\" color=\"${color}\">%c4Description%</font></div>"
                : "<font style=\"font-size:${nameFontSize}px\"><b>%c4Name%</b></font><div>[%c4Type%: %c4Technology%]</div><br><div><font style=\"font-size:${descriptionFontSize}px\" color=\"${color}\">%c4Description%</font></div>";
        label = new StringSubstitutor(values).replace(label);
        values.put("label", escapeHtml4(label));        
        StringSubstitutor stringSubstitutor = new StringSubstitutor(values);
        writer.writeLine(stringSubstitutor.replace("<object placeholders='1' c4Name='${c4Name}' c4Type='${c4Type}' c4Technology='${c4Technology}' c4Description='${c4Description}' label='${label}' id='${id}' ${properties} >"));
        writer.indent();
        writer.writeLine(stringSubstitutor.replace("<mxCell style='rounded=0;whiteSpace=wrap;html=1;fontSize=${metadataFontSize};labelBackgroundColor=none;fillColor=${background};fontColor=${color};align=center;arcSize=10;strokeColor=${stroke};metaEdit=1;resizable=0;points=[[0.25,0,0],[0.5,0,0],[0.75,0,0],[1,0.25,0],[1,0.5,0],[1,0.75,0],[0.75,1,0],[0.5,1,0],[0.25,1,0],[0,0.75,0],[0,0.5,0],[0,0.25,0]];' vertex='1' parent='${parentId}'>"));
        writer.indent();
        writer.writeLine(stringSubstitutor.replace("<mxGeometry x='${x}' y='${y}' width='${width}' height='${height}' as='geometry' />"));
        writer.outdent();
        writer.writeLine("</mxCell>");
        writer.outdent();
        writer.writeLine("</object>");
    }

    private void roundedBox(IndentingWriter writer, Map<String, String> values) {
        String technology = values.get("c4Technology");
        String label = (StringUtils.isNullOrEmpty(technology))
                ? "<font style=\"font-size:${nameFontSize}px\"><b>%c4Name%</b></font><div>[%c4Type%]</div><br><div><font style=\"font-size:${descriptionFontSize}px\" color=\"${color}\">%c4Description%</font></div>"
                : "<font style=\"font-size:${nameFontSize}px\"><b>%c4Name%</b></font><div>[%c4Type%: %c4Technology%]</div><br><div><font style=\"font-size:${descriptionFontSize}px\" color=\"${color}\">%c4Description%</font></div>";
        label = new StringSubstitutor(values).replace(label);
        values.put("label", escapeHtml4(label));        
        StringSubstitutor stringSubstitutor = new StringSubstitutor(values);
        writer.writeLine(stringSubstitutor.replace("<object placeholders='1' c4Name='${c4Name}' c4Type='${c4Type}' c4Technology='${c4Technology}' c4Description='${c4Description}' label='${label}' id='${id}' ${properties} >"));
        writer.indent();
        writer.writeLine(stringSubstitutor.replace("<mxCell style='rounded=1;whiteSpace=wrap;html=1;fontSize=${metadataFontSize};labelBackgroundColor=none;fillColor=${background};fontColor=${color};align=center;arcSize=10;strokeColor=${stroke};metaEdit=1;resizable=0;points=[[0.25,0,0],[0.5,0,0],[0.75,0,0],[1,0.25,0],[1,0.5,0],[1,0.75,0],[0.75,1,0],[0.5,1,0],[0.25,1,0],[0,0.75,0],[0,0.5,0],[0,0.25,0]];' vertex='1' parent='${parentId}'>"));
        writer.indent();
        writer.writeLine(stringSubstitutor.replace("<mxGeometry x='${x}' y='${y}' width='${width}' height='${height}' as='geometry' />"));
        writer.outdent();
        writer.writeLine("</mxCell>");
        writer.outdent();
        writer.writeLine("</object>");
    }

    private void hexagon(IndentingWriter writer, Map<String, String> values) {
        int width = Integer.parseInt(values.get("width"));
        int height = (int) (HEXAGON_RATIO * width);
        values.put("height", String.valueOf(height));
        String technology = values.get("c4Technology");
        String label = (StringUtils.isNullOrEmpty(technology))
                ? "<font style=\"font-size:${nameFontSize}px\"><b>%c4Name%</b></font><div>[%c4Type%]</div><br><div><font style=\"font-size:${descriptionFontSize}px\" color=\"${color}\">%c4Description%</font></div>"
                : "<font style=\"font-size:${nameFontSize}px\"><b>%c4Name%</b></font><div>[%c4Type%: %c4Technology%]</div><br><div><font style=\"font-size:${descriptionFontSize}px\" color=\"${color}\">%c4Description%</font></div>";
        label = new StringSubstitutor(values).replace(label);
        values.put("label", escapeHtml4(label));        
        StringSubstitutor stringSubstitutor = new StringSubstitutor(values);
        writer.writeLine(stringSubstitutor.replace("<object placeholders='1' c4Name='${c4Name}' c4Type='${c4Type}' c4Technology='${c4Technology}' c4Description='${c4Description}' label='${label}' id='${id}' ${properties} >"));
        writer.indent();
        writer.writeLine(stringSubstitutor.replace("<mxCell style='shape=hexagon;size=120;perimeter=hexagonPerimeter2;whiteSpace=wrap;html=1;fixedSize=1;rounded=1;fontSize=${metadataFontSize};labelBackgroundColor=none;fillColor=${background};fontColor=${color};align=center;arcSize=10;strokeColor=${stroke};metaEdit=1;resizable=0;points=[[0.25,0,0],[0.5,0,0],[0.75,0,0],[1,0.25,0],[1,0.5,0],[1,0.75,0],[0.75,1,0],[0.5,1,0],[0.25,1,0],[0,0.75,0],[0,0.5,0],[0,0.25,0]];' vertex='1' parent='${parentId}'>"));
        writer.indent();
        writer.writeLine(stringSubstitutor.replace("<mxGeometry x='${x}' y='${y}' width='${width}' height='${height}' as='geometry' />"));
        writer.outdent();
        writer.writeLine("</mxCell>");
        writer.outdent();
        writer.writeLine("</object>");
    }

    private void cylinder(IndentingWriter writer, Map<String, String> values) {
        String technology = values.get("c4Technology");
        String label = (StringUtils.isNullOrEmpty(technology))
                ? "<font style=\"font-size:${nameFontSize}px\"><b>%c4Name%</b></font><div>[%c4Type%]</div><br><div><font style=\"font-size:${descriptionFontSize}px\" color=\"${color}\">%c4Description%</font></div>"
                : "<font style=\"font-size:${nameFontSize}px\"><b>%c4Name%</b></font><div>[%c4Type%: %c4Technology%]</div><br><div><font style=\"font-size:${descriptionFontSize}px\" color=\"${color}\">%c4Description%</font></div>";
        label = new StringSubstitutor(values).replace(label);
        values.put("label", escapeHtml4(label));        
        StringSubstitutor stringSubstitutor = new StringSubstitutor(values);
        writer.writeLine(stringSubstitutor.replace("<object placeholders='1' c4Name='${c4Name}' c4Type='${c4Type}' c4Technology='${c4Technology}' c4Description='${c4Description}' label='${label}' id='${id}' ${properties} >"));
        writer.indent();
        writer.writeLine(stringSubstitutor.replace("<mxCell style='shape=cylinder3;size=15;whiteSpace=wrap;html=1;boundedLbl=1;rounded=0;fontSize=${metadataFontSize};labelBackgroundColor=none;fillColor=${background};fontColor=${color};align=center;arcSize=10;strokeColor=${stroke};metaEdit=1;resizable=0;points=[[0.25,0,0],[0.5,0,0],[0.75,0,0],[1,0.25,0],[1,0.5,0],[1,0.75,0],[0.75,1,0],[0.5,1,0],[0.25,1,0],[0,0.75,0],[0,0.5,0],[0,0.25,0]];' vertex='1' parent='${parentId}'>"));
        writer.indent();
        writer.writeLine(stringSubstitutor.replace("<mxGeometry x='${x}' y='${y}' width='${width}' height='${height}' as='geometry' />"));
        writer.outdent();
        writer.writeLine("</mxCell>");
        writer.outdent();
        writer.writeLine("</object>");
    }

    private void pipe(IndentingWriter writer, Map<String, String> values) {
        String technology = values.get("c4Technology");
        String label = (StringUtils.isNullOrEmpty(technology))
                ? "<font style=\"font-size:${nameFontSize}px\"><b>%c4Name%</b></font><div>[%c4Type%]</div><br><div><font style=\"font-size:${descriptionFontSize}px\" color=\"${color}\">%c4Description%</font></div>"
                : "<font style=\"font-size:${nameFontSize}px\"><b>%c4Name%</b></font><div>[%c4Type%: %c4Technology%]</div><br><div><font style=\"font-size:${descriptionFontSize}px\" color=\"${color}\">%c4Description%</font></div>";
        label = new StringSubstitutor(values).replace(label);
        values.put("label", escapeHtml4(label));        
        StringSubstitutor stringSubstitutor = new StringSubstitutor(values);
        writer.writeLine(stringSubstitutor.replace("<object placeholders='1' c4Name='${c4Name}' c4Type='${c4Type}' c4Technology='${c4Technology}' c4Description='${c4Description}' label='${label}' id='${id}' ${properties} >"));
        writer.indent();
        writer.writeLine(stringSubstitutor.replace("<mxCell style='shape=cylinder3;size=15;direction=south;whiteSpace=wrap;html=1;boundedLbl=1;rounded=0;fontSize=${metadataFontSize};labelBackgroundColor=none;fillColor=${background};fontColor=${color};align=center;arcSize=10;strokeColor=${stroke};metaEdit=1;resizable=0;points=[[0.25,0,0],[0.5,0,0],[0.75,0,0],[1,0.25,0],[1,0.5,0],[1,0.75,0],[0.75,1,0],[0.5,1,0],[0.25,1,0],[0,0.75,0],[0,0.5,0],[0,0.25,0]];' vertex='1' parent='${parentId}'>"));
        writer.indent();
        writer.writeLine(stringSubstitutor.replace("<mxGeometry x='${x}' y='${y}' width='${width}' height='${height}' as='geometry' />"));
        writer.outdent();
        writer.writeLine("</mxCell>");
        writer.outdent();
        writer.writeLine("</object>");
    }

    private void webBrowser(IndentingWriter writer, Map<String, String> values) {
        String technology = values.get("c4Technology");
        String label = (StringUtils.isNullOrEmpty(technology))
                ? "<font style=\"font-size:${nameFontSize}px\"><b>%c4Name%</b></font><div>[%c4Type%]</div><br><div><font style=\"font-size:${descriptionFontSize}px\" color=\"${color}\">%c4Description%</font></div>"
                : "<font style=\"font-size:${nameFontSize}px\"><b>%c4Name%</b></font><div>[%c4Type%: %c4Technology%]</div><br><div><font style=\"font-size:${descriptionFontSize}px\" color=\"${color}\">%c4Description%</font></div>";
        label = new StringSubstitutor(values).replace(label);
        values.put("label", escapeHtml4(label));        
        StringSubstitutor stringSubstitutor = new StringSubstitutor(values);
        writer.writeLine(stringSubstitutor.replace("<object placeholders='1' c4Name='${c4Name}' c4Type='${c4Type}' c4Technology='${c4Technology}' c4Description='${c4Description}' label='${label}' id='${id}' ${properties} >"));
        writer.indent();
        writer.writeLine(stringSubstitutor.replace("<mxCell style='shape=mxgraph.c4.webBrowserContainer2;whiteSpace=wrap;html=1;boundedLbl=1;rounded=0;fontSize=${metadataFontSize};labelBackgroundColor=none;fillColor=${background};fontColor=${color};align=center;arcSize=10;strokeColor=${stroke};metaEdit=1;resizable=0;points=[[0.25,0,0],[0.5,0,0],[0.75,0,0],[1,0.25,0],[1,0.5,0],[1,0.75,0],[0.75,1,0],[0.5,1,0],[0.25,1,0],[0,0.75,0],[0,0.5,0],[0,0.25,0]];' vertex='1' parent='${parentId}'>"));
        writer.indent();
        writer.writeLine(stringSubstitutor.replace("<mxGeometry x='${x}' y='${y}' width='${width}' height='${height}' as='geometry' />"));
        writer.outdent();
        writer.writeLine("</mxCell>");
        writer.outdent();
        writer.writeLine("</object>");
    }

    public static String relationshipId(RelationshipView relationshipView) {
        return relationshipView.getId() + "-" + relationshipView.getOrder();
    }

    @Override
    protected void writeRelationship(ModelView view, RelationshipView relationshipView, IndentingWriter writer) {
        Element source;
        Element destination;

        RelationshipStyle relationshipStyle = view.getViewSet().getConfiguration().getStyles().findRelationshipStyle(relationshipView.getRelationship());
        String color = relationshipStyle.getColor();
        int descriptionFontSize = relationshipStyle.getFontSize();
        int strokeWidth = relationshipStyle.getThickness();
        Routing routing = relationshipStyle.getRouting();

        String description = relationshipView.getDescription();
        if (StringUtils.isNullOrEmpty(description)) {
            description = relationshipView.getRelationship().getDescription();
        }

        if (!StringUtils.isNullOrEmpty(relationshipView.getOrder())) {
            description = relationshipView.getOrder() + ". " + description;
        }

        description = escapeHtml4(description);
        if(description == null) {
            description = "";
        }

        String technology = relationshipView.getRelationship().getTechnology();
        technology = escapeHtml4(technology);

        if (relationshipView.getRelationship().getSource() instanceof DeploymentNode || relationshipView.getRelationship().getDestination() instanceof DeploymentNode) {
            source = relationshipView.getRelationship().getSource();
            if (source instanceof DeploymentNode deploymentNode) {
                source = findElementInside(deploymentNode, view);
            }
            destination = relationshipView.getRelationship().getDestination();
            if (destination instanceof DeploymentNode deploymentNode) {
                destination = findElementInside(deploymentNode, view);
            }
        } else {
            source = relationshipView.getRelationship().getSource();
            destination = relationshipView.getRelationship().getDestination();
            if (relationshipView.isResponse() != null && relationshipView.isResponse()) {
                source = relationshipView.getRelationship().getDestination();
                destination = relationshipView.getRelationship().getSource();
            }
        }

        Map<String, String> values = new HashMap<>();
        values.put("id", relationshipId(relationshipView));
        values.put("descriptionFontSize", String.valueOf(descriptionFontSize));
        values.put("color", color);
        String curved = (routing == Routing.Curved) ? "1" : "0";
        values.put("curved", curved);
        String edgeStyle = (routing == Routing.Orthogonal) ? "orthogonalEdgeStyle" : "none";
        values.put("edgeStyle", edgeStyle);
        values.put("color", color);
        values.put("strokeWidth", String.valueOf(strokeWidth));
        values.put("parentId", parentId);
        values.put("c4Technology", technology == null ? "" : technology);
        values.put("c4Description", description == null ? "" : description);
        values.put("source", source.getId());
        if(destination != null) {
            values.put("target", destination.getId());
        }
        String label = "";
        if(!StringUtils.isNullOrEmpty(description)) {
            if(!StringUtils.isNullOrEmpty(technology)) {
                label = "<div style=\"text-align: left\"><div style=\"text-align: center\"><b>%c4Description%</b></div><div style=\"text-align: center\">[%c4Technology%]</div></div>";
            } else {
                label = "<div style=\"text-align: left\"><div style=\"text-align: center\"><b>%c4Description%</b></div>";
            }
        }
        label = new StringSubstitutor(values).replace(label);
        values.put("label", escapeHtml4(label));        
        if(relationshipStyle.getStyle() != LineStyle.Solid) {
            if(relationshipStyle.getStyle() == LineStyle.Dotted) {
                values.put("dashed", "1");
                values.put("dashPattern", "1 8");
            } else {
                values.put("dashed", "1");
                values.put("dashPattern", "12 12");                
            }
        } else {
            values.put("dashed", "0");
            values.put("dashPattern", "1 8");
        }

        StringSubstitutor stringSubstitutor = new StringSubstitutor(values);
        writer.writeLine(stringSubstitutor.replace("<object placeholders='1' c4Type='Relationship' c4Technology='${c4Technology}' c4Description='${c4Description}' label='${label}' id='${id}'>"));
        writer.indent();
        writer.writeLine(stringSubstitutor.replace("<mxCell style='endSize=20;startSize=20;jumpStyle=arc;jumpSize=16;elbow=vertical;endFill=1;whiteSpace=wrap;endArrow=block;html=1;fontSize=${descriptionFontSize};fontColor=${color};align=center;arcSize=10;strokeColor=${color};strokeWidth=${strokeWidth};metaEdit=1;resizable=0;dashed=${dashed};dashPattern=${dashPattern};rounded=0;curved=${curved};edgeStyle=${edgeStyle};' parent='${parentId}' edge='1' source='${source}' target='${target}'>"));
        writer.indent();
        Collection<Vertex> vertices = relationshipView.getVertices();        
        if(vertices.isEmpty()) {
            writer.writeLine("<mxGeometry relative=\"1\" as=\"geometry\" />");
        } else {
            writer.writeLine("<mxGeometry relative=\"1\" as=\"geometry\">");
            writer.indent();
            writer.writeLine("<Array as=\"points\">");
            writer.indent();
            vertices.forEach(v -> writer.writeLine(String.format("<mxPoint x=\"%d\" y=\"%d\" />", v.getX(), v.getY())));
            writer.outdent();
            writer.writeLine("</Array>");
            writer.outdent();
            writer.writeLine("</mxGeometry>");
        }
        writer.outdent();
        writer.writeLine("</mxCell>");
        writer.outdent();
        writer.writeLine("</object>");
    }

    private Element findElementInside(DeploymentNode deploymentNode, ModelView view) {
        for (SoftwareSystemInstance softwareSystemInstance : deploymentNode.getSoftwareSystemInstances()) {
            if (view.isElementInView(softwareSystemInstance)) {
                return softwareSystemInstance;
            }
        }

        for (ContainerInstance containerInstance : deploymentNode.getContainerInstances()) {
            if (view.isElementInView(containerInstance)) {
                return containerInstance;
            }
        }

        for (InfrastructureNode infrastructureNode : deploymentNode.getInfrastructureNodes()) {
            if (view.isElementInView(infrastructureNode)) {
                return infrastructureNode;
            }
        }

        if (deploymentNode.hasChildren()) {
            for (DeploymentNode child : deploymentNode.getChildren()) {
                Element element = findElementInside(child, view);
                if (element != null) {
                    return element;
                }
            }
        }

        return null;
    }

    @Override
    protected Diagram createDiagram(ModelView view, String definition) {
        return new MxDiagram(view, definition);
    }

}