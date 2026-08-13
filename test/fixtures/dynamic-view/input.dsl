workspace {

    model {
        user = person "User"
        system = softwareSystem "Software System" {
            web = container "Web Application"
            db = container "Database"
            web -> db "Reads/Writes"
        }
        other = softwareSystem "Other System"
        user -> system "Uses"
        system -> other "Calls"
    }

    views {
        dynamic "seq" {
            1: user -> system "Uses"
            2: system -> other "Calls"
            autolayout
        }
    }

}
