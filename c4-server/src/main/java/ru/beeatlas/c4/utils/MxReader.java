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

import com.structurizr.model.DeploymentNode;
import com.structurizr.model.Element;
import com.structurizr.view.*;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.w3c.dom.Document;
import org.w3c.dom.NodeList;

import javax.xml.parsers.DocumentBuilder;
import javax.xml.parsers.DocumentBuilderFactory;
import javax.xml.xpath.XPath;
import javax.xml.xpath.XPathConstants;
import javax.xml.xpath.XPathFactory;

import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.util.LinkedHashSet;
import java.util.Set;

public class MxReader {

    private static final Logger logger = LoggerFactory.getLogger(MxReader.class);
    private final int margin;
    private final boolean changePaperSize;

    public MxReader(int margin, boolean changePaperSize) {
        this.margin = margin;
        this.changePaperSize = changePaperSize;
    }

    public void parseAndApplyLayout(ModelView view, String mx) throws Exception {

        InputStream inputStream = new ByteArrayInputStream(mx.getBytes());
        DocumentBuilderFactory builderFactory = DocumentBuilderFactory.newInstance();
        builderFactory.setNamespaceAware(false);
        builderFactory.setValidating(false);
        builderFactory.setFeature("http://xml.org/sax/features/namespaces", false);
        builderFactory.setFeature("http://xml.org/sax/features/validation", false);
        builderFactory.setFeature("http://apache.org/xml/features/nonvalidating/load-dtd-grammar", false);
        builderFactory.setFeature("http://apache.org/xml/features/nonvalidating/load-external-dtd", false);

        DocumentBuilder builder = builderFactory.newDocumentBuilder();
        Document xmlDocument = builder.parse(inputStream);
        
        XPath xPath = XPathFactory.newInstance().newXPath();
        int transformX = 0;
        int transformY = 0;

        int minimumX = Integer.MAX_VALUE;
        int minimumY = Integer.MAX_VALUE;
        int maximumX = Integer.MIN_VALUE;
        int maximumY = Integer.MIN_VALUE;

        for (ElementView elementView : view.getElements()) {
            if (elementView.getElement() instanceof DeploymentNode) {
                // deployment nodes are clusters, so positioned automatically
                continue;
            }

            String expression = String.format("/mxfile/diagram/mxGraphModel/root/object[@id=\"%s\"]/mxCell/mxGeometry", elementView.getId());
            NodeList nodeList = (NodeList) xPath.compile(expression).evaluate(xmlDocument, XPathConstants.NODESET);
            if (nodeList.getLength() == 0) {
                continue;
            }

            String xs = nodeList.item(0).getAttributes().getNamedItem("x").getNodeValue();
            String ys = nodeList.item(0).getAttributes().getNamedItem("y").getNodeValue();

            logger.info("x = " + xs + " y = " + ys);

            double x = Double.parseDouble(xs) + transformX;
            double y = Double.parseDouble(ys) + transformY;

            elementView.setX((int) (x));
            elementView.setY((int) (y));

            minimumX = Math.min(elementView.getX(), minimumX);
            minimumY = Math.min(elementView.getY(), minimumY);

            ElementStyle style = view.getViewSet().getConfiguration().getStyles()
                     .findElementStyle(view.getModel().getElement(elementView.getId()));

            maximumX = Math.max(elementView.getX() + style.getWidth(), maximumX);
            maximumY = Math.max(elementView.getY() + style.getHeight(), maximumY);
        }

        for (RelationshipView relationshipView : view.getRelationships()) {
            String id = MxExporter.relationshipId(relationshipView);
            String expression = String.format("/mxfile/diagram/mxGraphModel/root/object[@id=\"%s\"]/mxCell/mxGeometry/Array/mxPoint", id);
            NodeList nodeList = (NodeList) xPath.compile(expression).evaluate(xmlDocument, XPathConstants.NODESET);
            if (nodeList.getLength() == 0) {
                continue;
            }
            Set<Vertex> vertices = new LinkedHashSet<>();            
            for (int i = 0; i < nodeList.getLength(); i++) {
                String xs = nodeList.item(i).getAttributes().getNamedItem("x").getNodeValue();
                String ys = nodeList.item(i).getAttributes().getNamedItem("y").getNodeValue();                
                double x = Double.parseDouble(xs) + transformX;
                double y = Double.parseDouble(ys) + transformY;
                //logger.info("REL x = " + xs + " y = " + ys);
                Vertex vertex = new Vertex((int) (x), (int) (y));
                vertices.add(vertex);
            }
            relationshipView.setVertices(vertices);
        }

        int pageWidth = Math.max(margin, maximumX + margin);
        int pageHeight = Math.max(margin, maximumY + margin);

        if (changePaperSize) {
            view.setPaperSize(null);
            view.setDimensions(new Dimensions(pageWidth, pageHeight));

            PaperSize.Orientation orientation = (pageWidth > pageHeight) ? PaperSize.Orientation.Landscape
                    : PaperSize.Orientation.Portrait;
            for (PaperSize paperSize : PaperSize.getOrderedPaperSizes(orientation)) {
                if (paperSize.getWidth() > (pageWidth) && paperSize.getHeight() > (pageHeight)) {
                    view.setPaperSize(paperSize);
                    break;
                }
            }
        }

        int deltaX = (pageWidth - maximumX + minimumX) / 2;
        int deltaY = (pageHeight - maximumY + minimumY) / 2;

        // move everything relative to 0,0
        for (ElementView elementView : view.getElements()) {
            elementView.setX(elementView.getX() - minimumX);
            elementView.setY(elementView.getY() - minimumY);
        }
        for (RelationshipView relationshipView : view.getRelationships()) {
            for (Vertex vertex : relationshipView.getVertices()) {
                vertex.setX(vertex.getX() - minimumX);
                vertex.setY(vertex.getY() - minimumY);
            }
        }

        // and now centre everything
        for (ElementView elementView : view.getElements()) {
            elementView.setX(elementView.getX() + deltaX);
            elementView.setY(elementView.getY() + deltaY);
        }
        for (RelationshipView relationshipView : view.getRelationships()) {
            for (Vertex vertex : relationshipView.getVertices()) {
                vertex.setX(vertex.getX() + deltaX);
                vertex.setY(vertex.getY() + deltaY);
            }
        }

    }

    private int getElementWidth(ModelView view, String elementId) {
        Element element = view.getModel().getElement(elementId);
        return view.getViewSet().getConfiguration().getStyles().findElementStyle(element).getWidth();
    }

    private int getElementHeight(ModelView view, String elementId) {
        Element element = view.getModel().getElement(elementId);
        return view.getViewSet().getConfiguration().getStyles().findElementStyle(element).getHeight();
    }

}