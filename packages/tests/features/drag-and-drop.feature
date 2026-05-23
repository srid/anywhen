Feature: Drag-and-drop tasks to change order or parent
  Tasks form a tree. The user drags a row onto another row to change its
  position in the hierarchy. Three drop zones per target: the top edge
  makes the dragged task a previous sibling, the bottom edge makes it the
  next sibling, and the middle nests it as a child.

  Drag is wired on Pointer Events (not HTML5 DnD) so the same code path
  covers mouse, pen, and touch. Mouse drag commits on a small movement
  threshold; touch drag commits on a short long-press.

  Scenario: reorder siblings by dragging one before another
    Given the app is running with a fresh database
    When I add a task titled "alpha"
    Then the tree should contain a task titled "alpha"
    When I add a task titled "beta"
    Then the tree should contain a task titled "beta"
    And the tasks should appear in order: "alpha", "beta"
    When I drag the task titled "beta" before the task titled "alpha"
    Then the tasks should appear in order: "beta", "alpha"

  Scenario: nest a task inside another by dropping in the middle
    Given the app is running with a fresh database
    When I add a task titled "parent"
    Then the tree should contain a task titled "parent"
    When I add a task titled "leaf"
    Then the tree should contain a task titled "leaf"
    When I drag the task titled "leaf" inside the task titled "parent"
    Then the task titled "leaf" should be a child of the task titled "parent"

  Scenario: promote a child back to a root by dropping after its parent
    Given the app is running with a fresh database
    When I add a task titled "parent"
    Then the tree should contain a task titled "parent"
    When I add a task titled "child"
    Then the tree should contain a task titled "child"
    When I drag the task titled "child" inside the task titled "parent"
    Then the task titled "child" should be a child of the task titled "parent"
    When I drag the task titled "child" after the task titled "parent"
    Then the task titled "child" should be a root task
