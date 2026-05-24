Feature: Multi-line tasks with markdown bodies
  A task's title may span more than one line. The first line is the row
  label shown in the tree; subsequent lines are the body, rendered as
  basic Markdown inside a native HTML disclosure widget (`<details>`)
  beneath the row — collapsed by default, expanded on click. This works
  the same on desktop and touch (no hover-only affordance).

  The search box and the inline title editor are both textareas so the
  user can compose multi-line content directly. Enter submits;
  Shift+Enter inserts a newline.

  Scenario: create a multi-line task from the search box
    Given the app is running with a fresh database
    When I add a multi-line task with first line "Shopping list" and body "- milk\n- bread\n- **eggs**"
    Then the tree should contain a task titled "Shopping list"
    And the task with first line "Shopping list" should have a body disclosure

  Scenario: body renders as markdown when expanded
    Given the app is running with a fresh database
    When I add a multi-line task with first line "Reading" and body "See **Simple Made Easy** and [Lowy](https://example.com)"
    And I expand the body of the task with first line "Reading"
    Then the body of the task with first line "Reading" should contain a "strong" element with text "Simple Made Easy"
    And the body of the task with first line "Reading" should contain an "a" element with text "Lowy"

  Scenario: single-line tasks have no body disclosure
    Given the app is running with a fresh database
    When I add a task titled "plain task"
    Then the tree should contain a task titled "plain task"
    And the task with first line "plain task" should not have a body disclosure

  Scenario: edit a task to add a body
    Given the app is running with a fresh database
    When I add a task titled "groceries"
    And I press "e" on the task titled "groceries"
    And I fill the edit input with "groceries\n\nbuy *organic* veg"
    And I press Enter in the edit input
    Then the tree should contain a task titled "groceries"
    And the task with first line "groceries" should have a body disclosure
