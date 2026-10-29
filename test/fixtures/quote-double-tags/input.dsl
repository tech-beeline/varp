workspace {
    !identifiers hierarchical
    model {
        s = softwareSystem "S" {
            c0 = container "C0" {
                tags "Tag1,Tag2"
            }
            c1 = container "C1" {
                tags "Tag3"
            }
        }
    }
    views {
        container s {
            include "element.tag==Tag1"
            autoLayout
        }
    }
}
