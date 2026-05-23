Feature: Add a task and see it in the tree
  The user opens the app, types a title in the search box, and commits with
  Cmd/Ctrl+Enter (or the visible Add button). The task appears as a new root
  in the tree. Toggling done with the row checkbox marks it complete.
  Clicking the per-row × removes the task (and cascades to any descendants
  via the SQL FK).

  Scenario: add a root task via Cmd+Enter and toggle it done
    Given the app is running with a fresh database
    When I add a task titled "buy milk"
    Then the tree should contain a task titled "buy milk"
    And the task titled "buy milk" should have status "todo"
    When I click the checkbox on the task titled "buy milk"
    Then the task titled "buy milk" should have status "done"

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

  Scenario: plain Enter on a non-empty query does not create a task
    Given the app is running with a fresh database
    When I type "just a query" in the search box
    And I press Enter in the search box
    Then the tree should not contain a task titled "just a query"
