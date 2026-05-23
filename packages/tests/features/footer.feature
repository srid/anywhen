Feature: Footer shows source link, hostname, and DB path
  The footer surfaces three facts about the running instance — a link to
  the GitHub source, the OS hostname the server is running on, and the
  SQLite path it's writing to — so a user opening the app can see where
  their data lives at a glance.

  Scenario: footer shows source link, hostname, and db path
    Given the app is running with a fresh database
    Then the footer should link to "https://github.com/srid/anywhen"
    And the footer should show the server hostname
    And the footer should show a database path ending in "anywhen.db"
