workspace "Archetype Props" "Precedence of archetype, own, and overlay properties" {

    model {
        archetypes {
            app = container {
                properties {
                    "team" "arch-team"
                    "env" "arch-env"
                    "ownclash" "arch-ownclash"
                    "relayed" "arch-relayed"
                }
            }
        }

        system = softwareSystem "System" {
            c = app "Container" {
                properties {
                    "team" "own-team"
                    "own" "own-value"
                    "ownclash" "own-ownclash"
                }
            }
        }

        !elements element.type==Container {
            properties {
                "team" "overlay-team"
                "overlay" "overlay-value"
                "relayed" "overlay-relayed"
            }
        }
    }

    views {
        systemcontext system "Overview" {
            include *
            autolayout
        }
    }

}
