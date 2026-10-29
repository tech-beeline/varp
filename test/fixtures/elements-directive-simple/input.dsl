workspace {

    model {
        user = person "User"
        softwareSystem = softwareSystem "Software System" {
            webapp = container "Web Application" {
                tags "Tag1,Tag2"
            }
            db = container "Database"

            webapp -> db "Reads/Writes"

            !elements element.type==Container {
                tags "FromDirective"
                url "https://example.com/containers"
                properties {
                    "directive-applied" "true"
                }
            }
        }

        user -> softwareSystem "Uses"
    }

    views {
        systemcontext softwareSystem {
            include *
            autolayout
        }

        container softwareSystem {
            include *
            autolayout
        }
    }

}
