workspace "Base" {

    model {
        ss = softwareSystem "SS" {
            c = container "C" {
                technology "Java"
            }
        }

        prod = deploymentEnvironment "Prod" {
            n1 = deploymentNode "N1" {
                ci0 = containerInstance c
            }
        }

        !include "instances-base.dsl"
    }

}
