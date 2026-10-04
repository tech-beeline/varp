workspace {
    model {
        app = softwareSystem "App" {
            c1 = container "C1"
            c2 = container "C2"
        }
        db = softwareSystem "DB"

        !elements element.type==Container {
            -> db "Uses"
        }
    }
}
