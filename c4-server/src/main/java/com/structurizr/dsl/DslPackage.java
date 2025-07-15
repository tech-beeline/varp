package com.structurizr.dsl;

import java.util.LinkedList;
import java.util.List;
import java.util.stream.Collectors;

public class DslPackage {

	public record Line(int lineNumber, String source) {
	}

    public static LinkedList<Line> processPreProcessLines(Object result) {
        return ((List<?>)result)
        .stream()
        .sequential()
        .map(DslLine.class::cast)
        .map(dl -> new Line(dl.getLineNumber(), dl.getSource()))
        .collect(Collectors.toCollection(LinkedList::new));
    }
}
