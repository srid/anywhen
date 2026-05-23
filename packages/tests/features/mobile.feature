@mobile
Feature: Mobile UX — touch input on a phone-sized viewport
  Scenarios tagged @mobile run in a touch-enabled, 390x844 viewport
  (the iPhone 12/13/14 size). The Add button is the primary creation
  affordance since there's no Cmd-Enter on a touchscreen. Long-pressing
  a row enters drag mode so quick finger flicks remain scroll, not drag.

  Scenario: add a task by tapping the Add button on mobile
    Given the app is running with a fresh database
    When I type "grocery list" in the search box
    And I click the add button
    Then the tree should contain a task titled "grocery list"

  Scenario: reorder siblings by long-press touch drag
    Given the app is running with a fresh database
    When I add a task titled "first"
    And I add a task titled "second"
    Then the tasks should appear in order: "first", "second"
    When I touch-drag the task titled "second" before the task titled "first"
    Then the tasks should appear in order: "second", "first"

  Scenario: nest a task by long-press touch drag into the middle of another
    Given the app is running with a fresh database
    When I add a task titled "parent"
    And I add a task titled "leaf"
    Then the tree should contain a task titled "leaf"
    When I touch-drag the task titled "leaf" inside the task titled "parent"
    Then the task titled "leaf" should be a child of the task titled "parent"

  Scenario: the delete button is visible on touch without hovering
    Given the app is running with a fresh database
    When I add a task titled "throwaway"
    Then the tree should contain a task titled "throwaway"
    When I click the delete button on the task titled "throwaway"
    Then the tree should not contain a task titled "throwaway"
