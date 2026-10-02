workspace {
    !identifiers hierarchical
    model {
        s = softwareSystem "S" {
            c0 = container "C0" {
                tags tagA, 'Tag1'
            }
            c1 = container "C1" {
                tags 'tagA, Tag1'
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
