Feature: Eternalist UI — breadcrumb, now-tick, empty-state quote
  Three small in-character moves that lean into anywhen's philosophy: tasks
  live in eternity, the present moment is wherever your attention is. The
  meridian rule marks the now without urgency; selecting a row reveals its
  lineage as a sentence above the search box; the empty state offers a
  quiet quote in place of an exhortation.

  Scenario: meridian rule shows a single now-tick at all times
    Given the app is running with a fresh database
    Then the meridian rule should show a now-tick

  Scenario: empty state shows a quiet philosophical quote
    Given the app is running with a fresh database
    Then the empty state should contain the quote "the tree begins whenever you do"

  Scenario: selecting a deep task reveals its ancestor breadcrumb
    Given the app is running with a fresh database
    When I add a task titled "Reading"
    And I add a task titled "Simple Made Easy"
    And I press "Tab" on the task titled "Simple Made Easy"
    And I focus the task titled "Simple Made Easy"
    Then the breadcrumb should read "Reading"

  Scenario: breadcrumb is absent when nothing is selected
    Given the app is running with a fresh database
    When I add a task titled "Standalone"
    Then the breadcrumb should not be visible

  Scenario: breadcrumb is absent for a root-level selection
    Given the app is running with a fresh database
    When I add a task titled "Root"
    And I focus the task titled "Root"
    Then the breadcrumb should not be visible
