workspace {
    !identifiers hierarchical
    model {
        parent = softwareSystem "Parent"
        sibling = softwareSystem "Sibling"
        // !element Parent adds a container "Child" to the existing software
        // system "Parent". The FQN (Parent.Child) must resolve even in the
        // default flat identifier mode, so a relationship can target it.
        !element parent {
            child = container "Child storage"
        }
        parent.child -> sibling
    }
}
