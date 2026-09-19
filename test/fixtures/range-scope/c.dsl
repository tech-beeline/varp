/**
 * Workspace C - the parent of B (via extends). It includes fragment D where
 * the "Target System" is declared, so everything here (and in its included
 * fragments) must be visible to the child workspace B and to fragment A
 * included by B.
 */
workspace {
    model {
        !include d.dsl
        C = softwareSystem "Workspace C System"
    }
}
