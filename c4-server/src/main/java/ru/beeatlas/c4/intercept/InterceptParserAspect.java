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
import java.util.Collections;
import java.util.List;
import org.aspectj.lang.ProceedingJoinPoint;
import org.aspectj.lang.annotation.After;
import org.aspectj.lang.annotation.AfterReturning;
import org.aspectj.lang.annotation.Around;
import org.aspectj.lang.annotation.Aspect;
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
import com.structurizr.view.SystemLandscapeView;

import ru.beeatlas.c4.custom.Custom;

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

    @After("within(com.structurizr.dsl.StructurizrDslParser) && execution(* startContext(com.structurizr.dsl.DslContext)) && args(dslContext)")
    public void interceptStartContextAfter(Object dslContext) {
        parserListener.onStartContext(dslContext.hashCode(), dslContext.getClass().getSimpleName());
    }

    @After("within(com.structurizr.dsl.StructurizrDslParser) && execution(* parse(com.structurizr.dsl.DslParserContext, java.io.File)) && args(*, file) ")
    public void interceptParseAfter(File file) {
        parserListener.onExtendsBy(file);
    }

    @AfterReturning(pointcut = "withincode(* com.structurizr.dsl.StructurizrDslParser.endContext(..)) && call(* java.util.Stack.pop(..))", returning = "result")
    public void interceptEndContextBefore(Object result) {
        parserListener.onEndContext(result.hashCode(), result.getClass().getSimpleName());
    }

    @Around("within(com.structurizr.dsl.StructurizrDslParser) && execution(* parse(java.util.List<String>, java.io.File, boolean, boolean)) && args(lines, dslFile, fragment, includeInDslSourceLines)")
    public void interceptParseAround(ProceedingJoinPoint joinPoint, List<String> lines, File dslFile, boolean fragment,
            boolean includeInDslSourceLines) throws StructurizrDslParserException {
        parserListener.onStartFile(dslFile);
        try {
            joinPoint.proceed();
        } catch (Throwable e) {
            parserListener.onException((StructurizrDslParserException) e);
        }
        parserListener.onEndFile();
    }

    @After("within(com.structurizr.dsl.DslLine) && execution(* getSource())")
    public void interceptGetSourceAfter() {
        parserListener.onNewLine();
    }

    @AfterReturning(pointcut = "within(com.structurizr.dsl.DynamicViewParser) && execution(com.structurizr.view.DynamicView parse(..))", returning = "view")
    public void interceptParseDynamicViewAfterReturning(DynamicView view) {
        parserListener.onParsedView(view);
    }

    @AfterReturning(pointcut = "within(com.structurizr.dsl.DeploymentViewParser) && execution(com.structurizr.view.DeploymentView parse(..))", returning = "view")
    public void interceptParseDeploymentViewAfterReturning(DeploymentView view) {
        parserListener.onParsedView(view);
    }
    
    @AfterReturning(pointcut = "within(com.structurizr.dsl.ContainerViewParser) && execution(com.structurizr.view.ContainerView parse(..))", returning = "view")
    public void interceptParseContainerViewAfterReturning(ContainerView view) {
        parserListener.onParsedView(view);
    }

    @AfterReturning(pointcut = "within(com.structurizr.dsl.ComponentViewParser) && execution(com.structurizr.view.ComponentView parse(..))", returning = "view")
    public void interceptParseComponentViewAfterReturning(ComponentView view) {
        parserListener.onParsedView(view);
    }

    @AfterReturning(pointcut = "within(com.structurizr.dsl.SystemContextViewParser) && execution(com.structurizr.view.SystemContextView parse(..))", returning = "view")
    public void interceptParseSystemContextViewAfterReturning(SystemContextView view) {
        parserListener.onParsedView(view);
    }

    @AfterReturning(pointcut = "within(com.structurizr.dsl.FilteredViewParser) && execution(com.structurizr.view.FilteredView parse(..))", returning = "view")
    public void interceptFilteredViewViewAfterReturning(FilteredView view) {
        parserListener.onParsedView(view);
    }

    @AfterReturning(pointcut = "within(com.structurizr.dsl.SystemLandscapeViewParser) && execution(com.structurizr.view.SystemLandscapeView parse(..))", returning = "view")
    public void interceptSystemLandscapeViewAfterReturning(SystemLandscapeView view) {
        parserListener.onParsedView(view);
    }

    @AfterReturning(pointcut = "within(com.structurizr.dsl.ContainerInstanceParser) && execution(com.structurizr.model.ContainerInstance parse(..))", returning = "containerInstance")
    public void interceptContainerInstanceAfterReturning(ContainerInstance containerInstance) {
        parserListener.onParsedModelElement(containerInstance);
    }

    @AfterReturning(pointcut = "within(com.structurizr.dsl.SoftwareSystemInstanceParser) && execution(com.structurizr.model.SoftwareSystemInstance parse(..))", returning = "softwareSystemInstance")
    public void interceptSoftwareSystemInstanceAfterReturning(SoftwareSystemInstance softwareSystemInstance) {
        parserListener.onParsedModelElement(softwareSystemInstance);
    }

    @AfterReturning(pointcut = "within(com.structurizr.dsl.InfrastructureNodeParser) && execution(com.structurizr.model.InfrastructureNode parse(..))", returning = "infrastructureNode")
    public void interceptInfrastructureNodeParser(InfrastructureNode infrastructureNode) {
        parserListener.onParsedModelElement(infrastructureNode);
    }

    @AfterReturning(pointcut = "within(com.structurizr.dsl.DeploymentNodeParser) && execution(com.structurizr.model.DeploymentNode parse(com.structurizr.dsl.DeploymentEnvironmentDslContext, com.structurizr.dsl.DeploymentNodeDslContext, ..))", returning = "deploymentNode")
    public void interceptDeploymentNodeParser(DeploymentNode deploymentNode) {
        parserListener.onParsedModelElement(deploymentNode);
    }

    @AfterReturning(pointcut = "within(com.structurizr.dsl.ComponentParser) && execution(com.structurizr.model.Component parse(..))", returning = "component")
    public void interceptComponentParser(Component component) {
        parserListener.onParsedModelElement(component);
    }

    @AfterReturning(pointcut = "within(com.structurizr.dsl.ContainerParser) && execution(com.structurizr.model.Container parse(..))", returning = "container")
    public void interceptContainerParser(Container container) {
        parserListener.onParsedModelElement(container);
    }

    @AfterReturning(pointcut = "within(com.structurizr.dsl.SoftwareSystemParser) && execution(com.structurizr.model.SoftwareSystem parse(..))", returning = "softwareSystem")
    public void interceptSoftwareSystemParser(SoftwareSystem softwareSystem) {
        parserListener.onParsedModelElement(softwareSystem);
    }

    @AfterReturning(pointcut = "within(com.structurizr.dsl.PersonParser) && execution(com.structurizr.model.Person parse(..))", returning = "person")
    public void interceptPersonParser(Person person) {
        parserListener.onParsedModelElement(person);
    }    

    @AfterReturning(pointcut = "!within(com.structurizr.dsl.DslPackage) && !within(InterceptParserAspect) && target(com.structurizr.dsl.StructurizrDslParser) && execution(* preProcessLines(java.util.List<String>))", returning = "result")
    public void interceptPreProcessLinesAfterReturning(Object result) {
        List<Line> lines = DslPackage.processPreProcessLines(result);
        parserListener.onLines(lines);
    }

    @After("target(com.structurizr.dsl.IdentifiersRegister) && execution(* validateIdentifierName(..)) && args(identifier)")
    public void interceptRegisterIdentifierAdvice(String identifier) {
        parserListener.onIdentifier(identifier);
    }

    @AfterReturning(pointcut = "within(com.structurizr.dsl.DynamicViewContentParser) && execution(com.structurizr.view.RelationshipView parseRelationship(..))", returning = "relationshipView")
    public void interceptParseRelationshipAfter(RelationshipView relationshipView) {
        parserListener.onParsedRelationShip(relationshipView.getRelationship());
    }

    @AfterReturning(pointcut = "within(com.structurizr.dsl.AbstractRelationshipParser) && execution(com.structurizr.model.Relationship createRelationship(..))", returning = "relationship")
    public void interceptCreateRelationshipAfter(Relationship relationship) {
        parserListener.onParsedRelationShip(relationship);
    }

    @After("execution(* com.structurizr.dsl.ElementStyleParser.parseColour(..)) || " +
            "execution(* com.structurizr.dsl.ElementStyleParser.parseBackground(..)) || " +
            "execution(* com.structurizr.dsl.ElementStyleParser.parseStroke(..)) || " +
            "execution(* com.structurizr.dsl.RelationshipStyleParser.parseColour(..)) ")
    public void interceptParsedColorAdvice() {
        parserListener.onParsedColor();
    }

    // @Pointcut("target(com.structurizr.dsl.AbstractParser) && execution(* readFromUrl(..))")
    // public void interceptReadFromUrl() { }

    // @Around("interceptReadFromUrl()")
    // public Object interceptReadFromUrlAdvice(ProceedingJoinPoint joinPoint) {
    //     return null;
    // }

    @Around("within(com.structurizr.dsl.ScriptDslContext) && execution(* run(..))")
    public Object interceptScriptRunnerAdvice() {
        logger.info("Scripting Block is ignored");
        // For test only
        parserListener.onRunScript(Collections.emptyList());
        return null;
    }

    @Around("within(com.structurizr.dsl.DecisionsParser) && execution(* parse(..))")
    public Object interceptDecisionsParserAround() {
        return null;
    }

    @Around("within(com.structurizr.dsl.DocsParser) && execution(* parse(..))")
    public Object interceptDocsParserAround() {
        return null;
    }

    @After("within(com.structurizr.dsl.PropertyParser) && call(* addProperty(..)) && args(name, value)")
    public void interceptParsedPropertyAfter(String name, String value) {
        parserListener.onParsedProperty(name, value);
    }

    @After("within(com.structurizr.dsl.IncludedDslContext) && execution(* addFile(..)) && args(file, *)")
    public void interceptAddFileAfter(File file) {
        parserListener.onInclude(file);
    }

    @Around("execution(* com.structurizr.view.ThemeUtils.loadFrom(..))")
    public Object interceptloadFromAround(ProceedingJoinPoint joinPoint) {
        Object[] args = joinPoint.getArgs();        
        try {
            return joinPoint.proceed(args);
        } catch (Throwable e) {
            String themeLocation = (String)args[0];
            int timeoutInMilliseconds = (int)args[1];
            return Custom.getInstance().loadFrom(themeLocation, timeoutInMilliseconds);
        }
    }

    @AfterReturning(pointcut = "withincode(* parse(java.util.List<String>, java.io.File, boolean, boolean)) && call(* java.lang.String.substring(int, int))", returning = "leadingSpace")
    public void interceptSubstringAfter(String leadingSpace) {
        parserListener.onLeadingSpace(leadingSpace.length());
    }    
}