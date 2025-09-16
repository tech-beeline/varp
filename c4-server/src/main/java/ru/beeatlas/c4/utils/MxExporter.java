package ru.beeatlas.c4.utils;

import java.util.Collection;
import java.util.UUID;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import com.structurizr.export.AbstractDiagramExporter;
import com.structurizr.export.Diagram;
import com.structurizr.export.IndentingWriter;
import com.structurizr.model.*;
import com.structurizr.util.StringUtils;
import com.structurizr.view.*;

/**
 * Exports Structurizr views to Graphviz DOT definitions.
 */
public class MxExporter extends AbstractDiagramExporter {

    private static final Logger logger = LoggerFactory.getLogger(MxExporter.class);

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

        logger.info("startGroupBoundary");

        String color = "#cccccc";
        int metadataFontSize = 11;

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
            metadataFontSize = elementStyle.getFontSize() - 5;
        }

        int minX = Integer.MAX_VALUE, minY = Integer.MAX_VALUE;
        int maxX = Integer.MIN_VALUE, maxY = Integer.MIN_VALUE;

        for (ElementView elementView : view.getElements()) {
            GroupableElement ge = (GroupableElement)elementView.getElement();
            logger.info(group + " " + ge.getGroup());
            if(group.equals(ge.getGroup()) || (ge.getGroup() != null && ge.getGroup().startsWith(group) )) {
                logger.info("!");
                ElementStyle elementStyle0 = view.getViewSet().getConfiguration().getStyles().findElementStyle(ge);                
                if(elementView.getX() < minX) {
                    minX = elementView.getX();
                }
                if(elementView.getY() < minY) {
                    minY = elementView.getY();
                }
                if(elementView.getX() + elementStyle0.getWidth() > maxX) {
                    maxX = elementView.getX() + elementStyle0.getWidth();
                }
                if(elementView.getY() + elementStyle0.getHeight() > maxY) {
                    maxY = elementView.getY() + elementStyle0.getHeight();
                }
            }
        }

        minX -= clusterInternalMargin;
        minY -= clusterInternalMargin;
        maxX += clusterInternalMargin;
        maxY += clusterInternalMargin;

        StringBuilder sb = new StringBuilder();
        sb.append("<object placeholders=\"1\" c4Name=\"").append(groupName);
        sb.append(
                "\" c4Type=\"GroupScopeBoundary\" c4Application=\"Group\" label=\"&lt;font style=&quot;font-size: 16px&quot;&gt;&lt;b&gt;&lt;div style=&quot;text-align: left&quot;&gt;%c4Name%&lt;/div&gt;&lt;/b&gt;&lt;/font&gt;&lt;div style=&quot;text-align: left&quot;&gt;[%c4Application%]&lt;/div&gt;\" id=\"")
                .append(UUID.randomUUID());
        sb.append("\">");
        writer.writeLine(sb.toString());
        writer.indent();
        writer.writeLine("<mxCell style=\"rounded=1;fontSize=11;whiteSpace=wrap;html=1;dashed=1;arcSize=20;fillColor=none;strokeColor=#666666;fontColor=#333333;labelBackgroundColor=none;align=left;verticalAlign=bottom;labelBorderColor=none;spacingTop=0;spacing=10;dashPattern=8 4;metaEdit=1;rotatable=0;perimeter=rectanglePerimeter;noLabel=0;labelPadding=0;allowArrows=0;connectable=0;expand=0;recursiveResize=0;editable=1;pointerEvents=0;absoluteArcSize=1;points=[[0.25,0,0],[0.5,0,0],[0.75,0,0],[1,0.25,0],[1,0.5,0],[1,0.75,0],[0.75,1,0],[0.5,1,0],[0.25,1,0],[0,0.75,0],[0,0.5,0],[0,0.25,0]];\" vertex=\"1\" parent=\"1\">");
        writer.indent();
        String line = String.format("<mxGeometry x=\"%d\" y=\"%d\" width=\"%d\" height=\"%d\" as=\"geometry\" />", minX, minY, maxX - minX, maxY - minY);
        writer.writeLine(line);
        writer.outdent();
        writer.writeLine("</mxCell>");
        writer.outdent();
        writer.writeLine("</object>");

    }

    @Override
    protected void endGroupBoundary(ModelView view, IndentingWriter writer) {
    }

    @Override
    protected void startSoftwareSystemBoundary(ModelView view, SoftwareSystem softwareSystem, IndentingWriter writer) {
        // String color;
        // if (softwareSystem.equals(view.getSoftwareSystem())) {
        //     color = "#444444";
        // } else {
        //     color = "#cccccc";
        // }

        // ElementStyle elementStyle = view.getViewSet().getConfiguration().getStyles().findElementStyle(softwareSystem);
        // ElementView elementView = view.getElementView(softwareSystem);

        // String line = MessageFormat.format("<object placeholders=\"1\" c4Name=\"{0}\" c4Type=\"SystemScopeBoundary\" c4Application=\"Software System\" label=\"&lt;font style=&quot;font-size: 16px&quot;&gt;&lt;b&gt;&lt;div style=&quot;text-align: left&quot;&gt;%c4Name%&lt;/div&gt;&lt;/b&gt;&lt;/font&gt;&lt;div style=&quot;text-align: left&quot;&gt;[%c4Application%]&lt;/div&gt;\" id=\"{1}\">", softwareSystem.getName(), softwareSystem.getId());
        // writer.writeLine(line);
        // writer.indent();
        // writer.writeLine("<mxCell style=\"rounded=1;fontSize=11;whiteSpace=wrap;html=1;dashed=1;arcSize=20;fillColor=none;strokeColor=#666666;fontColor=#333333;labelBackgroundColor=none;align=left;verticalAlign=bottom;labelBorderColor=none;spacingTop=0;spacing=10;dashPattern=8 4;metaEdit=1;rotatable=0;perimeter=rectanglePerimeter;noLabel=0;labelPadding=0;allowArrows=0;connectable=0;expand=0;recursiveResize=0;editable=1;pointerEvents=0;absoluteArcSize=1;points=[[0.25,0,0],[0.5,0,0],[0.75,0,0],[1,0.25,0],[1,0.5,0],[1,0.75,0],[0.75,1,0],[0.5,1,0],[0.25,1,0],[0,0.75,0],[0,0.5,0],[0,0.25,0]];\" vertex=\"1\" parent=\"1\">");
        // writer.indent();
        // line = String.format("<mxGeometry x=\"%d\" y=\"%d\" width=\"%d\" height=\"%d\" as=\"geometry\" />", elementView.getX(), elementView.getY(), elementStyle.getWidth(), elementStyle.getHeight());
        // writer.writeLine(line);
        // writer.outdent();
        // writer.writeLine("</mxCell>");
        // writer.outdent();
        // writer.writeLine("</object>");
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

        // ElementStyle elementStyle = view.getViewSet().getConfiguration().getStyles().findElementStyle(container);
        // ElementView elementView = view.getElementView(container);

        // StringBuilder sb = new StringBuilder();
        // sb.append("<object placeholders=\"1\" c4Name=\"").append(container.getName());
        // sb.append(" c4Type=\"ContainerScopeBoundary\" c4Application=\"Container\" label=\"&lt;font style=&quot;font-size: 16px&quot;&gt;&lt;b&gt;&lt;div style=&quot;text-align: left&quot;&gt;%c4Name%&lt;/div&gt;&lt;/b&gt;&lt;/font&gt;&lt;div style=&quot;text-align: left&quot;&gt;[%c4Application%]&lt;/div&gt;\" id=\"").append(container.getId());
        // writer.writeLine(sb.toString());
        // writer.indent();
        // writer.writeLine("<mxCell style=\"rounded=1;fontSize=11;whiteSpace=wrap;html=1;dashed=1;arcSize=20;fillColor=none;strokeColor=#666666;fontColor=#333333;labelBackgroundColor=none;align=left;verticalAlign=bottom;labelBorderColor=none;spacingTop=0;spacing=10;dashPattern=8 4;metaEdit=1;rotatable=0;perimeter=rectanglePerimeter;noLabel=0;labelPadding=0;allowArrows=0;connectable=0;expand=0;recursiveResize=0;editable=1;pointerEvents=0;absoluteArcSize=1;points=[[0.25,0,0],[0.5,0,0],[0.75,0,0],[1,0.25,0],[1,0.5,0],[1,0.75,0],[0.75,1,0],[0.5,1,0],[0.25,1,0],[0,0.75,0],[0,0.5,0],[0,0.25,0]];\" vertex=\"1\" parent=\"1\">");
        // writer.indent();
        // String line = String.format("<mxGeometry x=\"%d\" y=\"%d\" width=\"%d\" height=\"%d\" as=\"geometry\" />", elementView.getX(), elementView.getY(), elementStyle.getWidth(), elementStyle.getHeight());
        // writer.writeLine(line);
        // writer.outdent();
        // writer.writeLine("</mxCell>");
        // writer.outdent();
        // writer.writeLine("</object>");
    }

    @Override
    protected void endContainerBoundary(ModelView view, IndentingWriter writer) {
    }

    @Override
    protected void startDeploymentNodeBoundary(DeploymentView view, DeploymentNode deploymentNode, IndentingWriter writer) {
        // ElementStyle elementStyle = view.getViewSet().getConfiguration().getStyles().findElementStyle(deploymentNode);
        // ElementView elementView = view.getElementView(deploymentNode);

        // String line = MessageFormat.format("<object placeholders=\"1\" c4Name=\"{0}\" c4Type=\"DeploymentNodeScopeBoundary\" c4Application=\"DeploymentNode\" label=\"&lt;font style=&quot;font-size: 16px&quot;&gt;&lt;b&gt;&lt;div style=&quot;text-align: left&quot;&gt;%c4Name%&lt;/div&gt;&lt;/b&gt;&lt;/font&gt;&lt;div style=&quot;text-align: left&quot;&gt;[%c4Application%]&lt;/div&gt;\" id=\"{1}\">", deploymentNode.getName(), deploymentNode.getId());
        // writer.writeLine(line);
        // writer.indent();
        // writer.writeLine("<mxCell style=\"rounded=1;fontSize=11;whiteSpace=wrap;html=1;dashed=1;arcSize=20;fillColor=none;strokeColor=#666666;fontColor=#333333;labelBackgroundColor=none;align=left;verticalAlign=bottom;labelBorderColor=none;spacingTop=0;spacing=10;dashPattern=8 4;metaEdit=1;rotatable=0;perimeter=rectanglePerimeter;noLabel=0;labelPadding=0;allowArrows=0;connectable=0;expand=0;recursiveResize=0;editable=1;pointerEvents=0;absoluteArcSize=1;points=[[0.25,0,0],[0.5,0,0],[0.75,0,0],[1,0.25,0],[1,0.5,0],[1,0.75,0],[0.75,1,0],[0.5,1,0],[0.25,1,0],[0,0.75,0],[0,0.5,0],[0,0.25,0]];\" vertex=\"1\" parent=\"1\">");
        // writer.indent();
        // line = String.format("<mxGeometry x=\"%d\" y=\"%d\" width=\"%d\" height=\"%d\" as=\"geometry\" />", elementView.getX(), elementView.getY(), elementStyle.getWidth(), elementStyle.getHeight());
        // writer.writeLine(line);
        // writer.outdent();
        // writer.writeLine("</mxCell>");
        // writer.outdent();
        // writer.writeLine("</object>");
    }

    @Override
    protected void endDeploymentNodeBoundary(ModelView view, IndentingWriter writer) {
    }

    @Override
    protected void writeElement(ModelView view, Element element, IndentingWriter writer) {

        ElementView elementView = view.getElementView(element);
        String id = element.getId();

        if (element instanceof StaticStructureElementInstance) {
            StaticStructureElementInstance elementInstance = (StaticStructureElementInstance)element;
            element = elementInstance.getElement();
        }

        ElementStyle elementStyle = view.getViewSet().getConfiguration().getStyles().findElementStyle(element);

        int nameFontSize = elementStyle.getFontSize() + 10;
        int metadataFontSize = elementStyle.getFontSize() - 5;
        int descriptionFontSize = elementStyle.getFontSize();
        String color = elementStyle.getColor();
        String stroke = elementStyle.getStroke();
        String background = elementStyle.getBackground();

        Shape shape = view.getViewSet().getConfiguration().getStyles().findElementStyle(element).getShape();
        String name = element.getName();
        String description = element.getDescription();
        name = name.replace("&", "&amp;");
        description = description.replace("&", "&amp;");

        if(element instanceof Person) {
            person(writer,name,description,id,nameFontSize,metadataFontSize,descriptionFontSize,color,stroke,background,elementView.getX(), elementView.getY(), elementStyle.getWidth(), elementStyle.getHeight());
        } else if(element instanceof Container) {
            Container container = ((Container)element);
            elementShape(shape, writer, "Container", name, container.getTechnology(), description, id, nameFontSize, metadataFontSize, descriptionFontSize, color, stroke, background, elementView.getX(), elementView.getY(), elementStyle.getWidth(), elementStyle.getHeight());
        } else if(element instanceof SoftwareSystem) {
            elementShape(shape, writer, "Software System", name, null, description, id, nameFontSize, metadataFontSize, descriptionFontSize, color, stroke, background, elementView.getX(), elementView.getY(), elementStyle.getWidth(), elementStyle.getHeight());
        } else if(element instanceof Component) {
            Component component = ((Component)element);
            String technolodgy = component.getTechnology() == null ? "" : component.getTechnology();
            elementShape(shape, writer, "Component", name, technolodgy, description, id, nameFontSize, metadataFontSize, descriptionFontSize, color, stroke, background, elementView.getX(), elementView.getY(), elementStyle.getWidth(), elementStyle.getHeight());
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
        sb.append(";shape=mxgraph.c4.person2;align=center;metaEdit=1;points=[[0.5,0,0],[1,0.5,0],[1,0.75,0],[0.75,1,0],[0.5,1,0],[0.25,1,0],[0,0.75,0],[0,0.5,0]];resizable=0;\" vertex=\"1\" parent=\"1\">");
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
        sb.append(";metaEdit=1;resizable=0;points=[[0.25,0,0],[0.5,0,0],[0.75,0,0],[1,0.25,0],[1,0.5,0],[1,0.75,0],[0.75,1,0],[0.5,1,0],[0.25,1,0],[0,0.75,0],[0,0.5,0],[0,0.25,0]];\" vertex=\"1\" parent=\"1\">");
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
        logger.info("aaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
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
        sb.append(";metaEdit=1;resizable=0;points=[[0.25,0,0],[0.5,0,0],[0.75,0,0],[1,0.25,0],[1,0.5,0],[1,0.75,0],[0.75,1,0],[0.5,1,0],[0.25,1,0],[0,0.75,0],[0,0.5,0],[0,0.25,0]];\" vertex=\"1\" parent=\"1\">");
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
        sb.append(";metaEdit=1;resizable=0;points=[[0.5,0,0],[1,0.25,0],[1,0.5,0],[1,0.75,0],[0.5,1,0],[0,0.75,0],[0,0.5,0],[0,0.25,0]];\" vertex=\"1\" parent=\"1\">");
        writer.writeLine(sb.toString());
        sb.setLength(0);
        writer.indent();
        sb.append("<mxGeometry x=\"").append(x);
        sb.append("\" y=\"").append(y);
        height = (int) (0.89 * width);
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
        sb.append(";metaEdit=1;resizable=0;points=[[0.5,0,0],[1,0.25,0],[1,0.5,0],[1,0.75,0],[0.5,1,0],[0,0.75,0],[0,0.5,0],[0,0.25,0]];\" vertex=\"1\" parent=\"1\">");
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
        sb.append(";metaEdit=1;resizable=0;points=[[0.25,0,0],[0.5,0,0],[0.75,0,0],[1,0.25,0],[1,0.5,0],[1,0.75,0],[0.75,1,0],[0.5,1,0],[0.25,1,0],[0,0.75,0],[0,0.5,0],[0,0.25,0]];\" vertex=\"1\" parent=\"1\">");
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
        sb.append(";metaEdit=1;resizable=0;points=[[0.5,0,0],[1,0.25,0],[1,0.5,0],[1,0.75,0],[0.5,1,0],[0,0.75,0],[0,0.5,0],[0,0.25,0]];\" vertex=\"1\" parent=\"1\">");
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

    @Override
    protected void writeRelationship(ModelView view, RelationshipView relationshipView, IndentingWriter writer) {
        Element source;
        Element destination;

        RelationshipStyle relationshipStyle = view.getViewSet().getConfiguration().getStyles().findRelationshipStyle(relationshipView.getRelationship());
        //relationshipStyle.setWidth(400);
        String color = relationshipStyle.getColor();
        //String strock = relationshipStyle.
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
//            description = breakText(relationshipStyle.getWidth(), descriptionFontSize, description);
//            description = String.format("<font point-size=\"%s\">%s</font>", descriptionFontSize, description);
        }

        String technology = relationshipView.getRelationship().getTechnology();
        if (StringUtils.isNullOrEmpty(technology)) {
            technology = "";
        } else {
            //technology = String.format("<br /><font point-size=\"%s\">[%s]</font>", metadataFontSize, technology);
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

        StringBuilder sb = new StringBuilder();
        sb.append("<object placeholders=\"1\" c4Type=\"Relationship\" c4Technology=\"").append(technology);
        sb.append("\" c4Description=\"").append(description);
        sb.append("\" label=\"&lt;div style=&quot;text-align: left&quot;&gt;&lt;div style=&quot;text-align: center&quot;&gt;&lt;b&gt;%c4Description%&lt;/b&gt;&lt;/div&gt;&lt;div style=&quot;text-align: center&quot;&gt;[%c4Technology%]&lt;/div&gt;&lt;/div&gt;\" id=\"").append(relationshipView.getId());
        sb.append("\">");
        writer.writeLine(sb.toString());
        sb.setLength(0);

        //String line = MessageFormat.format("<object placeholders=\"1\" c4Type=\"Relationship\" c4Technology=\"{0}\" c4Description=\"{1}\" label=\"&lt;div style=&quot;text-align: left&quot;&gt;&lt;div style=&quot;text-align: center&quot;&gt;&lt;b&gt;%c4Description%&lt;/b&gt;&lt;/div&gt;&lt;div style=&quot;text-align: center&quot;&gt;[%c4Technology%]&lt;/div&gt;&lt;/div&gt;\" id=\"{2}\">", technology, description, relationshipView.getId());
        //writer.writeLine(line);
        writer.indent();
//      line = MessageFormat.format("<mxCell style=\"endArrow=blockThin;html=1;fontSize=10;fontColor=#404040;strokeWidth=1;endFill=1;strokeColor=#828282;elbow=vertical;metaEdit=1;endSize=14;startSize=14;jumpStyle=arc;jumpSize=16;rounded=0;edgeStyle=orthogonalEdgeStyle;exitX=0.25;exitY=1;exitDx=0;exitDy=0;exitPerimeter=0;entryX=0.5;entryY=0;entryDx=0;entryDy=0;entryPerimeter=0;\" edge=\"1\" parent=\"1\" source=\"{0}\" target=\"{1}\">", source.getId(), destination.getId());
        sb.append("<mxCell style=\"whiteSpace=wrap;endArrow=block;html=1;fontSize=").append(relationshipStyle.getFontSize());
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
        sb.append(";elbow=vertical;metaEdit=1;endSize=20;startSize=20;jumpStyle=arc;jumpSize=16;rounded=0;\" edge=\"1\" parent=\"1\" source=\"").append(source.getId());
        sb.append("\" target=\"").append(destination.getId());
        sb.append("\">");

        //line = MessageFormat.format("<mxCell style=\"endArrow=blockThin;html=1;fontSize=10;fontColor=#404040;strokeWidth=1;endFill=1;strokeColor=#828282;elbow=vertical;metaEdit=1;endSize=14;startSize=14;jumpStyle=arc;jumpSize=16;rounded=0;\" edge=\"1\" parent=\"1\" source=\"{0}\" target=\"{1}\">", source.getId(), destination.getId());
        //writer.writeLine(line);
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
        return new MxDiagram(view, definition);
    }

}