workspace {
    model {
        s = softwareSystem "S" {
            c1 = container "C1"
            c2 = container "C2"
        }
        a = softwareSystem "A"
        b = softwareSystem "B"
        p = person "P"
        s -> a "uses"
        a -> b "uses"
        p -> s "uses"
    }
    views {
        systemContext s "quoted" {
            include "element==*"
        }
        systemContext s "native" {
            include element==*
        }
        systemContext s "quoted_star" {
            include "*"
        }
        container s "container" {
            include "element==*"
        }
    }
}
