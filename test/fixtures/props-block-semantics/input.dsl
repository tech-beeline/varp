workspace "Props Semantics" "Pinned semantics of the shared properties-block collector" {

    model {
        user = person "User"
        system = softwareSystem "System" {
            c = container "Container"
        }
        user -> c "Uses" "HTTPS"

        !elements element.type==Container {
            properties {
                "dup" "first"
                "dup" "second"
                "single" "single-value"
            }
            properties {
                "dup" "third"
                "block2" "block2-value"
            }
        }

        !relationships *->* {
            properties {
                "rdup" "rfirst"
                "rdup" "rsecond"
            }
        }
    }

    views {
        systemcontext system "Overview" {
            include *
        }
        styles {
            element "Container" {
                background #ffffff
                properties {
                    "sdup" "sfirst"
                    "sdup" "ssecond"
                }
            }
        }
    }

}
