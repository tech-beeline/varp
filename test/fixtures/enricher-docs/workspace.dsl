workspace {

    model {
        softwareSystem = softwareSystem "Software System" {
            !docs docs/element {
                exclude "README.md"
            }
            container "Container" {
                !docs docs/element/10-details.md
            }
        }
        user = person "User"
        user -> softwareSystem "Uses"
    }

    views {
        systemContext softwareSystem "Diagram1" {
            include *
            autoLayout
        }
    }
}

!docs docs {
    exclude "README.md"
    exclude "02-design"
}
