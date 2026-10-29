import createGraphvizLayout from 'graphviz-layout-glue';

let modulePromise: Promise<any> | undefined;

/**
 * Loads the layout build once and keeps it for the lifetime of the process. The
 * build is a single file: the wasm binary is embedded in the module, so the same
 * artifact runs in the extension host, the language server and the browser builds.
 */
function loadModule(): Promise<any> {
    if (modulePromise === undefined) {
        modulePromise = createGraphvizLayout();
    }
    return modulePromise;
}

/** Lays out a DOT graph with the dot engine and returns the -Tjson structure. */
export async function layoutDot(dot: string): Promise<any> {
    const module = await loadModule();
    const pointer = module.ccall('layout_json', 'number', ['string'], [dot]);
    if (pointer === 0) {
        throw new Error(module.ccall('layout_last_error', 'string', [], []));
    }
    try {
        return JSON.parse(module.UTF8ToString(pointer));
    } finally {
        module.ccall('layout_free', null, ['number'], [pointer]);
    }
}
