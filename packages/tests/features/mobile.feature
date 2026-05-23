@mobile
Feature: Mobile UX — touch input on a phone-sized viewport
  Scenarios tagged @mobile run in a touch-enabled, 390x844 viewport
  (the iPhone 12/13/14 size). The Add button is the primary creation
  affordance on touch (no on-screen Enter key prompt to commit titles
  in mobile keyboards). Long-pressing a row enters drag mode so quick
  finger flicks remain scroll, not drag. An explicit grip handle on
  the left of each row gives a discoverable, instant-drag alternative
  so users do not have to discover the long-press timing themselves.

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

  Scenario: the drag handle is visible on touch
    Given the app is running with a fresh database
    When I add a task titled "grabbable"
    Then the drag handle on the task titled "grabbable" should be visible

  Scenario: reorder siblings by dragging from the handle (no long-press)
    Given the app is running with a fresh database
    When I add a task titled "first"
    And I add a task titled "second"
    Then the tasks should appear in order: "first", "second"
    When I handle-drag the task titled "second" before the task titled "first"
    Then the tasks should appear in order: "second", "first"

  Scenario: nest a task by dragging from the handle into the middle of another
    Given the app is running with a fresh database
    When I add a task titled "parent"
    And I add a task titled "leaf"
    Then the tree should contain a task titled "leaf"
    When I handle-drag the task titled "leaf" inside the task titled "parent"
    Then the task titled "leaf" should be a child of the task titled "parent"

  Scenario: the delete button is visible on touch without hovering
    Given the app is running with a fresh database
    When I add a task titled "throwaway"
    Then the delete button on the task titled "throwaway" should be revealed without hover
    When I click the delete button on the task titled "throwaway"
    Then the tree should not contain a task titled "throwaway"

  Scenario: the edit button is visible on touch without hovering
    Given the app is running with a fresh database
    When I add a task titled "tap me"
    Then the edit button on the task titled "tap me" should be revealed without hover
