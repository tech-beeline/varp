workspace {

    model {
        softwareSystem = softwareSystem "Software System" {
            !docs docs/element {
                exclude "README.md"
            }
            container "Container" {
                !docs docs/element/10-details.md
            }
            container "Recursive Container" {
                !docs docs/tree com.structurizr.importer.documentation.RecursiveDefaultDocumentationImporter
            }
            container "Custom Importer Container" {
                !docs docs/tree com.example.CustomDocumentationImporter
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
