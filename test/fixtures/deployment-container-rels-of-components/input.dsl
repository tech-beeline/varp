workspace {

    model {
        a = softwareSystem "System A" {
            aContainer = container "A Container"
        }
        b = softwareSystem "System B" {
            bContainer = container "B Container" {
                bComponent = component "B Component"
            }
        }

        bContainer -> aContainer "Calls"

        deploymentEnvironment "Live" {
            deploymentNode "Node" {
                softwareSystemInstance a
                containerInstance aContainer
            }
        }
    }

}
