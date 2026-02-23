import { Graphviz } from "@hpcc-js/wasm-graphviz";

let gvInstance: Graphviz | undefined;

export async function getGraphviz(): Promise<Graphviz> {
    gvInstance ??= await Graphviz.load();
    return gvInstance;
}