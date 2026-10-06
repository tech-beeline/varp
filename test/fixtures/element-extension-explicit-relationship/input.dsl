workspace {
    name ""
    description ""

    model {
        properties {
            structurizr.groupSeparator "/"
        }

        LCR = softwareSystem LCR

        !element LCR {
            group Orchestration {
                temporal_db = container "temporal_db"
            }
            ha_proxy = container "haproxy"
            ha_proxy -> temporal_db "Проксирование запросов" "TLS:5432"
        }
    }
}
