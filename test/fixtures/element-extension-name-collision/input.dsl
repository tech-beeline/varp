workspace {
    !identifiers hierarchical

    model {
        // `a` is declared as a software system, and the `!element a` directive
        // below reuses the same identifier. The view at the bottom references
        // `a` with the declared type [SoftwareSystem], so it must resolve to
        // THIS system and never to the ElementExtension directive.
        a = softwareSystem "A" {
            s = container "S"
        }

        b = softwareSystem "B"

        // Extends the system above. The directive is registered under the same
        // identifier `a`, but it is not a SoftwareSystem, so a
        // [SoftwareSystem:Identifier] reference must not resolve to it.
        !element a {
            c = container "C"
        }

        b -> a.s
    }

    views {
        systemContext a {
            include *
        }
    }
}
