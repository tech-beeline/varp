workspace {
    !identifiers hierarchical
    model {
        s = softwareSystem "S" {
            c0 = container "C0" {
                tags 'tag1'
            }
            c1 = container "C1" {
                tags 'tag A'
            }
        }
    }
    views {
        container s {
            include element.tag==tag1
            include "element.tag==tag A"
            autoLayout
        }
    }
}
