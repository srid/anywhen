Feature: Export and import tasks as a JSON backup
  A versioned JSON envelope round-trips the full task set (ids, parents,
  positions, statuses, timestamps) so the user can drop a copy in Dropbox
  (or git, or any file destination) and restore it later. Import is
  destructive — wipe-and-replace — guarded by a browser confirm dialog.

  Scenario: export downloads a versioned JSON backup of all tasks
    Given the app is running with a fresh database
    When I add a task titled "alpha"
    And I add a task titled "beta"
    And I export the backup
    Then the downloaded backup should have version 1
    And the downloaded backup should contain a task titled "alpha"
    And the downloaded backup should contain a task titled "beta"

  Scenario: import replaces the current tasks with the backup contents
    Given the app is running with a fresh database
    When I add a task titled "to be wiped"
    And I export the backup
    And I click the delete button on the task titled "to be wiped"
    Then the tree should not contain a task titled "to be wiped"
    When I import the most recent backup
    Then the tree should contain a task titled "to be wiped"

  Scenario: round-trip preserves the parent-child structure
    Given the app is running with a fresh database
    When I add a task titled "parent"
    And I add a task titled "child"
    And I press "l" on the task titled "child"
    Then the task titled "child" should be a child of the task titled "parent"
    When I export the backup
    And I click the delete button on the task titled "parent"
    Then the tree should not contain a task titled "child"
    When I import the most recent backup
    Then the tree should contain a task titled "parent"
    And the task titled "child" should be a child of the task titled "parent"

  Scenario: import rejects a file that is not a valid backup
    Given the app is running with a fresh database
    When I add a task titled "kept"
    And I import a file containing "not a backup at all"
    Then the tree should contain a task titled "kept"
    And the error message should mention "Import failed"
