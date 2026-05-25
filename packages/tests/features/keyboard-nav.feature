Feature: Vim-friendly keyboard navigation for the task tree
  j/k move the selection, h/l outdent and indent (re-parent), J/K reorder
  siblings, x deletes (cascading to descendants), e enters inline edit
  mode on the focused row, and "/" focuses the search box. h/l and J/K
  all ride the same tasks.move verb the drag-and-drop UI uses; the storage
  seam is the only place that knows reparent needs a cycle check.

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

  Scenario: e on a focused row enters edit mode
    Given the app is running with a fresh database
    When I add a task titled "rename me"
    Then the tree should contain a task titled "rename me"
    When I press "e" on the task titled "rename me"
    Then the edit input on the task titled "rename me" should be visible

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

  Scenario: l on a focused row keeps the row focused after indenting
    Given the app is running with a fresh database
    When I add a task titled "parent"
    Then the tree should contain a task titled "parent"
    When I add a task titled "child"
    Then the tree should contain a task titled "child"
    When I press "l" on the task titled "child"
    Then the task titled "child" should be a child of the task titled "parent"
    And the task titled "child" should be focused

  Scenario: h on a focused row keeps the row focused after outdenting
    Given the app is running with a fresh database
    When I add a task titled "parent"
    Then the tree should contain a task titled "parent"
    When I add a task titled "child"
    Then the tree should contain a task titled "child"
    When I press "l" on the task titled "child"
    Then the task titled "child" should be a child of the task titled "parent"
    When I press "h" on the task titled "child"
    Then the task titled "child" should be a root task
    And the task titled "child" should be focused

  Scenario: Space on a focused row keeps the row focused after advancing status
    Given the app is running with a fresh database
    When I add a task titled "stays focused"
    Then the tree should contain a task titled "stays focused"
    When I press " " on the task titled "stays focused"
    Then the task titled "stays focused" should have status "doing"
    And the task titled "stays focused" should be focused

  Scenario: Slash focuses the search box from anywhere
    Given the app is running with a fresh database
    When I add a task titled "note"
    Then the tree should contain a task titled "note"
    When I focus the task titled "note"
    And I press "/" globally
    Then the search box should be focused

  Scenario: j moves selection globally when focus is outside the tree
    Given the app is running with a fresh database
    When I add a task titled "alpha"
    Then the tree should contain a task titled "alpha"
    When I add a task titled "beta"
    Then the tree should contain a task titled "beta"
    When I focus the task titled "alpha"
    And I press "/" globally
    Then the search box should be focused
    When I press Escape in the search box
    And I press "j" globally
    Then the task titled "beta" should be selected

  Scenario: k moves selection globally when focus is outside the tree
    Given the app is running with a fresh database
    When I add a task titled "alpha"
    Then the tree should contain a task titled "alpha"
    When I add a task titled "beta"
    Then the tree should contain a task titled "beta"
    When I focus the task titled "beta"
    And I press "/" globally
    Then the search box should be focused
    When I press Escape in the search box
    And I press "k" globally
    Then the task titled "alpha" should be selected

  Scenario: Escape blurs the search box so global vim keys take over
    Given the app is running with a fresh database
    When I add a task titled "lone"
    Then the tree should contain a task titled "lone"
    When I press "/" globally
    Then the search box should be focused
    When I press Escape in the search box
    Then the search box should not be focused

  Scenario: Deleting the selected row re-seeds selection to the next visible row
    Given the app is running with a fresh database
    When I add a task titled "first"
    Then the tree should contain a task titled "first"
    When I add a task titled "second"
    Then the tree should contain a task titled "second"
    When I press "x" on the task titled "second"
    Then the tree should not contain a task titled "second"
    And the task titled "first" should be selected
