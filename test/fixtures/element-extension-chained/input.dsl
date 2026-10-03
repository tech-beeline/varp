workspace extends base.dsl {

    model {
        !element "SoftwareSystem://X" {
            z = container "Z" "Container Z" {
                c = component "C" "Component C"
            }
        }

        !element "Container://X.Z" {
            c2 = component "C2" "Component C2"
        }
    }

    views {
        component z "C" {
            include *
            autolayout lr
        }
    }

}
