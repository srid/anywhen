Feature: Vim-friendly keyboard navigation for the task tree
  j/k move the selection, h/l outdent and indent (re-parent), J/K reorder
  siblings, x deletes (cascading to descendants), and "/" focuses the search
  box. h/l and J/K all ride the same tasks.move verb the drag-and-drop UI
  uses; the storage seam is the only place that knows reparent needs a cycle
  check.

  Scenario: l on a row indents it under the previous sibling
    Given the app is running with a fresh database
    When I add a task titled "groceries"
    Then the tree should contain a task titled "groceries"
    When I add a task titled "deferred reading"
    Then the tree should contain a task titled "deferred reading"
    When I press "l" on the task titled "deferred reading"
    Then the task titled "deferred reading" should be a child of the task titled "groceries"

  Scenario: h outdents a child back to a root
    Given the app is running with a fresh database
    When I add a task titled "parent"
    Then the tree should contain a task titled "parent"
    When I add a task titled "child"
    Then the tree should contain a task titled "child"
    When I press "l" on the task titled "child"
    Then the task titled "child" should be a child of the task titled "parent"
    When I press "h" on the task titled "child"
    Then the task titled "child" should be a root task

  Scenario: K reorders the selected task above its previous sibling
    Given the app is running with a fresh database
    When I add a task titled "first"
    Then the tree should contain a task titled "first"
    When I add a task titled "second"
    Then the tree should contain a task titled "second"
    And the tasks should appear in order: "first", "second"
    When I press "Shift+K" on the task titled "second"
    Then the tasks should appear in order: "second", "first"

  Scenario: J reorders the selected task below its next sibling
    Given the app is running with a fresh database
    When I add a task titled "first"
    Then the tree should contain a task titled "first"
    When I add a task titled "second"
    Then the tree should contain a task titled "second"
    And the tasks should appear in order: "first", "second"
    When I press "Shift+J" on the task titled "first"
    Then the tasks should appear in order: "second", "first"

  Scenario: x on a focused row deletes it
    Given the app is running with a fresh database
    When I add a task titled "throwaway"
    Then the tree should contain a task titled "throwaway"
    When I press "x" on the task titled "throwaway"
    Then the tree should not contain a task titled "throwaway"

  Scenario: j moves selection to the next visible row
    Given the app is running with a fresh database
    When I add a task titled "alpha"
    Then the tree should contain a task titled "alpha"
    When I add a task titled "beta"
    Then the tree should contain a task titled "beta"
    When I press "j" on the task titled "alpha"
    Then the task titled "beta" should be selected

  Scenario: k moves selection to the previous visible row
    Given the app is running with a fresh database
    When I add a task titled "alpha"
    Then the tree should contain a task titled "alpha"
    When I add a task titled "beta"
    Then the tree should contain a task titled "beta"
    When I press "k" on the task titled "beta"
    Then the task titled "alpha" should be selected

  Scenario: Space on a focused row keeps the row focused after toggling done
    Given the app is running with a fresh database
    When I add a task titled "stays focused"
    Then the tree should contain a task titled "stays focused"
    When I press " " on the task titled "stays focused"
    Then the task titled "stays focused" should have status "done"
    And the task titled "stays focused" should be focused

  Scenario: Slash focuses the search box from anywhere
    Given the app is running with a fresh database
    When I add a task titled "note"
    Then the tree should contain a task titled "note"
    When I focus the task titled "note"
    And I press "/" globally
    Then the search box should be focused
