workspace "Getting Started" "This is a model of my software system." {

    model {
        !include subFolder/model.dsl
    }

    views {
        systemContext mysoftwareSystem "SystemContext" "An example of a System Context diagram." {
            include *
            autoLayout
        }

        styles {
            !include subFolder/styles.dsl
        }
    }

}
