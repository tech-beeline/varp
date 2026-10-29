workspace "Overlay Merge Semantics" {

    model {
        user = person "User"
        softwareSystem = softwareSystem "Software System" {
            webapp = container "Web Application" {
                properties {
                    "own" "own-value"
                    "override" "own-override"
                }
                perspectives {
                    "Alpha" "Own alpha"
                }
            }
        }
        user -> webapp "Uses" "HTTPS" "OwnTag"

        !elements element.type==Container {
            properties {
                "override" "overlay-override"
                "added" "overlay-value"
            }
            perspectives {
                "Beta" "Overlay beta"
            }
        }

        !relationships *->* {
            tag "OverlayTag"
            url "https://overlay.example"
            properties {
                "relprop" "rel-value"
            }
            perspectives {
                "RelPerspective" "A relationship perspective"
            }
        }
    }

    views {
        systemcontext softwareSystem {
            include *
            autolayout
        }
        styles {
            element "Container" {
                background #ffffff
                properties {
                    "styleprop" "style-value"
                }
            }
            relationship "Relationship" {
                properties {
                    "relstyle" "relstyle-value"
                }
            }
        }
    }

}
