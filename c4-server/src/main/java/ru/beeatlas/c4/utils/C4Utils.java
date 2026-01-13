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

import java.awt.Font;
import java.awt.FontMetrics;
import java.awt.Graphics2D;
import java.awt.image.BufferedImage;
import java.io.File;
import java.io.FileWriter;
import java.io.IOException;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import com.google.common.collect.Iterables;
import com.google.common.collect.Lists;
import com.structurizr.export.Diagram;
import com.structurizr.view.AutomaticLayout;
import com.structurizr.view.ComponentView;
import com.structurizr.view.ContainerView;
import com.structurizr.view.DeploymentView;
import com.structurizr.view.DynamicView;
import com.structurizr.view.ModelView;
import com.structurizr.view.SystemContextView;
import com.structurizr.view.View;

public class C4Utils {

    public static final int NOT_FOUND_WITHIN_STRING = -1;

    public static void writeContentToFile(File out, String content) throws IOException {
        out.getParentFile().mkdirs();
        FileWriter fw = new FileWriter(out);
        fw.write(content);
        fw.close();
    }

    public static int getStartPosition(String line, String key) {

        if(line == null || line.isEmpty() || key == null || key.isEmpty()) {
            return NOT_FOUND_WITHIN_STRING;
        }

		Matcher m = Pattern.compile("\\b"+key+"\\b", Pattern.CASE_INSENSITIVE).matcher(line);
		if (m.find()) {
   			return m.start();
		}

		return NOT_FOUND_WITHIN_STRING;
	}

	public static String getIdentifierOfView(View view) {
		if(view instanceof DynamicView dynamicView) {
			return dynamicView.getElementId();
		} else if(view instanceof ComponentView componentView) {
			return componentView.getContainerId();
		} else if(view instanceof ModelView modelView) {
			return modelView.getSoftwareSystemId();
		}
		return null;
	}

    public static int findFirstNonWhitespace(final CharSequence line, int startPos,
            boolean treatNewLineAsWhitespace) {
        
        if (line == null || line.isEmpty() || startPos < 0 || startPos >= line.length()) {
            return NOT_FOUND_WITHIN_STRING;
        }

        int len = line.length();
        int pos = startPos;
        char c = line.charAt(pos);

        do {
            c = line.charAt(pos);
            if (!treatNewLineAsWhitespace) {
                if (c == '\n' || c == '\r')
                    return NOT_FOUND_WITHIN_STRING;
            }
            if (c > ' ')
                return pos;
            pos++;
        } while (pos < len);

        return NOT_FOUND_WITHIN_STRING;
    }	

    public static boolean isBlank(String str) {
        return str == null || str.trim().isEmpty();
    }

    public static Optional<String> leftFromCursor(String line, int cursor) {

        if(line == null || cursor < 0) {
            return Optional.empty();
        }
        return Optional.ofNullable(line.substring(0, cursor).trim());
    }

    public static<T> List<T> merge(List<T> list1, List<T> list2) {
        return Lists.newArrayList(Iterables.concat(list1, list2));
    }

    public static String trimTrailingSlash(String text) {
        return text.substring(0, text.length() - (text.endsWith("/") ? 1 : 0));
    }    

    public static String trimStringByString(String text, String trimBy) {
        int beginIndex = 0;
        int endIndex = text.length();
    
        while (text.substring(beginIndex, endIndex).startsWith(trimBy)) {
            beginIndex += trimBy.length();
        } 
    
        while (text.substring(beginIndex, endIndex).endsWith(trimBy)) {
            endIndex -= trimBy.length();
        }
    
        return text.substring(beginIndex, endIndex);
    }

    public static String export2Dot(ModelView modelView) {
        AutomaticLayout automaticLayout = modelView.getAutomaticLayout();
        DOTExporter exporter = (automaticLayout == null)
                ? new DOTExporter(RankDirection.TopBottom, 300, 300)
                : new DOTExporter(
                        RankDirection.valueOf(automaticLayout.getRankDirection().name()),
                        automaticLayout.getRankSeparation(),
                        automaticLayout.getNodeSeparation());
        exporter.setLocale(Locale.US);
        Diagram diagram = exporter.export(modelView);
        return diagram.getDefinition();
    }

    public static String export2Mx(ModelView modelView) {
        MxExporter exporter = new MxExporter();
        Diagram diagram = exporter.export(modelView);
        return diagram.getDefinition();
    }

    public static int getFontHeight(String fontName, int fontSize) {
        BufferedImage bufferedImage = new BufferedImage(1, 1, BufferedImage.TYPE_INT_ARGB);
        Graphics2D graphics = bufferedImage.createGraphics();
        Font font = new Font(fontName, Font.PLAIN, fontSize);
        graphics.setFont(font);
        FontMetrics metrics = graphics.getFontMetrics();
        return metrics.getHeight();
    }

}
