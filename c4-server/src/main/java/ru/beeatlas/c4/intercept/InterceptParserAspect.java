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

package ru.beeatlas.c4.intercept;

import java.io.File;
import java.lang.reflect.Field;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.LinkedList;
import java.util.List;
import java.util.Optional;
import java.util.Stack;

import org.aspectj.lang.JoinPoint;
import org.aspectj.lang.ProceedingJoinPoint;
import org.aspectj.lang.annotation.After;
import org.aspectj.lang.annotation.AfterReturning;
import org.aspectj.lang.annotation.Around;
import org.aspectj.lang.annotation.Aspect;
import org.aspectj.lang.annotation.Before;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import com.google.inject.Inject;
import com.structurizr.model.Component;
import com.structurizr.model.Container;
import com.structurizr.model.ContainerInstance;
import com.structurizr.model.DeploymentNode;
import com.structurizr.model.InfrastructureNode;
import com.structurizr.model.Person;
import com.structurizr.model.Relationship;
import com.structurizr.model.SoftwareSystem;
import com.structurizr.model.SoftwareSystemInstance;
import com.structurizr.view.RelationshipView;
import com.structurizr.view.SystemContextView;
import com.structurizr.view.ComponentView;
import com.structurizr.view.ContainerView;
import com.structurizr.view.DeploymentView;
import com.structurizr.view.DynamicView;
import com.structurizr.view.FilteredView;
import com.structurizr.dsl.DslPackage.*;
import com.structurizr.dsl.DslPackage;
import com.structurizr.dsl.StructurizrDslParserException;

@Aspect
public class InterceptParserAspect {

    @Inject
    StructurizrDslParserListener parserListener;
    
    private static final Logger logger = LoggerFactory.getLogger(InterceptParserAspect.class);
    private static final String BOM = "\uFEFF";            

    @After("within(com.structurizr.dsl.StructurizrDslParser) && execution(* startContext(..))")
    public void interceptStartContextAdvice(JoinPoint joinPoint) throws Exception {
        getContext(joinPoint).ifPresent(
                context -> parserListener.onStartContext(context.hashCode(), context.getClass().getSimpleName()));
    }

    private Optional<Object> getContext(JoinPoint joinPoint) throws Exception {

        try {
            Field field;
            field = joinPoint.getThis().getClass().getDeclaredField("contextStack");
            field.setAccessible(true);
            Stack<?> contextStack = (Stack<?>) field.get(joinPoint.getThis());
            if(contextStack != null && !contextStack.empty()) {
                return Optional.of(contextStack.peek());
            }
        } catch (NoSuchFieldException | SecurityException | IllegalArgumentException | IllegalAccessException e) {
            logger.error("Cannot determine context for {}: {}", joinPoint.toLongString(), e.getMessage());
        }

        return Optional.empty();
    }

    @After("within(com.structurizr.dsl.StructurizrDslParser) && execution(* parse(com.structurizr.dsl.DslParserContext, java.io.File))")
    public void interceptParseAfter(JoinPoint joinPoint) throws Exception {
        File file = (File)joinPoint.getArgs()[1];
        parserListener.onExtendsBy(file);
    }

    @Before("within(com.structurizr.dsl.StructurizrDslParser) && execution(* endContext(..))")
    public void interceptEndContextAdvice(JoinPoint joinPoint) throws Exception {
        getContext(joinPoint).ifPresent(
                context -> parserListener.onEndContext(context.hashCode(), context.getClass().getSimpleName()));
    }

    @Around("within(com.structurizr.dsl.StructurizrDslParser) && execution(* parse(java.util.List<String>, java.io.File, boolean, boolean))")
    public void interceptParseAround(ProceedingJoinPoint joinPoint) throws StructurizrDslParserException {
        Object[] args = joinPoint.getArgs();
        File file = (File)args[1];
        parserListener.onStartFile(file);
        String content = parserListener.findContent(file);
        if(content != null) {
            List<String> lines = Arrays.asList(content.split("\\r?\\n"));
            List<String> paddedLines = new ArrayList<>();
            String leadingSpace = "";
            for (String unpaddedLine : lines) {
                if (unpaddedLine.startsWith(BOM)) {
                    // this caters for files encoded as "UTF-8 with BOM"
                    unpaddedLine = unpaddedLine.substring(1);
                }
                paddedLines.add(leadingSpace + unpaddedLine);
            }            
            args[0] = paddedLines;
        }
        try {
            joinPoint.proceed(args);
        } catch (Throwable e) {
            parserListener.onException((StructurizrDslParserException) e);
        }
        parserListener.onEndFile();
    }

    @After("within(com.structurizr.dsl.DslLine) && execution(* getSource())")
    public void interceptGetSourceAfter(JoinPoint joinPoint) throws Exception {
        parserListener.onNewLine();
    }

    @AfterReturning(pointcut = "within(com.structurizr.dsl.DynamicViewParser) && execution(com.structurizr.view.DynamicView parse(..))", returning = "result")
    public void interceptParseDynamicViewAfterReturning(JoinPoint joinPoint, Object result) {
        DynamicView view = (DynamicView)result;
        parserListener.onParsedView(view);
    }

    @AfterReturning(pointcut = "within(com.structurizr.dsl.DeploymentViewParser) && execution(com.structurizr.view.DeploymentView parse(..))", returning = "result")
    public void interceptParseDeploymentViewAfterReturning(JoinPoint joinPoint, Object result) {
        DeploymentView view = (DeploymentView)result;
        parserListener.onParsedView(view);
    }
    
    @AfterReturning(pointcut = "within(com.structurizr.dsl.ContainerViewParser) && execution(com.structurizr.view.ContainerView parse(..))", returning = "result")
    public void interceptParseContainerViewAfterReturning(JoinPoint joinPoint, Object result) {
        ContainerView view = (ContainerView)result;
        parserListener.onParsedView(view);
    }

    @AfterReturning(pointcut = "within(com.structurizr.dsl.ComponentViewParser) && execution(com.structurizr.view.ComponentView parse(..))", returning = "result")
    public void interceptParseComponentViewAfterReturning(JoinPoint joinPoint, Object result) {
        ComponentView view = (ComponentView)result;
        parserListener.onParsedView(view);
    }    

    @AfterReturning(pointcut = "within(com.structurizr.dsl.SystemContextViewParser) && execution(com.structurizr.view.SystemContextView parse(..))", returning = "result")
    public void interceptParseSystemContextViewAfterReturning(JoinPoint joinPoint, Object result) {
        SystemContextView view = (SystemContextView)result;
        parserListener.onParsedView(view);
    }

    @AfterReturning(pointcut = "within(com.structurizr.dsl.FilteredViewParser) && execution(com.structurizr.view.FilteredView parse(..))", returning = "result")
    public void interceptFilteredViewViewAfterReturning(JoinPoint joinPoint, Object result) {
        FilteredView view = (FilteredView)result;
        parserListener.onParsedView(view);
    }    

    @AfterReturning(pointcut = "within(com.structurizr.dsl.ContainerInstanceParser) && execution(com.structurizr.model.ContainerInstance parse(..))", returning = "result")
    public void interceptContainerInstanceAfterReturning(JoinPoint joinPoint, Object result) {
        ContainerInstance containerInstance = (ContainerInstance)result;
        parserListener.onParsedModelElement(containerInstance);
    }

    @AfterReturning(pointcut = "within(com.structurizr.dsl.SoftwareSystemInstanceParser) && execution(com.structurizr.model.SoftwareSystemInstance parse(..))", returning = "result")
    public void interceptSoftwareSystemInstanceAfterReturning(JoinPoint joinPoint, Object result) {
        SoftwareSystemInstance softwareSystemInstance = (SoftwareSystemInstance)result;
        parserListener.onParsedModelElement(softwareSystemInstance);
    }

    @AfterReturning(pointcut = "within(com.structurizr.dsl.InfrastructureNodeParser) && execution(com.structurizr.model.InfrastructureNode parse(..))", returning = "result")
    public void interceptInfrastructureNodeParser(JoinPoint joinPoint, Object result) {
        InfrastructureNode infrastructureNode = (InfrastructureNode)result;
        parserListener.onParsedModelElement(infrastructureNode);
    }

    @AfterReturning(pointcut = "within(com.structurizr.dsl.DeploymentNodeParser) && execution(com.structurizr.model.DeploymentNode parse(..))", returning = "result")
    public void interceptDeploymentNodeParser(JoinPoint joinPoint, Object result) {
        DeploymentNode deploymentNode = (DeploymentNode)result;
        parserListener.onParsedModelElement(deploymentNode);
    }

    @AfterReturning(pointcut = "within(com.structurizr.dsl.ComponentParser) && execution(com.structurizr.model.Component parse(..))", returning = "result")
    public void interceptComponentParser(JoinPoint joinPoint, Object result) {
        Component component = (Component)result;
        parserListener.onParsedModelElement(component);
    }

    @AfterReturning(pointcut = "within(com.structurizr.dsl.ContainerParser) && execution(com.structurizr.model.Container parse(..))", returning = "result")
    public void interceptContainerParser(JoinPoint joinPoint, Object result) {
        Container container = (Container)result;
        parserListener.onParsedModelElement(container);
    }

    @AfterReturning(pointcut = "within(com.structurizr.dsl.SoftwareSystemParser) && execution(com.structurizr.model.SoftwareSystem parse(..))", returning = "result")
    public void interceptSoftwareSystemParser(JoinPoint joinPoint, Object result) {
        SoftwareSystem softwareSystem = (SoftwareSystem)result;
        parserListener.onParsedModelElement(softwareSystem);
    }

    @AfterReturning(pointcut = "within(com.structurizr.dsl.PersonParser) && execution(com.structurizr.model.Person parse(..))", returning = "result")
    public void interceptPersonParser(JoinPoint joinPoint, Object result) {
        Person person = (Person)result;
        parserListener.onParsedModelElement(person);
    }    

    @AfterReturning(pointcut = "!within(com.structurizr.dsl.DslPackage) && !within(InterceptParserAspect) && target(com.structurizr.dsl.StructurizrDslParser) && execution(* preProcessLines(java.util.List<String>))", returning = "result")
    public void interceptPreProcessLinesAfterReturning(JoinPoint joinPoint, Object result) {
        LinkedList<Line> lines = DslPackage.processPreProcessLines(result);
        parserListener.onLines(lines);
    }

    @After("target(com.structurizr.dsl.IdentifiersRegister) && execution(* validateIdentifierName(..))")
    public void interceptRegisterIdentifierAdvice(JoinPoint joinPoint) {
        String identifier = (String)joinPoint.getArgs()[0];
        parserListener.onIdentifier(identifier);
    }

    @Around("within(com.structurizr.dsl.DynamicViewContentParser) && execution(com.structurizr.view.RelationshipView parseRelationship(..))")
    public Object interceptParseRelationship(ProceedingJoinPoint joinPoint) throws Throwable {
        RelationshipView relationshipView = null;
        try {
            relationshipView = (RelationshipView) joinPoint.proceed();
            parserListener.onParsedRelationShip(relationshipView.getRelationship());
        } catch (Throwable e) {
            logger.error("Cannot intercept parsed RelationshipView for {}: {}", joinPoint.toLongString(),
                    e.getMessage());
            throw e;
        }

        return relationshipView;
    }

    @Around("within(com.structurizr.dsl.AbstractRelationshipParser) && execution(com.structurizr.model.Relationship createRelationship(..))")
    public Object interceptParsedRelationshipAdvice(ProceedingJoinPoint joinPoint) throws Throwable {
        Relationship relationship = null;
        try {
            relationship = (Relationship) joinPoint.proceed();
            parserListener.onParsedRelationShip(relationship);
        } catch (Throwable e) {
            logger.error("Cannot intercept parsed Relationship for {}: {}", joinPoint.toLongString(), e.getMessage());
            throw e;
        }
        return relationship;
    }

    @After("execution(* com.structurizr.dsl.ElementStyleParser.parseColour(..)) || " +
            "execution(* com.structurizr.dsl.ElementStyleParser.parseBackground(..)) || " +
            "execution(* com.structurizr.dsl.ElementStyleParser.parseStroke(..)) || " +
            "execution(* com.structurizr.dsl.RelationshipStyleParser.parseColour(..)) ")
    public void interceptParsedColorAdvice(JoinPoint joinPoint) {
        parserListener.onParsedColor();
    }

    // @Pointcut("target(com.structurizr.dsl.AbstractParser) && execution(* readFromUrl(..))")
    // public void interceptReadFromUrl() { }

    // @Around("interceptReadFromUrl()")
    // public Object interceptReadFromUrlAdvice(ProceedingJoinPoint joinPoint) {
    //     return null;
    // }

    @Around("within(com.structurizr.dsl.ScriptDslContext) && execution(* run(..))")
    public Object interceptScriptRunnerAdvice(ProceedingJoinPoint joinPoint) {
        logger.info("Scripting Block is ignored");
        // For test only
        parserListener.onRunScript(Collections.emptyList());
        return null;
    }

    @Around("within(com.structurizr.dsl.DecisionsParser) && execution(* parse(..))")
    public Object interceptDecisionsParserAround(ProceedingJoinPoint joinPoint) {
        return null;
    }

    @Around("within(com.structurizr.dsl.DocsParser) && execution(* parse(..))")
    public Object interceptDocsParserAround(ProceedingJoinPoint joinPoint) {
        return null;
    }

    @After("within(com.structurizr.dsl.PropertyParser) && call(* addProperty(..))")
    public void interceptParsedPropertyAfter(JoinPoint joinPoint) {
        String name = (String) joinPoint.getArgs()[0];
        String value = (String) joinPoint.getArgs()[1];
        parserListener.onParsedProperty(name, value);
    }

    @After("within(com.structurizr.dsl.IncludeParser) && execution(* parse(..))")
    public void interceptParsedIncludeAfter(JoinPoint joinPoint) {
        getFile(joinPoint.getArgs()[0]).ifPresent(referencedFile -> {
            getPath(joinPoint.getArgs()[1]).ifPresent(path -> parserListener.onInclude(referencedFile, path));
        });
    }

    private Optional<File> getFile(Object contextObj) {
        try {
            Method getFiles = contextObj.getClass().getDeclaredMethod("getFiles");
            getFiles.setAccessible(true);
            List<?> includeFiles = (List<?>) getFiles.invoke(contextObj);
            Object includedFile = includeFiles.get(0);
            Method getFile = includedFile.getClass().getDeclaredMethod("getFile");
            getFile.setAccessible(true);
            return Optional.of((File) getFile.invoke(includedFile));
        } catch (NoSuchMethodException | SecurityException | IllegalAccessException | IllegalArgumentException
                | InvocationTargetException e) {
            logger.error("Cannot determine File onInclude {}", e.getMessage());
        }
        return Optional.empty();
    }

    private Optional<String> getPath(Object tokenObject) {
        try {
            Method get = tokenObject.getClass().getDeclaredMethod("get", int.class);
            get.setAccessible(true);
            return Optional.of((String) get.invoke(tokenObject, 1));
        } catch (NoSuchMethodException | SecurityException | IllegalAccessException | IllegalArgumentException
                | InvocationTargetException e) {
            logger.error("Cannot determine Path onInclude {}", e.getMessage());
        }
        return Optional.empty();
    }

}