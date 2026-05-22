Feature: Add a task and see it in the tree
  The user opens the app, types "+ <title>" in the search box, presses
  Enter, and the task appears as a new root in the tree. Toggling done
  with the row checkbox (or Space on a focused row) marks it complete.

  Scenario: add a root task via the + prefix and toggle it done
    Given the app is running with a fresh database
    When I type "+ buy milk" in the search box
    And I press Enter in the search box
    Then the tree should contain a task titled "buy milk"
    And the task titled "buy milk" should have status "todo"
    When I click the checkbox on the task titled "buy milk"
    Then the task titled "buy milk" should have status "done"
