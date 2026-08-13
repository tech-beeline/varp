import { readFileSync } from 'fs';
import { resolve } from 'path';
import { EmptyFileSystem } from 'langium';
import { URI } from 'vscode-uri';
import { createC4Services } from '../../language/c4-module';
import { C4JsonGenerator } from '../../language/c4-json-generator';
import { isWorkspace } from '../../generated/ast';

/**
 * Loads a test fixture DSL (`test/fixtures/<name>/input.dsl`) through the real
 * language pipeline and returns the generated Structurizr workspace JSON.
 */
export async function loadWorkspaceJson(fixtureDir: string): Promise<any> {
    const filePath = resolve(__dirname, '../../../test/fixtures', fixtureDir, 'input.dsl');
    const content = readFileSync(filePath, 'utf-8');
    const uri = URI.file(resolve(filePath));
    const services = createC4Services({ connection: undefined as any, ...EmptyFileSystem }).C4;
    const doc = services.shared.workspace.LangiumDocumentFactory.fromString(content, uri);
    await services.shared.workspace.DocumentBuilder.build([doc]);
    const root = doc.parseResult.value;
    const workspace = isWorkspace(root) ? root : (root as any).workspaces?.[0];
    if (!workspace) {
        throw new Error(`No workspace found in fixture ${fixtureDir}`);
    }
    return new C4JsonGenerator(services).generate(workspace);
}
