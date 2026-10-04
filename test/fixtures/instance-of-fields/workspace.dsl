workspace "Instance Of Fields" {

    model {
        softwareSystem = softwareSystem "Software System" {
            webapp = container "Web Application" "Description" "Technology"
        }

        deploymentEnvironment "Live" {
            deploymentNode "Web Server" "Description" "Technology" {
                containerInstance webapp {
                    url "https://explicit.example"
                    properties {
                        "explicit" "true"
                    }
                }
                instanceOf webapp {
                    url "https://implied.example"
                    properties {
                        "implied" "true"
                    }
                    perspectives {
                        "Security" "An implied perspective"
                    }
                    healthCheck "Check 1" "https://example.com/health"
                    healthCheck "Check 1" "https://example.com/health" 120
                    healthCheck "Check 2" "https://example.com/health"
                }
            }
        }
    }

    views {
        deployment * "Live" "Deployment" {
            include *
            autolayout
        }
    }

}
