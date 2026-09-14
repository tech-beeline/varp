workspace "Extension" "Description" {

    model {
        softwareSystem = softwareSystem "Software System" {
            webapp = container "Web Application" {
                ui = component "UI"
            }
        }
    }

    views {
        container softwareSystem {
            include *
        }
    }

    // Top-level !element — add a container to the existing software system
    !element "Software System" {
        container "API" "API container" "REST"
    }

    // Top-level !element — add a component to the existing container
    !element "Web Application" {
        component "Backend" "Backend component" "Java"
        tags "ExtraTwik,ExtraOne"
    }
}
