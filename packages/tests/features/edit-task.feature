Feature: Edit a task's title
  A task's title is the only user-facing free-text field today. The user
  starts an inline edit by pressing `e` on a focused row (desktop vim
  binding) or by tapping a dedicated pencil button (works the same on
  mouse and touch — the button is hover-revealed on fine pointers and
  always shown on coarse pointers, mirroring delete).

  Enter commits the new title. Escape discards. Blurring the input
  commits (so tapping anywhere outside the editor saves whatever's
  there, matching mobile expectations).

  Scenario: rename a task with the keyboard
    Given the app is running with a fresh database
    When I add a task titled "draft title"
    And I press "e" on the task titled "draft title"
    Then the edit input on the task titled "draft title" should be visible
    When I fill the edit input with "final title"
    And I press Enter in the edit input
    Then the tree should contain a task titled "final title"
    And the tree should not contain a task titled "draft title"

  Scenario: rename a task by clicking the edit button
    Given the app is running with a fresh database
    When I add a task titled "before"
    And I click the edit button on the task titled "before"
    Then the edit input on the task titled "before" should be visible
    When I fill the edit input with "after"
    And I press Enter in the edit input
    Then the tree should contain a task titled "after"
    And the tree should not contain a task titled "before"

  Scenario: cancel an edit with Escape
    Given the app is running with a fresh database
    When I add a task titled "keep me"
    And I press "e" on the task titled "keep me"
    When I fill the edit input with "discarded"
    And I press Escape in the edit input
    Then the tree should contain a task titled "keep me"
    And the tree should not contain a task titled "discarded"

  Scenario: an empty title submission leaves the task unchanged
    Given the app is running with a fresh database
    When I add a task titled "unchanged"
    And I press "e" on the task titled "unchanged"
    When I fill the edit input with "   "
    And I press Enter in the edit input
    Then the tree should contain a task titled "unchanged"

  @mobile
  Scenario: the edit button is visible on touch without hovering
    Given the app is running with a fresh database
    When I add a task titled "tap me"
    Then the edit button on the task titled "tap me" should be revealed without hover

  @mobile
  Scenario: rename a task on touch by tapping the edit button
    Given the app is running with a fresh database
    When I add a task titled "old name"
    And I click the edit button on the task titled "old name"
    Then the edit input on the task titled "old name" should be visible
    When I fill the edit input with "new name"
    And I press Enter in the edit input
    Then the tree should contain a task titled "new name"
    And the tree should not contain a task titled "old name"
