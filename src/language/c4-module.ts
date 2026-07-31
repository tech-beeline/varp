/*
	Copyright 2026 VimpelCom PJSC

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

import { DeepPartial, type Module, inject } from 'langium';
import { createDefaultModule, createDefaultSharedModule, type DefaultSharedModuleContext, type LangiumSharedServices, type LangiumServices, type PartialLangiumServices } from 'langium/lsp';
import { C4GeneratedModule, C4GeneratedSharedModule } from '../generated/module';
import { C4Validator, registerValidationChecks } from './c4-validator';
import { C4InlayHintProvider } from './c4-inlay-hints';
import { C4DocumentLinkProvider } from './c4-document-link';
import { C4CodeLensProvider } from './c4-code-lens';
import { C4ScopeProvider } from './c4-scope-provider';
import { C4NameProvider } from './c4-name-provider';
import { C4DocumentBuilder } from './c4-document-builder';
import { C4ValueConverter } from './c4-value-converter';
import { C4JsonGenerator } from './c4-json-generator';
import { C4GeneratorHandler } from './c4-json-generator-handler';
import { ViewKeyProvider } from './c4-viewkey-provider';
import { C4ParserErrorMessageProvider } from './c4-parser-error-handler';

export type C4AddedServices = {
    workspace: {
        ViewKeyProvider: ViewKeyProvider
    },    
   validation: {
       C4Validator: C4Validator
   },
    generation: {
        C4JsonGenerator: C4JsonGenerator,
        C4GeneratorHandler: C4GeneratorHandler
    }    
};

export type C4Services = LangiumServices & C4AddedServices;


/**
 * Shared services module: registers the custom C4DocumentBuilder that handles
 * auto-loading of !include files and recursive directory includes.
 */
export const C4SharedAddedModule: Module<LangiumSharedServices, DeepPartial<LangiumSharedServices>> = {
    workspace: {
        DocumentBuilder: (services) => new C4DocumentBuilder(services)
    }
};

/**
 * Language-specific services module: registers all C4 custom services including
 * parser (error messages, value converter), references (scope provider, name provider),
 * validation (C4Validator), LSP features (inlay hints, document links, code lens),
 * and generation (JSON generator and build handler).
 */
export const C4Module: Module<C4Services, PartialLangiumServices & C4AddedServices> = {
    workspace: {
         ViewKeyProvider: () => new ViewKeyProvider()
    },
    parser: {
        ParserErrorMessageProvider: () => new C4ParserErrorMessageProvider(),
        ValueConverter: () => new C4ValueConverter()
    },
    references: {
        NameProvider: () => new C4NameProvider(),
        ScopeProvider: (services: C4Services) => new C4ScopeProvider(services),
    },
   validation: {
       C4Validator: () => new C4Validator()
   },
    lsp: {
        InlayHintProvider: () => new C4InlayHintProvider(),
        DocumentLinkProvider: (services: C4Services) => new C4DocumentLinkProvider(services),
        CodeLensProvider: (services: C4Services) => new C4CodeLensProvider(services)
    },
    generation: {
        C4JsonGenerator: (services: C4Services) => new C4JsonGenerator(services),
        C4GeneratorHandler: (services: C4Services) => new C4GeneratorHandler(services)
    }
};

/**
 * Creates and initializes all C4 language services using Langium's dependency injection.
 *
 * Service initialization order:
 * 1. Shared services (DocumentBuilder, LangiumDocuments, IndexManager, WorkspaceManager)
 * 2. Language-specific services (parser, validation, LSP, generation)
 * 3. Register language in the shared service registry
 * 4. Register validation checks
 *
 * The inject() function merges module definitions left-to-right, with later modules
 * overriding earlier ones for the same service keys.
 *
 * @param context The shared module context (connection, file system provider)
 * @returns Object containing shared services and C4 language services
 */
export function createC4Services(context: DefaultSharedModuleContext): {
    shared: LangiumSharedServices,
    C4: C4Services
} {
    const shared = inject(
        createDefaultSharedModule(context),
        C4GeneratedSharedModule,
        C4SharedAddedModule
    );
    const C4 = inject(
        createDefaultModule({ shared }),
        C4GeneratedModule,
        C4Module
    );
    shared.ServiceRegistry.register(C4);
    registerValidationChecks(C4);
    return { shared, C4 };
}
