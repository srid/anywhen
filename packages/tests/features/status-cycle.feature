Feature: Cycle a task through todo → doing → done
  The row checkbox cycles task lifecycle: a fresh task is `todo`; pressing
  Space or clicking the checkbox advances to `doing` (currently being
  worked on), then `done`, then wraps back to `todo`. The middle state has
  its own quiet affordance — an inner concentric ring quoting the brand
  mark — and no strikethrough; that decoration stays exclusive to done so
  the two terminal states don't blur.

  Scenario: clicking the checkbox cycles a task through every state
    Given the app is running with a fresh database
    When I add a task titled "ship the thing"
    Then the task titled "ship the thing" should have status "todo"
    When I click the checkbox on the task titled "ship the thing"
    Then the task titled "ship the thing" should have status "doing"
    When I click the checkbox on the task titled "ship the thing"
    Then the task titled "ship the thing" should have status "done"
    When I click the checkbox on the task titled "ship the thing"
    Then the task titled "ship the thing" should have status "todo"

  Scenario: Space advances a focused row through the cycle
    Given the app is running with a fresh database
    When I add a task titled "study the score"
    When I press " " on the task titled "study the score"
    Then the task titled "study the score" should have status "doing"
    When I press " " on the task titled "study the score"
    Then the task titled "study the score" should have status "done"
