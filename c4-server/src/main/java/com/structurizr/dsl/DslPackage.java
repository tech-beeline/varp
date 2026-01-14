package com.structurizr.dsl;

import java.util.List;

public class DslPackage {

	public record Line(int number, String source) {
	}

    public static List<Line> processPreProcessLines(Object result) {
        return ((List<?>)result)
        .stream()
        .sequential()
        .map(DslLine.class::cast)
        .map(dl -> new Line(dl.getLineNumber(), dl.getSource())).toList();
    }
}
