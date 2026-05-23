Feature: Progressive Web App support
  The app advertises itself as an installable PWA: an index page that links a
  web manifest and registers a service worker, a manifest at a stable path,
  a service worker served as JavaScript, and an SVG icon the manifest can
  reference. Browsers use these to offer "Install" and to provide offline
  fallback.

  Scenario: the manifest is served at /manifest.webmanifest
    Given the app is running with a fresh database
    Then GET "/manifest.webmanifest" returns status 200
    And the response content-type starts with "application/manifest+json"
    And the JSON response has field "name"
    And the JSON response has field "start_url"
    And the JSON response has field "display"
    And the JSON response has field "icons"

  Scenario: the service worker is served at /service-worker.js
    Given the app is running with a fresh database
    Then GET "/service-worker.js" returns status 200
    And the response content-type starts with "application/javascript"

  Scenario: the SVG icon is served at /icon.svg
    Given the app is running with a fresh database
    Then GET "/icon.svg" returns status 200
    And the response content-type starts with "image/svg+xml"

  Scenario: the HTML head wires the PWA primitives
    Given the app is running with a fresh database
    Then the page head has a link with rel "manifest" pointing at "/manifest.webmanifest"
    And the page head has a meta tag "theme-color"
    And the page head has a link with rel "icon" pointing at "/icon.svg"
