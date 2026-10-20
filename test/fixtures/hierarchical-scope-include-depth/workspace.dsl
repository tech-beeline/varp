workspace {
    !identifiers hierarchical
    model {
        s = softwareSystem "S" {
            !include "a.dsl"
        }
    }
    views {
        container s {
            include *
        }
    }
}
