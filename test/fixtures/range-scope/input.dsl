/**
 * Workspace B (entry document). It inherits from workspace C via `extends`
 * and includes fragment A. Because C itself includes fragment D (which declares
 * "Target System"), that system must be resolvable from within A even though A
 * is several include/extends hops away.
 */
workspace extends c.dsl {
    model {
        !include a.dsl        
        B = softwareSystem "Workspace B System"
    }
}
