workspace {
    model {
        app = softwareSystem "App" {
            b = container "B"
            !element b {
                properties {
                    a 1
                    shared fromFirst
                }
                properties {
                    b 2
                    shared fromSecond
                }
            }
        }
    }
}
