workspace {

    model {
        user = person "User"
        softwareSystem = softwareSystem "Software System" {
            webapp = container "Web Application" {
                tags "Tag1,Tag2"
            }
            db = container "Database"

            webapp -> db "Reads/Writes"
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