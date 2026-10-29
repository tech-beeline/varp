workspace "Docs Fixture" "Documentation with an image, exported by the reference CLI" {

    !docs docs

    model {
        user = person "User"
        system = softwareSystem "Software System"
        user -> system "Uses"
    }

    views {
        systemContext system "Diagram" {
            include *
            autoLayout
        }
    }
}
