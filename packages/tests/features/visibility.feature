Feature: Visibility lever and structured filter atoms
  The search box accepts structured filter atoms — `done:no`, `done:yes`,
  `done:fresh`, `done:stale`, and `not <atom>` — alongside free text. A
  hairline lever beside the search box inserts `not done:stale` into the
  query as a typing shortcut; deactivating strips the atom back out. The
  atoms-sentence beneath the search box surfaces the parsed structured
  atoms in the breadcrumb's hairline-italic idiom.

  Scenario: lever default state is off, all tasks visible
    Given the app is running with a fresh database
    When I add a task titled "draft PR"
    And I add a task titled "milk"
    Then the visibility lever should be off
    And the tree should contain a task titled "draft PR"
    And the tree should contain a task titled "milk"

  Scenario: clicking the lever inserts the hide-stale atom into the query
    Given the app is running with a fresh database
    When I click the visibility lever
    Then the visibility lever should be on
    And the search input should contain "not done:stale"
    And the atoms sentence should mention "not done:stale"

  Scenario: clicking the lever again strips the hide-stale atom
    Given the app is running with a fresh database
    When I click the visibility lever
    And I click the visibility lever
    Then the visibility lever should be off
    And the search input should be empty
    And the atoms sentence should not be visible

  Scenario: typing not done:stale by hand reflects in the lever's pressed state
    Given the app is running with a fresh database
    When I type "not done:stale" in the search box
    Then the visibility lever should be on
    And the atoms sentence should mention "not done:stale"

  Scenario: done:no atom filters to todo tasks only
    Given the app is running with a fresh database
    When I add a task titled "buy bread"
    And I add a task titled "ship feature"
    And I press "Space" on the task titled "ship feature"
    And I type "done:no" in the search box
    Then the tree should contain a task titled "buy bread"
    And the tree should not contain a task titled "ship feature"
    And the atoms sentence should mention "done:no"

  Scenario: done:yes atom filters to done tasks only
    Given the app is running with a fresh database
    When I add a task titled "buy bread"
    And I add a task titled "ship feature"
    And I press "Space" on the task titled "ship feature"
    And I type "done:yes" in the search box
    Then the tree should not contain a task titled "buy bread"
    And the tree should contain a task titled "ship feature"

  Scenario: Add button disables when the query has any structured atom
    Given the app is running with a fresh database
    When I type "done:no draft" in the search box
    Then the add button should be disabled

  Scenario: Add button enables when the query is plain text only
    Given the app is running with a fresh database
    When I type "groceries" in the search box
    Then the add button should be enabled

  Scenario: lever activation composes with a typed free-text needle
    Given the app is running with a fresh database
    When I add a task titled "buy bread"
    And I type "buy" in the search box
    And I click the visibility lever
    Then the search input should contain "buy"
    And the search input should contain "not done:stale"
    And the tree should contain a task titled "buy bread"

  Scenario: lever deactivation surgically removes the atom and keeps the typed text
    Given the app is running with a fresh database
    When I type "buy" in the search box
    And I click the visibility lever
    And I click the visibility lever
    Then the search input should contain "buy"
    And the search input should not contain "not done:stale"
