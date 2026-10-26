workspace {
    model {
        s = softwareSystem "S" {
            c1 = container "C1"
            c2 = container "C2"
        }
        a = softwareSystem "A"
        b = softwareSystem "B"
        p = person "P"
        group "G" {
            g1 = softwareSystem "G1"
            g2 = softwareSystem "G2"
        }
        s -> a "uses"
        a -> b "uses"
        p -> s "uses"
        g1 -> s "uses"
    }
    views {
        systemContext s "eq" {
            include "element==a"
        }
        systemContext s "ne" {
            include "element!=a"
        }
        systemContext s "eq_scope" {
            include "element==s"
        }
        container s "c_eq" {
            include "element==C1"
        }
        container s "c_ne" {
            include "element!=C1"
        }
    }
}
