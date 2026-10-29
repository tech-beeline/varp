workspace {
    model {
        user = person "User"

        system = softwareSystem "System" {
            properties {
                "HostName" "host-a"
                "owner" "Team A"
            }
            webApplication = container "Web Application" {
                properties {
                    "language" "TypeScript"
                }
            }
        }

        live = deploymentEnvironment "Live" {
            deploymentNode "Prod" {
                properties {
                    "HostName" "host-b"
                }
                containerInstance webApplication
            }
        }
    }
}
