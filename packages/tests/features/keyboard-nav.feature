Feature: Keyboard navigation for the task tree
  Arrow keys move the selection, Tab/Shift+Tab indent and outdent (re-parent),
  Alt+ArrowUp/Down reorder siblings, Backspace deletes (cascading to
  descendants), and "/" focuses the search box. Tab/Shift+Tab and Alt+arrow
  all ride the same tasks.move verb the drag-and-drop UI uses; the storage
  seam is the only place that knows reparent needs a cycle check.

  Scenario: Tab on a row indents it under the previous sibling
    Given the app is running with a fresh database
    When I type "+ groceries" in the search box
    And I press Enter in the search box
    Then the tree should contain a task titled "groceries"
    When I type "+ deferred reading" in the search box
    And I press Enter in the search box
    Then the tree should contain a task titled "deferred reading"
    When I press "Tab" on the task titled "deferred reading"
    Then the task titled "deferred reading" should be a child of the task titled "groceries"

  Scenario: Shift+Tab outdents a child back to a root
    Given the app is running with a fresh database
    When I type "+ parent" in the search box
    And I press Enter in the search box
    Then the tree should contain a task titled "parent"
    When I type "+ child" in the search box
    And I press Enter in the search box
    Then the tree should contain a task titled "child"
    When I press "Tab" on the task titled "child"
    Then the task titled "child" should be a child of the task titled "parent"
    When I press "Shift+Tab" on the task titled "child"
    Then the task titled "child" should be a root task

  Scenario: Alt+ArrowUp reorders the selected task above its previous sibling
    Given the app is running with a fresh database
    When I type "+ first" in the search box
    And I press Enter in the search box
    Then the tree should contain a task titled "first"
    When I type "+ second" in the search box
    And I press Enter in the search box
    Then the tree should contain a task titled "second"
    And the tasks should appear in order: "first", "second"
    When I press "Alt+ArrowUp" on the task titled "second"
    Then the tasks should appear in order: "second", "first"

  Scenario: Alt+ArrowDown reorders the selected task below its next sibling
    Given the app is running with a fresh database
    When I type "+ first" in the search box
    And I press Enter in the search box
    Then the tree should contain a task titled "first"
    When I type "+ second" in the search box
    And I press Enter in the search box
    Then the tree should contain a task titled "second"
    And the tasks should appear in order: "first", "second"
    When I press "Alt+ArrowDown" on the task titled "first"
    Then the tasks should appear in order: "second", "first"

  Scenario: Backspace on a focused row deletes it
    Given the app is running with a fresh database
    When I type "+ throwaway" in the search box
    And I press Enter in the search box
    Then the tree should contain a task titled "throwaway"
    When I press "Backspace" on the task titled "throwaway"
    Then the tree should not contain a task titled "throwaway"

  Scenario: ArrowDown moves selection to the next visible row
    Given the app is running with a fresh database
    When I type "+ alpha" in the search box
    And I press Enter in the search box
    Then the tree should contain a task titled "alpha"
    When I type "+ beta" in the search box
    And I press Enter in the search box
    Then the tree should contain a task titled "beta"
    When I press "ArrowDown" on the task titled "alpha"
    Then the task titled "beta" should be selected

  Scenario: Slash focuses the search box from anywhere
    Given the app is running with a fresh database
    When I type "+ note" in the search box
    And I press Enter in the search box
    Then the tree should contain a task titled "note"
    When I focus the task titled "note"
    And I press "/" globally
    Then the search box should be focused
