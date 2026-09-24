workspace {

    model {
        softwareSystem = softwareSystem "Software System" {
            !decisions adrtools {
                exclude "README.md"
            }

            container "Container" {
                !decisions madr madr {
                    exclude "README.*"
                }

                component "Component" {
                    !decisions log4brains log4brains {
                        exclude "README.md"
                    }
                }
            }
        }
    }

    views {
        systemContext softwareSystem "Diagram" {
            include *
            autoLayout
        }
    }
}
