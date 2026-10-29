workspace {
    !identifiers hierarchical

    model {
        // The `!element` body below adds tags to the existing system. Overlay
        // tags must be emitted as a comma-separated string, exactly like the
        // tags produced by extractTags for regular elements: the renderer calls
        // element.tags.split(',') and the MCP model does the same. An array
        // here would throw "element.tags.split is not a function".
        a = softwareSystem "A" {
            s = container "S"
        }

        !element a {
            tags "ExtraOne,ExtraTwo"
        }
    }

    views {
        systemContext a {
            include *
        }
    }
}
