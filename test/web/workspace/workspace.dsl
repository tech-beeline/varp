workspace "Test Workspace" "Smoke test fixture." {
    model {
        user = person "User"
        system = softwareSystem "Software System" {
            web = container "Web Application"
            database = container "Database"
            web -> database "Reads from and writes to"
        }
        user -> system "Uses"
    }
    views {
        systemContext system "SystemContext" {
            include *
            autolayout lr
        }
        container system "Containers" {
            include *
            autolayout lr
        }
    }
}
