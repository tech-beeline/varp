workspace {
    !identifiers hierarchical
    model {
        s = softwareSystem "S" {
            c = container "C" {
                comp = component "Comp"
            }
            c1 = container "C1"
            s.c.comp -> c1 "Up"
        }
    }
    views {
        container s {
            include *
        }
    }
}
