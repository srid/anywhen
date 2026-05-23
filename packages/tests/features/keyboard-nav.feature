Feature: Keyboard navigation for the task tree
  Arrow keys move the selection, Tab/Shift+Tab indent and outdent (re-parent),
  Alt+ArrowUp/Down reorder siblings, Backspace deletes (cascading to
  descendants), and "/" focuses the search box. Tab/Shift+Tab and Alt+arrow
  all ride the same tasks.move verb the drag-and-drop UI uses; the storage
  seam is the only place that knows reparent needs a cycle check.

  Scenario: Tab on a row indents it under the previous sibling
    Given the app is running with a fresh database
    When I add a task titled "groceries"
    Then the tree should contain a task titled "groceries"
    When I add a task titled "deferred reading"
    Then the tree should contain a task titled "deferred reading"
    When I press "Tab" on the task titled "deferred reading"
    Then the task titled "deferred reading" should be a child of the task titled "groceries"

  Scenario: Shift+Tab outdents a child back to a root
    Given the app is running with a fresh database
    When I add a task titled "parent"
    Then the tree should contain a task titled "parent"
    When I add a task titled "child"
    Then the tree should contain a task titled "child"
    When I press "Tab" on the task titled "child"
    Then the task titled "child" should be a child of the task titled "parent"
    When I press "Shift+Tab" on the task titled "child"
    Then the task titled "child" should be a root task

  Scenario: Alt+ArrowUp reorders the selected task above its previous sibling
    Given the app is running with a fresh database
    When I add a task titled "first"
    Then the tree should contain a task titled "first"
    When I add a task titled "second"
    Then the tree should contain a task titled "second"
    And the tasks should appear in order: "first", "second"
    When I press "Alt+ArrowUp" on the task titled "second"
    Then the tasks should appear in order: "second", "first"

  Scenario: Alt+ArrowDown reorders the selected task below its next sibling
    Given the app is running with a fresh database
    When I add a task titled "first"
    Then the tree should contain a task titled "first"
    When I add a task titled "second"
    Then the tree should contain a task titled "second"
    And the tasks should appear in order: "first", "second"
    When I press "Alt+ArrowDown" on the task titled "first"
    Then the tasks should appear in order: "second", "first"

  Scenario: Backspace on a focused row deletes it
    Given the app is running with a fresh database
    When I add a task titled "throwaway"
    Then the tree should contain a task titled "throwaway"
    When I press "Backspace" on the task titled "throwaway"
    Then the tree should not contain a task titled "throwaway"

  Scenario: ArrowDown moves selection to the next visible row
    Given the app is running with a fresh database
    When I add a task titled "alpha"
    Then the tree should contain a task titled "alpha"
    When I add a task titled "beta"
    Then the tree should contain a task titled "beta"
    When I press "ArrowDown" on the task titled "alpha"
    Then the task titled "beta" should be selected

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
