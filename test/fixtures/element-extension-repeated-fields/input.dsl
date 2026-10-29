workspace {
    model {
        app = softwareSystem "App" {
            b = container "B"
            !element b {
                description "First"
                description "Second"
                url "https://first"
                url "https://second"
            }
        }
    }
}
