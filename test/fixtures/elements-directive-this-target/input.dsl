workspace {
    model {
        user = person "User"
        app = softwareSystem "App" {
            c1 = container "C1"
            c2 = container "C2"
        }

        !elements element.type==Container {
            user -> this "Uses"
        }
    }
}
