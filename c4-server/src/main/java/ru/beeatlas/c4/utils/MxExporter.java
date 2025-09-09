package ru.beeatlas.c4.utils;

import java.util.Optional;

import com.structurizr.export.AbstractDiagramExporter;
import com.structurizr.export.Diagram;
import com.structurizr.export.IndentingWriter;
import com.structurizr.export.dot.DOTDiagram;
import com.structurizr.model.*;
import com.structurizr.util.StringUtils;
import com.structurizr.view.*;

/**
 * Exports Structurizr views to Graphviz DOT definitions.
 */
public class MxExporter extends AbstractDiagramExporter {

    private static final String DEFAULT_FONT = "Arial";

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
        writer.writeLine("<diagram name=\"Страница — 1\" id=\"NeoCpV-NzOcwAlcAnlzz\">");
        writer.indent();
        String line = String.format("<mxGraphModel dx=\"0\" dy=\"0\" grid=\"1\" gridSize=\"10\" guides=\"1\" tooltips=\"1\" connect=\"1\" arrows=\"1\" fold=\"1\" page=\"1\" pageScale=\"1\" pageWidth=\"%d\" pageHeight=\"%d\" math=\"0\" shadow=\"0\">", view.getPaperSize().getWidth(), view.getPaperSize().getHeight());
        writer.writeLine(line);
        writer.indent();
        writer.writeLine("<root>");
        writer.indent();
        writer.writeLine("<mxCell id=\"0\" />");
        writer.writeLine("<mxCell id=\"1\" parent=\"0\" />");
    }

    @Override
    protected void writeFooter(ModelView view, IndentingWriter writer) {
        writer.indent();
        writer.writeLine("<root>");
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
        String color = "#cccccc";

        String groupSeparator = view.getModel().getProperties().get(GROUP_SEPARATOR_PROPERTY_NAME);
        String groupName = StringUtils.isNullOrEmpty(groupSeparator) ? group : group.substring(group.lastIndexOf(groupSeparator) + groupSeparator.length());

        // is there a style for the group?
        ElementStyle elementStyle = view.getViewSet().getConfiguration().getStyles().findElementStyle("Group:" + group);

        if (elementStyle == null || StringUtils.isNullOrEmpty(elementStyle.getColor())) {
            // no, so is there a default group style?
            elementStyle = view.getViewSet().getConfiguration().getStyles().findElementStyle("Group");
        }

        if (elementStyle != null && !StringUtils.isNullOrEmpty(elementStyle.getColor())) {
            color = elementStyle.getColor();
        }

        Optional<ElementView> optionalElemntView = view.getElements().stream().filter(e -> e.getElement().getName().equals(groupName)).findFirst();
        if(optionalElemntView.isPresent()) {
            ElementView elementView = optionalElemntView.get();
            String line = String.format("<object placeholders=\"1\" c4Name=\"%s\" c4Type=\"GroupScopeBoundary\" c4Application=\"Group\" label=\"&lt;font style=&quot;font-size: 16px&quot;&gt;&lt;b&gt;&lt;div style=&quot;text-align: left&quot;&gt;%c4Name%&lt;/div&gt;&lt;/b&gt;&lt;/font&gt;&lt;div style=&quot;text-align: left&quot;&gt;[%c4Application%]&lt;/div&gt;\" id=\"%s\">", groupName, elementView.getId());
            writer.writeLine(line);
            writer.indent();
            writer.writeLine("<mxCell style=\"rounded=1;fontSize=11;whiteSpace=wrap;html=1;dashed=1;arcSize=20;fillColor=none;strokeColor=#666666;fontColor=#333333;labelBackgroundColor=none;align=left;verticalAlign=bottom;labelBorderColor=none;spacingTop=0;spacing=10;dashPattern=8 4;metaEdit=1;rotatable=0;perimeter=rectanglePerimeter;noLabel=0;labelPadding=0;allowArrows=0;connectable=0;expand=0;recursiveResize=0;editable=1;pointerEvents=0;absoluteArcSize=1;points=[[0.25,0,0],[0.5,0,0],[0.75,0,0],[1,0.25,0],[1,0.5,0],[1,0.75,0],[0.75,1,0],[0.5,1,0],[0.25,1,0],[0,0.75,0],[0,0.5,0],[0,0.25,0]];\" vertex=\"1\" parent=\"1\">");
            writer.indent();
            line = String.format("<mxGeometry x=\"%d\" y=\"%d\" width=\"%d\" height=\"%d\" as=\"geometry\" />", elementView.getX(), elementView.getY(), elementStyle.getWidth(), elementStyle.getHeight());
            writer.writeLine(line);
            writer.outdent();
            writer.writeLine("</mxCell>");
            writer.outdent();
            writer.writeLine("</object>");
        }
    }

    @Override
    protected void endGroupBoundary(ModelView view, IndentingWriter writer) {
    }

    @Override
    protected void startSoftwareSystemBoundary(ModelView view, SoftwareSystem softwareSystem, IndentingWriter writer) {
        String color;
        if (softwareSystem.equals(view.getSoftwareSystem())) {
            color = "#444444";
        } else {
            color = "#cccccc";
        }

        ElementStyle elementStyle = view.getViewSet().getConfiguration().getStyles().findElementStyle(softwareSystem);
        ElementView elementView = view.getElementView(softwareSystem);

        String line = String.format("<object placeholders=\"1\" c4Name=\"%s\" c4Type=\"SystemScopeBoundary\" c4Application=\"Software System\" label=\"&lt;font style=&quot;font-size: 16px&quot;&gt;&lt;b&gt;&lt;div style=&quot;text-align: left&quot;&gt;%c4Name%&lt;/div&gt;&lt;/b&gt;&lt;/font&gt;&lt;div style=&quot;text-align: left&quot;&gt;[%c4Application%]&lt;/div&gt;\" id=\"%s\">", softwareSystem.getName(), softwareSystem.getId());
        writer.writeLine(line);
        writer.indent();
        writer.writeLine("<mxCell style=\"rounded=1;fontSize=11;whiteSpace=wrap;html=1;dashed=1;arcSize=20;fillColor=none;strokeColor=#666666;fontColor=#333333;labelBackgroundColor=none;align=left;verticalAlign=bottom;labelBorderColor=none;spacingTop=0;spacing=10;dashPattern=8 4;metaEdit=1;rotatable=0;perimeter=rectanglePerimeter;noLabel=0;labelPadding=0;allowArrows=0;connectable=0;expand=0;recursiveResize=0;editable=1;pointerEvents=0;absoluteArcSize=1;points=[[0.25,0,0],[0.5,0,0],[0.75,0,0],[1,0.25,0],[1,0.5,0],[1,0.75,0],[0.75,1,0],[0.5,1,0],[0.25,1,0],[0,0.75,0],[0,0.5,0],[0,0.25,0]];\" vertex=\"1\" parent=\"1\">");
        writer.indent();
        line = String.format("<mxGeometry x=\"%d\" y=\"%d\" width=\"%d\" height=\"%d\" as=\"geometry\" />", elementView.getX(), elementView.getY(), elementStyle.getWidth(), elementStyle.getHeight());
        writer.writeLine(line);
        writer.outdent();
        writer.writeLine("</mxCell>");
        writer.outdent();
        writer.writeLine("</object>");
    }

    @Override
    protected void endSoftwareSystemBoundary(ModelView view, IndentingWriter writer) {
    }

    @Override
    protected void startContainerBoundary(ModelView view, Container container, IndentingWriter writer) {
        String color = "#444444";
        if (view instanceof ComponentView) {
            if (container.equals(((ComponentView)view).getContainer())) {
                color = "#444444";
            } else {
                color = "#cccccc";
            }
        } else if (view instanceof DynamicView) {
            if (container.equals(((DynamicView)view).getElement())) {
                color = "#444444";
            } else {
                color = "#cccccc";
            }
        }

        ElementStyle elementStyle = view.getViewSet().getConfiguration().getStyles().findElementStyle(container);
        ElementView elementView = view.getElementView(container);

        String line = String.format("<object placeholders=\"1\" c4Name=\"%s\" c4Type=\"ContainerScopeBoundary\" c4Application=\"Container\" label=\"&lt;font style=&quot;font-size: 16px&quot;&gt;&lt;b&gt;&lt;div style=&quot;text-align: left&quot;&gt;%c4Name%&lt;/div&gt;&lt;/b&gt;&lt;/font&gt;&lt;div style=&quot;text-align: left&quot;&gt;[%c4Application%]&lt;/div&gt;\" id=\"%s\">", container.getName(), container.getId());
        writer.writeLine(line);
        writer.indent();
        writer.writeLine("<mxCell style=\"rounded=1;fontSize=11;whiteSpace=wrap;html=1;dashed=1;arcSize=20;fillColor=none;strokeColor=#666666;fontColor=#333333;labelBackgroundColor=none;align=left;verticalAlign=bottom;labelBorderColor=none;spacingTop=0;spacing=10;dashPattern=8 4;metaEdit=1;rotatable=0;perimeter=rectanglePerimeter;noLabel=0;labelPadding=0;allowArrows=0;connectable=0;expand=0;recursiveResize=0;editable=1;pointerEvents=0;absoluteArcSize=1;points=[[0.25,0,0],[0.5,0,0],[0.75,0,0],[1,0.25,0],[1,0.5,0],[1,0.75,0],[0.75,1,0],[0.5,1,0],[0.25,1,0],[0,0.75,0],[0,0.5,0],[0,0.25,0]];\" vertex=\"1\" parent=\"1\">");
        writer.indent();
        line = String.format("<mxGeometry x=\"%d\" y=\"%d\" width=\"%d\" height=\"%d\" as=\"geometry\" />", elementView.getX(), elementView.getY(), elementStyle.getWidth(), elementStyle.getHeight());
        writer.writeLine(line);
        writer.outdent();
        writer.writeLine("</mxCell>");
        writer.outdent();
        writer.writeLine("</object>");
    }

    @Override
    protected void endContainerBoundary(ModelView view, IndentingWriter writer) {
    }

    @Override
    protected void startDeploymentNodeBoundary(DeploymentView view, DeploymentNode deploymentNode, IndentingWriter writer) {
        ElementStyle elementStyle = view.getViewSet().getConfiguration().getStyles().findElementStyle(deploymentNode);
        ElementView elementView = view.getElementView(deploymentNode);

        String line = String.format("<object placeholders=\"1\" c4Name=\"%s\" c4Type=\"DeploymentNodeScopeBoundary\" c4Application=\"DeploymentNode\" label=\"&lt;font style=&quot;font-size: 16px&quot;&gt;&lt;b&gt;&lt;div style=&quot;text-align: left&quot;&gt;%c4Name%&lt;/div&gt;&lt;/b&gt;&lt;/font&gt;&lt;div style=&quot;text-align: left&quot;&gt;[%c4Application%]&lt;/div&gt;\" id=\"%s\">", deploymentNode.getName(), deploymentNode.getId());
        writer.writeLine(line);
        writer.indent();
        writer.writeLine("<mxCell style=\"rounded=1;fontSize=11;whiteSpace=wrap;html=1;dashed=1;arcSize=20;fillColor=none;strokeColor=#666666;fontColor=#333333;labelBackgroundColor=none;align=left;verticalAlign=bottom;labelBorderColor=none;spacingTop=0;spacing=10;dashPattern=8 4;metaEdit=1;rotatable=0;perimeter=rectanglePerimeter;noLabel=0;labelPadding=0;allowArrows=0;connectable=0;expand=0;recursiveResize=0;editable=1;pointerEvents=0;absoluteArcSize=1;points=[[0.25,0,0],[0.5,0,0],[0.75,0,0],[1,0.25,0],[1,0.5,0],[1,0.75,0],[0.75,1,0],[0.5,1,0],[0.25,1,0],[0,0.75,0],[0,0.5,0],[0,0.25,0]];\" vertex=\"1\" parent=\"1\">");
        writer.indent();
        line = String.format("<mxGeometry x=\"%d\" y=\"%d\" width=\"%d\" height=\"%d\" as=\"geometry\" />", elementView.getX(), elementView.getY(), elementStyle.getWidth(), elementStyle.getHeight());
        writer.writeLine(line);
        writer.outdent();
        writer.writeLine("</mxCell>");
        writer.outdent();
        writer.writeLine("</object>");
    }

    @Override
    protected void endDeploymentNodeBoundary(ModelView view, IndentingWriter writer) {
    }

    @Override
    protected void writeElement(ModelView view, Element element, IndentingWriter writer) {
        ElementStyle elementStyle = view.getViewSet().getConfiguration().getStyles().findElementStyle(element);

        int nameFontSize = elementStyle.getFontSize() + 10;
        int metadataFontSize = elementStyle.getFontSize() - 5;
        int descriptionFontSize = elementStyle.getFontSize();


        Shape shape = view.getViewSet().getConfiguration().getStyles().findElementStyle(element).getShape();
//        String shape = shapeOf(view, element);
        String name = element.getName();
        String description = element.getDescription();
        String type = typeOf(view, element, true);

        if (element instanceof StaticStructureElementInstance) {
            StaticStructureElementInstance elementInstance = (StaticStructureElementInstance)element;
            name = elementInstance.getElement().getName();
            description = elementInstance.getElement().getDescription();
            type = typeOf(view, elementInstance.getElement(), true);
            shape = view.getViewSet().getConfiguration().getStyles().findElementStyle(elementInstance.getElement()).getShape();
            //shape = shapeOf(view, elementInstance.getElement());
        }

        switch(shape) {
            case Circle: {}
            break;
            case Box:{}
            break;
            case RoundedBox:{}
            case Ellipse:{}
            break;
            case Hexagon: {}
            break;
            case Diamond:{}
            break;
            case Cylinder:{}
            break;
            case Pipe:{}
            break;
            case Person:{}
            break;
            case Robot:{}
            break;
            case Folder:{}
            break;
            case WebBrowser:{}
            break;
            case Window:{}
            break;
            case MobileDevicePortrait:{}
            break;
            case MobileDeviceLandscape:{}
            break;
            case Component:{}
            break;
        }

        if (StringUtils.isNullOrEmpty(name)) {
            name = "";
        } else {
            name = String.format("<font point-size=\"%s\">%s</font>", nameFontSize, breakText(elementStyle.getWidth(), nameFontSize, escape(name)));
        }

        if (StringUtils.isNullOrEmpty(description) || false == elementStyle.getDescription()) {
            description = "";
        } else {
            description = String.format("<br /><br /><font point-size=\"%s\">%s</font>", descriptionFontSize, breakText(elementStyle.getWidth(), descriptionFontSize, escape(description)));
        }

        if (StringUtils.isNullOrEmpty(type) || false == elementStyle.getMetadata()) {
            type = "";
        } else {
            type = String.format("<br /><font point-size=\"%s\">%s</font>", metadataFontSize, type);
        }

        writer.writeLine(String.format("%s [id=%s,shape=%s, label=<%s%s%s>, style=filled, color=\"%s\", fillcolor=\"%s\", fontcolor=\"%s\"]",
                element.getId(),
                element.getId(),
                shape,
                name,
                type,
                description,
                elementStyle.getStroke(),
                elementStyle.getBackground(),
                elementStyle.getColor()
        ));
    }

    @Override
    protected void writeRelationship(ModelView view, RelationshipView relationshipView, IndentingWriter writer) {
        Element source;
        Element destination;

        RelationshipStyle relationshipStyle = view.getViewSet().getConfiguration().getStyles().findRelationshipStyle(relationshipView.getRelationship());
        relationshipStyle.setWidth(400);
        int descriptionFontSize = relationshipStyle.getFontSize();
        int metadataFontSize = relationshipStyle.getFontSize() - 5;

        String description = relationshipView.getDescription();
        if (StringUtils.isNullOrEmpty(description)) {
            description = relationshipView.getRelationship().getDescription();
        }

        if (!StringUtils.isNullOrEmpty(relationshipView.getOrder())) {
            description = relationshipView.getOrder() + ". " + description;
        }

        if (StringUtils.isNullOrEmpty(description)) {
            description = "";
        } else {
            description = breakText(relationshipStyle.getWidth(), descriptionFontSize, description);
            description = String.format("<font point-size=\"%s\">%s</font>", descriptionFontSize, description);
        }

        String technology = relationshipView.getRelationship().getTechnology();
        if (StringUtils.isNullOrEmpty(technology)) {
            technology = "";
        } else {
            technology = String.format("<br /><font point-size=\"%s\">[%s]</font>", metadataFontSize, technology);
        }

        String clusterConfig = "";

        if (relationshipView.getRelationship().getSource() instanceof DeploymentNode || relationshipView.getRelationship().getDestination() instanceof DeploymentNode) {
            source = relationshipView.getRelationship().getSource();
            if (source instanceof DeploymentNode) {
                source = findElementInside((DeploymentNode)source, view);
            }

            destination = relationshipView.getRelationship().getDestination();
            if (destination instanceof DeploymentNode) {
                destination = findElementInside((DeploymentNode)destination, view);
            }

            if (source != null && destination != null) {

                if (relationshipView.getRelationship().getSource() instanceof DeploymentNode) {
                    clusterConfig += ",ltail=cluster_" + relationshipView.getRelationship().getSource().getId();
                }

                if (relationshipView.getRelationship().getDestination() instanceof DeploymentNode) {
                    clusterConfig += ",lhead=cluster_" + relationshipView.getRelationship().getDestination().getId();
                }
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

        writer.writeLine(String.format("%s -> %s [id=%s, label=<%s%s>, style=\"%s\", color=\"%s\", fontcolor=\"%s\"%s]",
                source.getId(),
                destination.getId(),
                relationshipView.getId(),
                description,
                technology,
                solid ? "solid" : "dashed",
                relationshipStyle.getColor(),
                relationshipStyle.getColor(),
                clusterConfig
        ));
    }

    private String escape(String s) {
        if (StringUtils.isNullOrEmpty(s)) {
            return s;
        } else {
            return s.replaceAll("\"", "\\\\\"");
        }
    }

    private String shapeOf(ModelView view, Element element) {
        if (element instanceof DeploymentNode) {
            return "node";
        }

        Shape shape = view.getViewSet().getConfiguration().getStyles().findElementStyle(element).getShape();
        switch(shape) {
            case Circle:
                return "circle";
            case Component:
                return "component";
            case Cylinder:
                return "cylinder";
            case Ellipse:
                return "ellipse";
            case Folder:
                return "folder";
            case Hexagon:
                return "hexagon";
            case Diamond:
                return "diamond";
            default:
                return "rect";
        }
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
        return new DOTDiagram(view, definition);
    }

}