Feature: Live filter narrows the tree as you type
  Typing a query in the search box filters the tree. Matching tasks
  appear with the matched substring highlighted. Ancestors of a match
  stay visible but dimmed so the path to the match is intact. Empty
  input shows the full tree, unchanged.

  Scenario: typing a substring shows matches and hides non-matches
    Given the app is running with a fresh database
    When I type "+ buy milk" in the search box
    And I press Enter in the search box
    And I type "+ buy eggs" in the search box
    And I press Enter in the search box
    And I type "+ draft PR" in the search box
    And I press Enter in the search box
    And I type "buy" in the search box
    Then the tree should contain a task titled "buy milk"
    And the tree should contain a task titled "buy eggs"
    And the tree should not contain a task titled "draft PR"
    And the matched substring "buy" in the task titled "buy milk" should be highlighted

  Scenario: ancestors of a match stay visible but dimmed
    Given the app is running with a fresh database
    When I type "+ groceries" in the search box
    And I press Enter in the search box
    And I type "+ buy milk" in the search box
    And I press Enter in the search box
    And I press "Tab" on the task titled "buy milk"
    And I type "buy" in the search box
    Then the tree should contain a task titled "buy milk"
    And the task titled "groceries" should be dimmed
    And the task titled "buy milk" should not be dimmed

  Scenario: clearing the query restores the full tree
    Given the app is running with a fresh database
    When I type "+ apple" in the search box
    And I press Enter in the search box
    And I type "+ banana" in the search box
    And I press Enter in the search box
    And I type "app" in the search box
    Then the tree should not contain a task titled "banana"
    When I clear the search box
    Then the tree should contain a task titled "apple"
    And the tree should contain a task titled "banana"
