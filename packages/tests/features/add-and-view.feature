Feature: Add a task and see it in the tree
  The user opens the app, types a title in the search box, and commits with
  Enter (or the visible Add button). The task appears as a new root in the
  tree. Cycling status with the row checkbox advances the task through
  todo → doing → done. Clicking the per-row × asks for confirmation before
  removing the task (and cascading to any descendants via the SQL FK);
  dismissing the prompt leaves the tree untouched.

  Scenario: add a root task by pressing Enter and advance it to doing
    Given the app is running with a fresh database
    When I add a task titled "buy milk"
    Then the tree should contain a task titled "buy milk"
    And the task titled "buy milk" should have status "todo"
    When I click the checkbox on the task titled "buy milk"
    Then the task titled "buy milk" should have status "doing"

  Scenario: add a task by clicking the Add button
    Given the app is running with a fresh database
    When I type "ride bike" in the search box
    And I click the add button
    Then the tree should contain a task titled "ride bike"

  Scenario: delete a task removes it from the tree
    Given the app is running with a fresh database
    When I add a task titled "throwaway"
    Then the tree should contain a task titled "throwaway"
    When I click the delete button on the task titled "throwaway"
    Then the tree should not contain a task titled "throwaway"

  Scenario: dismissing the confirm dialog keeps the task
    Given the app is running with a fresh database
    When I add a task titled "keepme"
    Then the tree should contain a task titled "keepme"
    When I dismiss the next confirmation dialog
    And I click the delete button on the task titled "keepme"
    Then the tree should contain a task titled "keepme"
