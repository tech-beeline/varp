workspace extends 1.dsl {
    !identifiers hierarchical
    model {
        !include "3.dsl"
        s.c -> s.c1
    }
    views {
        container s {
            include *
        }
    }
}
