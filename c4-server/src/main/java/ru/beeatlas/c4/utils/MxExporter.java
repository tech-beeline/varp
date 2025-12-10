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

import java.util.Collection;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedList;
import java.util.Stack;
import java.util.UUID;

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
import com.structurizr.view.Shape;
import com.structurizr.view.Vertex;

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
        public HashMap<String, GroupBoundary> groupBoundaries = new HashMap<>();
        public int minX = Integer.MAX_VALUE;
        public int minY = Integer.MAX_VALUE;
        public int maxX = Integer.MIN_VALUE;
        public int maxY = Integer.MIN_VALUE;
    }

    private class SoftwareSystemBoundary {
        SoftwareSystem softwareSystem;
        public HashSet<GroupBoundary> groupBoundaries = new HashSet<>();
        public LinkedList<Element> elements = new LinkedList<>();
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
        public HashSet<GroupBoundary> groupBoundaries = new HashSet<>();
        public LinkedList<Element> elements = new LinkedList<>();
        public LinkedList<DeploymentNodeBoundary> deploymentNodes = new LinkedList<>();
        public DeploymentNodeBoundary(DeploymentNode deploymentNode) {
            this.deploymentNode = deploymentNode;
        }
    }

    private class ContainerBoundary {
        Container container;
        public HashSet<GroupBoundary> groupBoundaries = new HashSet<>();
        public LinkedList<Element> elements = new LinkedList<>();
        public ContainerBoundary(Container container) {
            this.container = container;
        }
    }

    private HashMap<String, GroupBoundary> groupBoundaries = new HashMap<>();
    private LinkedList<SoftwareSystemBoundary> softwareSystemBoundaries = new LinkedList<>();
    private LinkedList<ContainerBoundary> containerBoundaries = new LinkedList<>();
    private LinkedList<DeploymentNodeBoundary> deploymentNodeBoundaries = new LinkedList<>();
    private Stack<DeploymentNodeBoundary> deploymentNodeBoundaryStack = new Stack<>();

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
        StringBuilder sb = new StringBuilder();
        sb.append("<diagram name=\"Страница — 1\" id=\"").append(view.getKey());
        sb.append("\">");
        writer.writeLine(sb.toString());
        sb.setLength(0);
        writer.indent();

        sb.append("<mxGraphModel dx=\"0\" dy=\"0\" grid=\"1\" gridSize=\"10\" guides=\"1\" tooltips=\"1\" connect=\"1\" arrows=\"1\" fold=\"1\" page=\"1\" pageScale=\"1\" pageWidth=\"").append(view.getDimensions().getWidth());
        sb.append("\" pageHeight=\"").append(view.getDimensions().getHeight());
        sb.append("\" math=\"0\" shadow=\"0\">");
        writer.writeLine(sb.toString());
        sb.setLength(0);
        writer.indent();
        writer.writeLine("<root>");
        writer.indent();
        sb.append("<mxCell id=\"").append(rootId).append("\" />");
        writer.writeLine(sb.toString());
        sb.setLength(0);
        sb.append("<mxCell id=\"").append(parentId).append("\" parent=\"").append(rootId).append("\" />");
        writer.writeLine(sb.toString());
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

        StringBuilder sb = new StringBuilder();
        sb.append("<object placeholders=\"1\" c4Name=\"").append(group.name);
        sb.append("\" c4Type=\"GroupScopeBoundary\" c4Application=\"Group\" label=\"&lt;font style=&quot;font-size: ").append(fontSize);
        sb.append("px&quot;&gt;&lt;b&gt;&lt;div style=&quot;text-align: left&quot;&gt;%c4Name%&lt;/div&gt;&lt;/b&gt;&lt;/font&gt;&lt;div style=&quot;text-align: left&quot;&gt;[%c4Application%]&lt;/div&gt;\" id=\"")
                .append(UUID.randomUUID());
        sb.append("\">");
        writer.writeLine(sb.toString());
        sb.setLength(0);
        writer.indent();
        sb.append("<mxCell style=\"rounded=1;fontSize=").append(metadataFontSize);
        sb.append(";whiteSpace=wrap;html=1;dashed=1;arcSize=20;fillColor=none;strokeColor=").append(stroke);
        sb.append(";fontColor=").append(color);
        sb.append(";strokeWidth=").append(strokeWidth);
        sb.append(";labelBackgroundColor=none;align=left;verticalAlign=bottom;labelBorderColor=none;spacingTop=0;spacing=10;dashPattern=1 2;metaEdit=1;rotatable=0;perimeter=rectanglePerimeter;noLabel=0;labelPadding=0;allowArrows=0;connectable=0;expand=0;recursiveResize=0;editable=1;pointerEvents=0;absoluteArcSize=1;points=[[0.25,0,0],[0.5,0,0],[0.75,0,0],[1,0.25,0],[1,0.5,0],[1,0.75,0],[0.75,1,0],[0.5,1,0],[0.25,1,0],[0,0.75,0],[0,0.5,0],[0,0.25,0]];\" vertex=\"1\" parent=\"").append(parentId).append("\">");
        writer.writeLine(sb.toString());
        sb.setLength(0);
        writer.indent();
        sb.append("<mxGeometry x=\"").append(group.minX);
        sb.append("\" y=\"").append(group.minY);
        sb.append("\" width=\"").append(group.maxX - group.minX);
        sb.append("\" height=\"").append(group.maxY - group.minY);
        sb.append("\" as=\"geometry\" />");
        writer.writeLine(sb.toString());
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
            if (e instanceof StaticStructureElementInstance) {
                StaticStructureElementInstance elementInstance = (StaticStructureElementInstance)e;
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

        String stroke = "#666666";
        int strokeWidth = 4;
        ElementStyle es = view.getViewSet().getConfiguration().getStyles().findElementStyle(softwareSystemBoundary.softwareSystem);
        if(!StringUtils.isNullOrEmpty(es.getStroke())) {
            stroke = es.getStroke();
        }
        if(es.getStrokeWidth() != null) {
            strokeWidth = es.getStrokeWidth();
        }

        StringBuilder sb = new StringBuilder();
        sb.append("<object placeholders=\"1\" c4Name=\"").append(softwareSystemBoundary.softwareSystem.getName());
        sb.append("\" c4Type=\"SystemScopeBoundary\" c4Application=\"Software System\" label=\"&lt;font style=&quot;font-size: ").append(fontSize);
        sb.append("px&quot;&gt;&lt;b&gt;&lt;div style=&quot;text-align: left&quot;&gt;%c4Name%&lt;/div&gt;&lt;/b&gt;&lt;/font&gt;&lt;div style=&quot;text-align: left&quot;&gt;[%c4Application%]&lt;/div&gt;\" id=\"").append(softwareSystemBoundary.softwareSystem.getId());
        sb.append("\">");
        writer.writeLine(sb.toString());
        sb.setLength(0);
        writer.indent();
        sb.append("<mxCell style=\"rounded=1;fontSize=").append(metadataFontSize);
        sb.append(";whiteSpace=wrap;html=1;dashed=1;arcSize=20;fillColor=none;strokeColor=").append(stroke);
        sb.append(";fontColor=").append(stroke);
        sb.append(";strokeWidth=").append(strokeWidth);
        sb.append(";labelBackgroundColor=none;align=left;verticalAlign=bottom;labelBorderColor=none;spacingTop=0;spacing=10;dashPattern=8 8;metaEdit=1;rotatable=0;perimeter=rectanglePerimeter;noLabel=0;labelPadding=0;allowArrows=0;connectable=0;expand=0;recursiveResize=0;editable=1;pointerEvents=0;absoluteArcSize=1;points=[[0.25,0,0],[0.5,0,0],[0.75,0,0],[1,0.25,0],[1,0.5,0],[1,0.75,0],[0.75,1,0],[0.5,1,0],[0.25,1,0],[0,0.75,0],[0,0.5,0],[0,0.25,0]];\" vertex=\"1\" parent=\"").append(parentId).append("\">");
        writer.writeLine(sb.toString());
        sb.setLength(0);
        writer.indent();
        sb.append("<mxGeometry x=\"").append(minX);
        sb.append("\" y=\"").append(minY);
        sb.append("\" width=\"").append(maxX - minX);
        sb.append("\" height=\"").append(maxY - minY);
        sb.append("\" as=\"geometry\" />");

        writer.writeLine(sb.toString());
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
            if (e instanceof StaticStructureElementInstance) {
                StaticStructureElementInstance elementInstance = (StaticStructureElementInstance)e;
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

        StringBuilder sb = new StringBuilder();
        sb.append("<object placeholders=\"1\" c4Name=\"").append(containerBoundary.container.getName());
        sb.append("\" c4Type=\"ContainerScopeBoundary\" c4Application=\"Container\" label=\"&lt;font style=&quot;font-size: ").append(fontSize);
        sb.append("px&quot;&gt;&lt;b&gt;&lt;div style=&quot;text-align: left&quot;&gt;%c4Name%&lt;/div&gt;&lt;/b&gt;&lt;/font&gt;&lt;div style=&quot;text-align: left&quot;&gt;[%c4Application%]&lt;/div&gt;\" id=\"").append(containerBoundary.container.getId());
        sb.append("\">");
        writer.writeLine(sb.toString());
        sb.setLength(0);
        writer.indent();
        sb.append("<mxCell style=\"rounded=1;fontSize=").append(metadataFontSize);
        sb.append(";whiteSpace=wrap;html=1;dashed=1;arcSize=20;fillColor=none;strokeColor=").append(stroke);
        sb.append(";fontColor=").append(color);
        sb.append(";strokeWidth=").append(strokeWidth);
        sb.append(";labelBackgroundColor=none;align=left;verticalAlign=bottom;labelBorderColor=none;spacingTop=0;spacing=10;dashPattern=8 8;metaEdit=1;rotatable=0;perimeter=rectanglePerimeter;noLabel=0;labelPadding=0;allowArrows=0;connectable=0;expand=0;recursiveResize=0;editable=1;pointerEvents=0;absoluteArcSize=1;points=[[0.25,0,0],[0.5,0,0],[0.75,0,0],[1,0.25,0],[1,0.5,0],[1,0.75,0],[0.75,1,0],[0.5,1,0],[0.25,1,0],[0,0.75,0],[0,0.5,0],[0,0.25,0]];\" vertex=\"1\" parent=\"").append(parentId).append("\">");
        writer.writeLine(sb.toString());
        sb.setLength(0);
        writer.indent();
        sb.append("<mxGeometry x=\"").append(minX);
        sb.append("\" y=\"").append(minY);
        sb.append("\" width=\"").append(maxX - minX);
        sb.append("\" height=\"").append(maxY - minY);
        sb.append("\" as=\"geometry\" />");

        writer.writeLine(sb.toString());
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
        HashMap<String, GroupBoundary> groupBoundariesRoot = groupBoundaries;
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
                if(deploymentNodeBoundaryStack.empty() == false) {
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
            Element e = (Element)ev.getElement();
            if (e instanceof StaticStructureElementInstance) {
                StaticStructureElementInstance elementInstance = (StaticStructureElementInstance)e;
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
        
        if(deploymentNodeBoundaryStack.empty() == true) {
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
        String strokeColor = "#666666";
        int strokeWidth = 4;
        int fontSize = BOUNDARY_FONT_SIZE;
        int metadataFontSize = BOUNDARYMETA_FONT_SIZE;

        ElementStyle es = view.getViewSet().getConfiguration().getStyles().findElementStyle(deploymentNodeBoundary.deploymentNode);

        if(es != null) {
            if(!StringUtils.isNullOrEmpty(es.getColor())) {
                color = es.getColor();
            }
            if(!StringUtils.isNullOrEmpty(es.getStroke())) {
                strokeColor = es.getStroke();
            } 
            if(es.getStrokeWidth() != null) {
                strokeWidth = es.getStrokeWidth();
            }
        }

        StringBuilder sb = new StringBuilder();
        sb.append("<object placeholders=\"1\" c4Name=\"").append(deploymentNodeBoundary.deploymentNode.getName());
        sb.append("\" c4Type=\"DeploymentNodeScopeBoundary\" c4Application=\"DeploymentNode\" label=\"&lt;font style=&quot;font-size: ").append(fontSize);
        sb.append("px&quot;&gt;&lt;b&gt;&lt;div style=&quot;text-align: left&quot;&gt;%c4Name%&lt;/div&gt;&lt;/b&gt;&lt;/font&gt;&lt;div style=&quot;text-align: left&quot;&gt;[%c4Application%]&lt;/div&gt;\" id=\"")
                .append(deploymentNodeBoundary.deploymentNode.getId());
        sb.append("\">");
        writer.writeLine(sb.toString());
        sb.setLength(0);
        writer.indent();
        sb.append("<mxCell style=\"rounded=1;fontSize=").append(metadataFontSize);
        sb.append(";whiteSpace=wrap;html=1;arcSize=20;fillColor=none;strokeColor=").append(strokeColor);
        sb.append(";fontColor=").append(color);
        sb.append(";strokeWidth=").append(strokeWidth);
        sb.append(";labelBackgroundColor=none;align=left;verticalAlign=bottom;labelBorderColor=none;spacingTop=0;spacing=10;metaEdit=1;rotatable=0;perimeter=rectanglePerimeter;noLabel=0;labelPadding=0;allowArrows=0;connectable=0;expand=0;recursiveResize=0;editable=1;pointerEvents=0;absoluteArcSize=1;points=[[0.25,0,0],[0.5,0,0],[0.75,0,0],[1,0.25,0],[1,0.5,0],[1,0.75,0],[0.75,1,0],[0.5,1,0],[0.25,1,0],[0,0.75,0],[0,0.5,0],[0,0.25,0]];\" vertex=\"1\" parent=\"").append(parentId).append("\">");
        writer.writeLine(sb.toString());
        sb.setLength(0);        
        writer.indent();
        sb.append("<mxGeometry x=\"").append(deploymentNodeBoundary.minX);
        sb.append("\" y=\"").append(deploymentNodeBoundary.minY);
        sb.append("\" width=\"").append(deploymentNodeBoundary.maxX - deploymentNodeBoundary.minX);
        sb.append("\" height=\"").append(deploymentNodeBoundary.maxY - deploymentNodeBoundary.minY);
        sb.append("\" as=\"geometry\" />");
        writer.writeLine(sb.toString());
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
            if (e instanceof StaticStructureElementInstance) {
                StaticStructureElementInstance elementInstance = (StaticStructureElementInstance)e;
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
        if(deploymentNodeBoundaryStack.empty() == false) {
            DeploymentNodeBoundary deploymentNodeBoundary = deploymentNodeBoundaryStack.peek();
            deploymentNodeBoundary.elements.add(element);
        }

        ElementStyle es = view.getViewSet().getConfiguration().getStyles().findElementStyle(element);
        ElementView ev = view.getElementView(element);
        String id = element.getId();

        if (element instanceof StaticStructureElementInstance) {
            StaticStructureElementInstance elementInstance = (StaticStructureElementInstance)element;
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

        if(element instanceof Person) {
            person(writer, name, description, id, nameFontSize, metadataFontSize, descriptionFontSize, color, stroke, background, ev.getX(), ev.getY(), es.getWidth(), es.getHeight());
        } else if(element instanceof Container) {
            Container container = ((Container)element);
            String technolodgy = escapeHtml4(container.getTechnology());
            elementShape(shape, writer, "Container", name, technolodgy, description, id, nameFontSize, metadataFontSize, descriptionFontSize, color, stroke, background, ev.getX(), ev.getY(), es.getWidth(), es.getHeight());
        } else if(element instanceof SoftwareSystem) {
            elementShape(shape, writer, "Software System", name, null, description, id, nameFontSize, metadataFontSize, descriptionFontSize, color, stroke, background, ev.getX(), ev.getY(), es.getWidth(), es.getHeight());
        } else if(element instanceof Component) {
            Component component = ((Component)element);
            String technolodgy = escapeHtml4(component.getTechnology());
            elementShape(shape, writer, "Component", name, technolodgy, description, id, nameFontSize, metadataFontSize, descriptionFontSize, color, stroke, background, ev.getX(), ev.getY(), es.getWidth(), es.getHeight());
        }
    }

    private void elementShape(Shape shape, IndentingWriter writer, String type, String name, String technolodgy, String description, String id, int nameFontSize, int metadataFontSize, int descriptionFontSize, String color, String stroke, String background, int x, int y, int width, int height) {
        switch(shape) {
            case Hexagon: hexagon(writer, type, name, technolodgy, description, id, nameFontSize, metadataFontSize, descriptionFontSize, color, stroke, background, x, y, width, height);
            break;
            case Box: box(writer, type, name, technolodgy, description, id, nameFontSize, metadataFontSize, descriptionFontSize, color, stroke, background, x, y, width, height);
            break;
            case Cylinder: cylinder(writer, type, name, technolodgy, description, id, nameFontSize, metadataFontSize, descriptionFontSize, color, stroke, background, x, y, width, height);
            break;
            case Pipe: pipe(writer, type, name, technolodgy, description, id, nameFontSize, metadataFontSize, descriptionFontSize, color, stroke, background, x, y, width, height);
            break;
            case WebBrowser: webBrowser(writer, type, name, technolodgy, description, id, nameFontSize, metadataFontSize, descriptionFontSize, color, stroke, background, x, y, width, height);
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
            roundedBox(writer, type, name, technolodgy, description, id, nameFontSize, metadataFontSize, descriptionFontSize, color, stroke, background, x, y, width, height);
        }
    }

    private void person(IndentingWriter writer, String name, String description, String id, int nameFontSize, int metadataFontSize, int descriptionFontSize, String color, String stroke, String background, int x, int y, int width, int height) {
        StringBuilder sb = new StringBuilder();

        sb.append("<object placeholders=\"1\" c4Name=\"").append(name);
        sb.append("\" c4Type=\"Person\" c4Description=\"").append(description);
        sb.append("\" label=\"&lt;font style=&quot;font-size: ").append(nameFontSize);
        sb.append("px&quot;&gt;&lt;b&gt;%c4Name%&lt;/b&gt;&lt;/font&gt;&lt;div&gt;[%c4Type%]&lt;/div&gt;&lt;br&gt;&lt;div&gt;&lt;font style=&quot;font-size: ").append(descriptionFontSize);
        sb.append("px&quot;&gt;&lt;font color=&quot;").append(color);
        sb.append("&quot;&gt;%c4Description%&lt;/font&gt;&lt;/div&gt;\" id=\"").append(id);
        sb.append("\">");
        writer.writeLine(sb.toString());
        sb.setLength(0);
        writer.indent();
        sb.append("<mxCell style=\"html=1;fontSize=").append(metadataFontSize);
        sb.append(";dashed=0;whiteSpace=wrap;fillColor=").append(background);
        sb.append(";strokeColor=").append(stroke);
        sb.append(";fontColor=").append(color);
        sb.append(";shape=mxgraph.c4.person2;align=center;metaEdit=1;points=[[0.5,0,0],[1,0.5,0],[1,0.75,0],[0.75,1,0],[0.5,1,0],[0.25,1,0],[0,0.75,0],[0,0.5,0]];resizable=0;\" vertex=\"1\" parent=\"").append(parentId).append("\">");
        writer.writeLine(sb.toString());
        sb.setLength(0);
        writer.indent();
        sb.append("<mxGeometry x=\"").append(x);
        sb.append("\" y=\"").append(y);
        sb.append("\" width=\"").append(width);
        sb.append("\" height=\"").append(height);
        sb.append("\" as=\"geometry\" />");
        writer.writeLine(sb.toString());
        writer.outdent();
        writer.writeLine("</mxCell>");
        writer.outdent();
        writer.writeLine("</object>");
    }

    private void box(IndentingWriter writer, String type, String name, String technolodgy, String description, String id, int nameFontSize, int metadataFontSize, int descriptionFontSize, String color, String stroke, String background, int x, int y, int width, int height) {
        StringBuilder sb = new StringBuilder();
        sb.append("<object placeholders=\"1\" c4Name=\"").append(name);
        sb.append("\" c4Type=\"").append(type);
        if(technolodgy != null) {
            sb.append("\" c4Technology=\"").append(technolodgy);
        }
        sb.append("\" c4Description=\"").append(description);
        sb.append("\" label=\"&lt;font style=&quot;font-size: ").append(nameFontSize);
        if(technolodgy != null) {
            sb.append("px&quot;&gt;&lt;b&gt;%c4Name%&lt;/b&gt;&lt;/font&gt;&lt;div&gt;[%c4Type%: %c4Technology%]&lt;/div&gt;&lt;br&gt;&lt;div&gt;&lt;font style=&quot;font-size: ").append(descriptionFontSize);
        } else {
            sb.append("px&quot;&gt;&lt;b&gt;%c4Name%&lt;/b&gt;&lt;/font&gt;&lt;div&gt;[%c4Type%]&lt;/div&gt;&lt;br&gt;&lt;div&gt;&lt;font style=&quot;font-size: ").append(descriptionFontSize);
        }
        sb.append("px&quot;&gt;&lt;font color=&quot;").append(color);
        sb.append("&quot;&gt;%c4Description%&lt;/font&gt;&lt;/div&gt;\" id=\"").append(id);
        sb.append("\">");
        writer.writeLine(sb.toString());
        sb.setLength(0);
        writer.indent();
        sb.append("<mxCell style=\"rounded=0;whiteSpace=wrap;html=1;fontSize=").append(metadataFontSize);
        sb.append(";labelBackgroundColor=none;fillColor=").append(background);
        sb.append(";fontColor=").append(color);
        sb.append(";align=center;arcSize=10;strokeColor=").append(stroke);
        sb.append(";metaEdit=1;resizable=0;points=[[0.25,0,0],[0.5,0,0],[0.75,0,0],[1,0.25,0],[1,0.5,0],[1,0.75,0],[0.75,1,0],[0.5,1,0],[0.25,1,0],[0,0.75,0],[0,0.5,0],[0,0.25,0]];\" vertex=\"1\" parent=\"").append(parentId).append("\">");
        writer.writeLine(sb.toString());
        sb.setLength(0);
        writer.indent();
        sb.append("<mxGeometry x=\"").append(x);
        sb.append("\" y=\"").append(y);
        sb.append("\" width=\"").append(width);
        sb.append("\" height=\"").append(height);
        sb.append("\" as=\"geometry\" />");
        writer.writeLine(sb.toString());
        writer.outdent();
        writer.writeLine("</mxCell>");
        writer.outdent();
        writer.writeLine("</object>");
    }

    private void roundedBox(IndentingWriter writer, String type, String name, String technolodgy, String description, String id, int nameFontSize, int metadataFontSize, int descriptionFontSize, String color, String stroke, String background, int x, int y, int width, int height) {
        StringBuilder sb = new StringBuilder();
        sb.append("<object placeholders=\"1\" c4Name=\"").append(name);
        sb.append("\" c4Type=\"").append(type);
        if(technolodgy != null) {
            sb.append("\" c4Technology=\"").append(technolodgy);
        }
        sb.append("\" c4Description=\"").append(description);
        sb.append("\" label=\"&lt;font style=&quot;font-size: ").append(nameFontSize);
        if(technolodgy != null) {
            sb.append("px&quot;&gt;&lt;b&gt;%c4Name%&lt;/b&gt;&lt;/font&gt;&lt;div&gt;[%c4Type%: %c4Technology%]&lt;/div&gt;&lt;br&gt;&lt;div&gt;&lt;font style=&quot;font-size: ").append(descriptionFontSize);
        } else {
            sb.append("px&quot;&gt;&lt;b&gt;%c4Name%&lt;/b&gt;&lt;/font&gt;&lt;div&gt;[%c4Type%]&lt;/div&gt;&lt;br&gt;&lt;div&gt;&lt;font style=&quot;font-size: ").append(descriptionFontSize);
        }
        sb.append("px&quot;&gt;&lt;font color=&quot;").append(color);
        sb.append("&quot;&gt;%c4Description%&lt;/font&gt;&lt;/div&gt;\" id=\"").append(id);
        sb.append("\">");
        writer.writeLine(sb.toString());
        sb.setLength(0);
        writer.indent();
        sb.append("<mxCell style=\"rounded=1;whiteSpace=wrap;html=1;fontSize=").append(metadataFontSize);
        sb.append(";labelBackgroundColor=none;fillColor=").append(background);
        sb.append(";fontColor=").append(color);
        sb.append(";align=center;arcSize=10;strokeColor=").append(stroke);
        sb.append(";metaEdit=1;resizable=0;points=[[0.25,0,0],[0.5,0,0],[0.75,0,0],[1,0.25,0],[1,0.5,0],[1,0.75,0],[0.75,1,0],[0.5,1,0],[0.25,1,0],[0,0.75,0],[0,0.5,0],[0,0.25,0]];\" vertex=\"1\" parent=\"").append(parentId).append("\">");
        writer.writeLine(sb.toString());
        sb.setLength(0);
        writer.indent();
        sb.append("<mxGeometry x=\"").append(x);
        sb.append("\" y=\"").append(y);
        sb.append("\" width=\"").append(width);
        sb.append("\" height=\"").append(height);
        sb.append("\" as=\"geometry\" />");
        writer.writeLine(sb.toString());
        writer.outdent();
        writer.writeLine("</mxCell>");
        writer.outdent();
        writer.writeLine("</object>");
    }

    private void hexagon(IndentingWriter writer, String type, String name, String technolodgy, String description, String id, int nameFontSize, int metadataFontSize, int descriptionFontSize, String color, String stroke, String background, int x, int y, int width, int height) {
        StringBuilder sb = new StringBuilder();
        sb.append("<object placeholders=\"1\" c4Name=\"").append(name);
        sb.append("\" c4Type=\"").append(type);
        if(technolodgy != null) {
            sb.append("\" c4Technology=\"").append(technolodgy);
        }
        sb.append("\" c4Description=\"").append(description);
        sb.append("\" label=\"&lt;font style=&quot;font-size: ").append(nameFontSize);
        if(technolodgy != null) {
            sb.append("px&quot;&gt;&lt;b&gt;%c4Name%&lt;/b&gt;&lt;/font&gt;&lt;div&gt;[%c4Type%: %c4Technology%]&lt;/div&gt;&lt;br&gt;&lt;div&gt;&lt;font style=&quot;font-size: ").append(descriptionFontSize);
        } else {
            sb.append("px&quot;&gt;&lt;b&gt;%c4Name%&lt;/b&gt;&lt;/font&gt;&lt;div&gt;[%c4Type%]&lt;/div&gt;&lt;br&gt;&lt;div&gt;&lt;font style=&quot;font-size: ").append(descriptionFontSize);
        }
        sb.append("px&quot;&gt;&lt;font color=&quot;").append(color);
        sb.append("&quot;&gt;%c4Description%&lt;/font&gt;&lt;/div&gt;\" id=\"").append(id);
        sb.append("\">");
        writer.writeLine(sb.toString());
        sb.setLength(0);
        writer.indent();
        sb.append("<mxCell style=\"shape=hexagon;size=120;perimeter=hexagonPerimeter2;whiteSpace=wrap;html=1;fixedSize=1;rounded=1;fontSize=").append(metadataFontSize);
        sb.append(";labelBackgroundColor=none;fillColor=").append(background);
        sb.append(";fontColor=").append(color);
        sb.append(";align=center;arcSize=10;strokeColor=").append(stroke);
        sb.append(";metaEdit=1;resizable=0;points=[[0.5,0,0],[1,0.25,0],[1,0.5,0],[1,0.75,0],[0.5,1,0],[0,0.75,0],[0,0.5,0],[0,0.25,0]];\" vertex=\"1\" parent=\"").append(parentId).append("\">");
        writer.writeLine(sb.toString());
        sb.setLength(0);
        writer.indent();
        sb.append("<mxGeometry x=\"").append(x);
        sb.append("\" y=\"").append(y);
        height = (int) (HEXAGON_RATIO * width);
        sb.append("\" width=\"").append(width);
        sb.append("\" height=\"").append(height);
        sb.append("\" as=\"geometry\" />");
        writer.writeLine(sb.toString());
        writer.outdent();
        writer.writeLine("</mxCell>");
        writer.outdent();
        writer.writeLine("</object>");
    }

    private void cylinder(IndentingWriter writer, String type, String name, String technolodgy, String description, String id, int nameFontSize, int metadataFontSize, int descriptionFontSize, String color, String stroke, String background, int x, int y, int width, int height) {
        StringBuilder sb = new StringBuilder();
        sb.append("<object placeholders=\"1\" c4Name=\"").append(name);
        sb.append("\" c4Type=\"").append(type);
        if(technolodgy != null) {
            sb.append("\" c4Technology=\"").append(technolodgy);
        }
        sb.append("\" c4Description=\"").append(description);
        sb.append("\" label=\"&lt;font style=&quot;font-size: ").append(nameFontSize);
        if(technolodgy != null) {
            sb.append("px&quot;&gt;&lt;b&gt;%c4Name%&lt;/b&gt;&lt;/font&gt;&lt;div&gt;[%c4Type%: %c4Technology%]&lt;/div&gt;&lt;br&gt;&lt;div&gt;&lt;font style=&quot;font-size: ").append(descriptionFontSize);
        } else {
            sb.append("px&quot;&gt;&lt;b&gt;%c4Name%&lt;/b&gt;&lt;/font&gt;&lt;div&gt;[%c4Type%]&lt;/div&gt;&lt;br&gt;&lt;div&gt;&lt;font style=&quot;font-size: ").append(descriptionFontSize);
        }
        sb.append("px&quot;&gt;&lt;font color=&quot;").append(color);
        sb.append("&quot;&gt;%c4Description%&lt;/font&gt;&lt;/div&gt;\" id=\"").append(id);
        sb.append("\">");
        writer.writeLine(sb.toString());
        sb.setLength(0);
        writer.indent();
        sb.append("<mxCell style=\"shape=cylinder3;size=15;whiteSpace=wrap;html=1;boundedLbl=1;rounded=0;fontSize=").append(metadataFontSize);
        sb.append(";labelBackgroundColor=none;fillColor=").append(background);
        sb.append(";fontColor=").append(color);
        sb.append(";align=center;arcSize=10;strokeColor=").append(stroke);
        sb.append(";metaEdit=1;resizable=0;points=[[0.5,0,0],[1,0.25,0],[1,0.5,0],[1,0.75,0],[0.5,1,0],[0,0.75,0],[0,0.5,0],[0,0.25,0]];\" vertex=\"1\" parent=\"").append(parentId).append("\">");
        writer.writeLine(sb.toString());
        sb.setLength(0);
        writer.indent();
        sb.append("<mxGeometry x=\"").append(x);
        sb.append("\" y=\"").append(y);
        sb.append("\" width=\"").append(width);
        sb.append("\" height=\"").append(height);
        sb.append("\" as=\"geometry\" />");
        writer.writeLine(sb.toString());
        writer.outdent();
        writer.writeLine("</mxCell>");
        writer.outdent();
        writer.writeLine("</object>");
    }

    private void pipe(IndentingWriter writer, String type, String name, String technolodgy, String description, String id, int nameFontSize, int metadataFontSize, int descriptionFontSize, String color, String stroke, String background, int x, int y, int width, int height) {
        StringBuilder sb = new StringBuilder();
        sb.append("<object placeholders=\"1\" c4Name=\"").append(name);
        sb.append("\" c4Type=\"").append(type);
        if(technolodgy != null) {
            sb.append("\" c4Technology=\"").append(technolodgy);
        }
        sb.append("\" c4Description=\"").append(description);
        sb.append("\" label=\"&lt;font style=&quot;font-size: ").append(nameFontSize);
        if(technolodgy != null) {
            sb.append("px&quot;&gt;&lt;b&gt;%c4Name%&lt;/b&gt;&lt;/font&gt;&lt;div&gt;[%c4Type%: %c4Technology%]&lt;/div&gt;&lt;br&gt;&lt;div&gt;&lt;font style=&quot;font-size: ").append(descriptionFontSize);
        } else {
            sb.append("px&quot;&gt;&lt;b&gt;%c4Name%&lt;/b&gt;&lt;/font&gt;&lt;div&gt;[%c4Type%]&lt;/div&gt;&lt;br&gt;&lt;div&gt;&lt;font style=&quot;font-size: ").append(descriptionFontSize);
        }
        sb.append("px&quot;&gt;&lt;font color=&quot;").append(color);
        sb.append("&quot;&gt;%c4Description%&lt;/font&gt;&lt;/div&gt;\" id=\"").append(id);
        sb.append("\">");
        writer.writeLine(sb.toString());
        sb.setLength(0);
        writer.indent();
        sb.append("<mxCell style=\"shape=cylinder3;size=15;direction=south;whiteSpace=wrap;html=1;boundedLbl=1;rounded=0;fontSize=").append(metadataFontSize);
        sb.append(";labelBackgroundColor=none;fillColor=").append(background);
        sb.append(";fontColor=").append(color);
        sb.append(";align=center;arcSize=10;strokeColor=").append(stroke);
        sb.append(";metaEdit=1;resizable=0;points=[[0.25,0,0],[0.5,0,0],[0.75,0,0],[1,0.25,0],[1,0.5,0],[1,0.75,0],[0.75,1,0],[0.5,1,0],[0.25,1,0],[0,0.75,0],[0,0.5,0],[0,0.25,0]];\" vertex=\"1\" parent=\"").append(parentId).append("\">");
        writer.writeLine(sb.toString());
        sb.setLength(0);
        writer.indent();
        sb.append("<mxGeometry x=\"").append(x);
        sb.append("\" y=\"").append(y);
        sb.append("\" width=\"").append(width);
        sb.append("\" height=\"").append(height);
        sb.append("\" as=\"geometry\" />");
        writer.writeLine(sb.toString());
        writer.outdent();
        writer.writeLine("</mxCell>");
        writer.outdent();
        writer.writeLine("</object>");
    }

    private void webBrowser(IndentingWriter writer, String type, String name, String technolodgy, String description, String id, int nameFontSize, int metadataFontSize, int descriptionFontSize, String color, String stroke, String background, int x, int y, int width, int height) {
        StringBuilder sb = new StringBuilder();
        sb.append("<object placeholders=\"1\" c4Name=\"").append(name);
        sb.append("\" c4Type=\"").append(type);
        if(technolodgy != null) {
            sb.append("\" c4Technology=\"").append(technolodgy);
        }
        sb.append("\" c4Description=\"").append(description);
        sb.append("\" label=\"&lt;font style=&quot;font-size: ").append(nameFontSize);
        if(technolodgy != null) {
            sb.append("px&quot;&gt;&lt;b&gt;%c4Name%&lt;/b&gt;&lt;/font&gt;&lt;div&gt;[%c4Type%: %c4Technology%]&lt;/div&gt;&lt;br&gt;&lt;div&gt;&lt;font style=&quot;font-size: ").append(descriptionFontSize);
        } else {
            sb.append("px&quot;&gt;&lt;b&gt;%c4Name%&lt;/b&gt;&lt;/font&gt;&lt;div&gt;[%c4Type%]&lt;/div&gt;&lt;br&gt;&lt;div&gt;&lt;font style=&quot;font-size: ").append(descriptionFontSize);
        }
        sb.append("px&quot;&gt;&lt;font color=&quot;").append(color);
        sb.append("&quot;&gt;%c4Description%&lt;/font&gt;&lt;/div&gt;\" id=\"").append(id);
        sb.append("\">");
        writer.writeLine(sb.toString());
        sb.setLength(0);
        writer.indent();
        sb.append("<mxCell style=\"shape=mxgraph.c4.webBrowserContainer2;whiteSpace=wrap;html=1;boundedLbl=1;rounded=0;fontSize=").append(metadataFontSize);
        sb.append(";labelBackgroundColor=none;fillColor=").append(background);
        sb.append(";fontColor=").append(color);
        sb.append(";align=center;arcSize=10;strokeColor=").append(stroke);
        sb.append(";metaEdit=1;resizable=0;points=[[0.5,0,0],[1,0.25,0],[1,0.5,0],[1,0.75,0],[0.5,1,0],[0,0.75,0],[0,0.5,0],[0,0.25,0]];\" vertex=\"1\" parent=\"").append(parentId).append("\">");
        writer.writeLine(sb.toString());
        sb.setLength(0);
        writer.indent();
        sb.append("<mxGeometry x=\"").append(x);
        sb.append("\" y=\"").append(y);
        sb.append("\" width=\"").append(width);
        sb.append("\" height=\"").append(height);
        sb.append("\" as=\"geometry\" />");
        writer.writeLine(sb.toString());
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
        int fontSize = relationshipStyle.getFontSize();
        int descriptionFontSize = relationshipStyle.getFontSize();

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
            if (source instanceof DeploymentNode) {
                source = findElementInside((DeploymentNode)source, view);
            }
            destination = relationshipView.getRelationship().getDestination();
            if (destination instanceof DeploymentNode) {
                destination = findElementInside((DeploymentNode)destination, view);
            }
        } else {
            source = relationshipView.getRelationship().getSource();
            destination = relationshipView.getRelationship().getDestination();
            if (relationshipView.isResponse() != null && relationshipView.isResponse()) {
                source = relationshipView.getRelationship().getDestination();
                destination = relationshipView.getRelationship().getSource();
            }
        }

        boolean solid = relationshipStyle.getStyle() == LineStyle.Solid || false == relationshipStyle.getDashed();

        StringBuilder sb = new StringBuilder();
        sb.append("<object placeholders=\"1\" c4Type=\"Relationship\" c4Technology=\"").append(technology);
        sb.append("\" c4Description=\"").append(description);
        String id = relationshipId(relationshipView);
        sb.append("\" label=\"&lt;div style=&quot;text-align: left&quot;&gt;&lt;div style=&quot;text-align: center&quot;&gt;&lt;b&gt;%c4Description%&lt;/b&gt;&lt;/div&gt;&lt;div style=&quot;text-align: center&quot;&gt;[%c4Technology%]&lt;/div&gt;&lt;/div&gt;\" id=\"").append(id);
        sb.append("\">");
        writer.writeLine(sb.toString());
        sb.setLength(0);
        writer.indent();
        sb.append("<mxCell style=\"whiteSpace=wrap;endArrow=block;html=1;fontSize=").append(descriptionFontSize);
        sb.append(";strokeWidth=").append(relationshipStyle.getThickness());
        sb.append(";fontColor=").append(color);
        if(relationshipStyle.getStyle() != LineStyle.Solid) {
            if(relationshipStyle.getStyle() == LineStyle.Dotted) {
                sb.append("dashed=1;dashPattern=1 8;");
            } else {
                sb.append(";dashed=1;dashPattern=12 12");
            }
        }
        sb.append(";endFill=1;strokeColor=").append(color);
        sb.append(";elbow=vertical;metaEdit=1;endSize=20;startSize=20;jumpStyle=arc;jumpSize=16;rounded=0;\" edge=\"1\" parent=\"").append(parentId).append("\" source=\"").append(source.getId());
        sb.append("\" target=\"").append(destination.getId());
        sb.append("\">");
        writer.writeLine(sb.toString());
        sb.setLength(0);
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