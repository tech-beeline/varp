workspace "Element Extension Perspectives" {

    model {
        system = softwareSystem "System"

        !element system {
            tags "Extended"
            perspectives {
                perspective "Zulu" {
                    description "Added by the extension"
                    value "Overlay"
                    url "https://example.com/zulu"
                }
                perspective "Beta" {
                    description "Also added by the extension"
                    value "Second"
                }
            }
        }
    }

    views {
        systemcontext system {
            include *
            autolayout
        }
    }

}
