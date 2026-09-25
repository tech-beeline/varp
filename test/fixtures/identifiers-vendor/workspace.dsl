workspace {

    !identifiers hierarchical

    model {
        b = softwareSystem "B" {
            c = container "C" {
                d = component "D"
            }
        }
    }

    views {
        container b "V" {
            include *
            autoLayout
        }
    }
}
