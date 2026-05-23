Feature: Drag-and-drop tasks to change order or parent
  Tasks form a tree. The user drags a row onto another row to change its
  position in the hierarchy. Three drop zones per target: the top edge
  makes the dragged task a previous sibling, the bottom edge makes it the
  next sibling, and the middle nests it as a child.

  Scenario: reorder siblings by dragging one before another
    Given the app is running with a fresh database
    When I type "+ alpha" in the search box
    And I press Enter in the search box
    And I type "+ beta" in the search box
    And I press Enter in the search box
    Then the tasks should appear in order: "alpha", "beta"
    When I drag the task titled "beta" before the task titled "alpha"
    Then the tasks should appear in order: "beta", "alpha"

  Scenario: nest a task inside another by dropping in the middle
    Given the app is running with a fresh database
    When I type "+ parent" in the search box
    And I press Enter in the search box
    And I type "+ leaf" in the search box
    And I press Enter in the search box
    Then the tree should contain a task titled "parent"
    And the tree should contain a task titled "leaf"
    When I drag the task titled "leaf" inside the task titled "parent"
    Then the task titled "leaf" should be a child of the task titled "parent"

  Scenario: promote a child back to a root by dropping after its parent
    Given the app is running with a fresh database
    When I type "+ parent" in the search box
    And I press Enter in the search box
    And I type "+ child" in the search box
    And I press Enter in the search box
    Then the tree should contain a task titled "parent"
    And the tree should contain a task titled "child"
    When I drag the task titled "child" inside the task titled "parent"
    Then the task titled "child" should be a child of the task titled "parent"
    When I drag the task titled "child" after the task titled "parent"
    Then the task titled "child" should be a root task
