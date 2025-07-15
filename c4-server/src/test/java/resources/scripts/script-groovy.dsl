workspace {
  name "Example"
  description "Example with script problems"

  model {
    p = person "A person"
    s1 = softwareSystem "A software system"
    p -> s1 "uses"
  }

  views {

    !script groovy {
      workspace.views.createDefaultViews()
      workspace.views.views.each { it.disableAutomaticLayout() }
    }

    theme default
  }
}

