workspace "Audit B" {

    model {
        x = softwaresystem "X" {
            a = container "A"
        }

        prod = deploymentEnvironment "Prod" {
            n1 = deploymentNode "N1" {
                ia = containerInstance a
            }
            n2 = deploymentNode "N2"
        }

        !element "DeploymentNode://Prod/N2" {
            ib = containerInstance a
        }
    }

    views {
        deployment x "Prod" {
            include ib
        }
    }

}
