workspace {
    model {
        !identifiers hierarchical
        s = softwareSystem "S" {
            c1 = container "C1"
        }
        g = group "Group Name" {
            a = softwareSystem "A"
            b = softwareSystem "B"
        }
        x = softwareSystem "Payment Service"
        s -> a "uses"
    }
    views {
        systemContext s "by_id" {
            include "x"
        }
        systemContext s "group_by_id" {
            include "g"
        }
        systemContext s "group_eq" {
            include "element==g"
        }
        systemContext s "group_ne" {
            include "element!=g"
        }
        container s "path" {
            include "s.c1"
        }
    }
}
