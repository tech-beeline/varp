workspace {

    model {
        user = person "User"
        system = softwareSystem "System" {
            container = container "Container"
        }

        deploymentEnvironment "Production" {
            deploymentNode "Node" {
                containerInstance container {
                    healthCheck "Check 1" "https://example.com/health"
                    healthCheck "Check 2" "https://example.com/health" 60
                    healthCheck "Check 2" "https://example.com/health" 120 1000
                }
                softwareSystemInstance system {
                    healthCheck "System Check" "https://example.com/system" 30 500
                }
            }
        }
    }

    views {
        deployment system "Production" "Deployment" {
            include *
            autoLayout
        }
    }
}
