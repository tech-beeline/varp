workspace "Audit A" {

    model {
        p = person "P"

        x = softwaresystem "X" {
            a = container "A"
            b = container "B"
            a -> b "calls"
        }

        prod = deploymentEnvironment "Prod" {
            n1 = deploymentNode "N1" {
                ia = containerInstance a
                i1 = infrastructureNode "I1"
            }
        }

        !element p {
            description "Person desc"
            tags "PTag"
        }

        !element "SoftwareSystem://X" {
            g = group "G" {
                c = container "C"
            }
        }

        !element "DeploymentNode://Prod/N1" {
            gi = instanceof a
            ii = containerInstance b
        }

        !element ia {
            tags "InstTag"
            -> i1 "links"
        }

        !element "InfrastructureNode://Prod/N1/I1" {
            tags "InfraTag"
        }
    }

}
