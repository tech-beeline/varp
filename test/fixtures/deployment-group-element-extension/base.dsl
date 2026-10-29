workspace "Base" "Base workspace" {

    model {
        x = softwaresystem "X" "System X" {
            a = container "A" "Container A"
            b = container "B" "Container B"

            a -> b "calls"
        }

        prod = deploymentEnvironment "Prod" {
            g1 = deploymentGroup "Group"

            n1 = deploymentNode "Node 1" {
                deploymentGroup g1
                ia = containerInstance a
            }

            n2 = deploymentNode "Node 2" {
                deploymentGroup g1
                ib = containerInstance b
            }
        }
    }

    views {
        deployment x "Prod" {
            include *
            autolayout lr
        }
    }

}
