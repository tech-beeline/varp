workspace "Extension" "Description" {

    model {
        softwareSystem = softwareSystem "Software System" {
            webapp = container "Web Application" {
                ui = component "UI"
            }
        }

        // !element — add a container to the existing software system
        !element softwareSystem {
            container "API" "API container" "REST"
        }

        // !element — add a component to the existing container
        !element webapp {
            component "Backend" "Backend component" "Java"
            tags "ExtraTwik,ExtraOne"
        }
    }

    views {
        container softwareSystem {
            include *
        }
    }
}
