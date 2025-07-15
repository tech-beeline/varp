package ru.beeatlas.c4.utils;

import java.io.File;
import java.io.FileWriter;
import java.io.IOException;
import java.util.List;
import java.util.Optional;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import com.google.common.collect.Iterables;
import com.google.common.collect.Lists;
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

        if(line == null || line.length()==0 || key == null || key.length() == 0) {
            return NOT_FOUND_WITHIN_STRING;
        }

		Matcher m = Pattern.compile("\\b"+key+"\\b", Pattern.CASE_INSENSITIVE).matcher(line);
		if (m.find()) {
   			return m.start();
		}

		return NOT_FOUND_WITHIN_STRING;
	}

	public static String getIdentifierOfView(View view) {

		if(view instanceof ContainerView || view instanceof SystemContextView || view instanceof DeploymentView) {
			return ((ModelView)view).getSoftwareSystemId();
		}
		else if(view instanceof ComponentView) {
			return ((ComponentView)view).getContainerId();
		}
		else if(view instanceof DynamicView) {
			return ((DynamicView)view).getElementId();
		}

		return null;

	}

    public static int findFirstNonWhitespace(final CharSequence line, int startPos,
            boolean treatNewLineAsWhitespace) {
        
        if (line == null || line.length() == 0 || startPos < 0 || startPos >= line.length()) {
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

}
