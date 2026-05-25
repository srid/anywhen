Feature: Visibility lever and structured filter atoms
  The search box accepts structured filter atoms — `done:no`, `done:yes`,
  `done:fresh`, `done:stale`, `status:todo|doing|done`, and `not <atom>` —
  alongside free text. Two hairline levers beside the search box inject
  atoms into the query as typing shortcuts: the visibility lever toggles
  `not done:stale`, and the focus lever toggles `status:doing`.
  Deactivating either strips its atom back out. The atoms-sentence
  beneath the search box surfaces the parsed structured atoms in the
  breadcrumb's hairline-italic idiom.

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

  Scenario: done:no atom filters to not-done tasks (todo + doing)
    Given the app is running with a fresh database
    When I add a task titled "buy bread"
    And I add a task titled "ship feature"
    And I press "Space" on the task titled "ship feature"
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

  Scenario: focus lever default state is off
    Given the app is running with a fresh database
    When I add a task titled "draft PR"
    Then the focus lever should be off
    And the tree should contain a task titled "draft PR"

  Scenario: clicking the focus lever inserts status:doing into the query
    Given the app is running with a fresh database
    When I click the focus lever
    Then the focus lever should be on
    And the search input should contain "status:doing"
    And the atoms sentence should mention "status:doing"

  Scenario: clicking the focus lever again strips status:doing
    Given the app is running with a fresh database
    When I click the focus lever
    And I click the focus lever
    Then the focus lever should be off
    And the search input should be empty
    And the atoms sentence should not be visible

  Scenario: typing status:doing by hand reflects in the focus lever's pressed state
    Given the app is running with a fresh database
    When I type "status:doing" in the search box
    Then the focus lever should be on
    And the atoms sentence should mention "status:doing"

  Scenario: focus lever filters the tree to only doing tasks
    Given the app is running with a fresh database
    When I add a task titled "buy bread"
    And I add a task titled "ship feature"
    And I press "Space" on the task titled "ship feature"
    And I click the focus lever
    Then the tree should not contain a task titled "buy bread"
    And the tree should contain a task titled "ship feature"

  Scenario: both levers compose — only doing tasks, excluding stale-done
    Given the app is running with a fresh database
    When I add a task titled "ship feature"
    And I press "Space" on the task titled "ship feature"
    And I click the focus lever
    And I click the visibility lever
    Then the focus lever should be on
    And the visibility lever should be on
    And the search input should contain "status:doing"
    And the search input should contain "not done:stale"
