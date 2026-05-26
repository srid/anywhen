import { When, Then } from "@cucumber/cucumber";
import { expect } from "@playwright/test";
import type { AnywhenWorld } from "../support/world";

// Escape regex metacharacters so a fragment from a Gherkin string parameter
// can be passed to toHaveValue() as a literal substring match.
const escapeForRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// The Gherkin lever name (in `When I click the <name> lever`) maps to a
// `${name}-lever` data-testid by convention — every lever in App.tsx
// follows this naming. The Set is a runtime guard so a Gherkin typo
// fails loud rather than silently looking for a non-existent element.
const KNOWN_LEVERS = new Set(["visibility", "focus"]);

const leverLocator = (page: AnywhenWorld["page"], name: string) => {
  if (!KNOWN_LEVERS.has(name)) {
    throw new Error(
      `unknown lever name: "${name}" (expected one of: ${[...KNOWN_LEVERS].join(", ")})`,
    );
  }
  return page.getByTestId(`${name}-lever`);
};

When("I click the {word} lever", async function (this: AnywhenWorld, name: string) {
  await leverLocator(this.page, name).click();
});

Then("the {word} lever should be on", async function (this: AnywhenWorld, name: string) {
  await expect(leverLocator(this.page, name)).toHaveAttribute("aria-pressed", "true");
});

Then("the {word} lever should be off", async function (this: AnywhenWorld, name: string) {
  await expect(leverLocator(this.page, name)).toHaveAttribute("aria-pressed", "false");
});

Then(
  "the search input should contain {string}",
  async function (this: AnywhenWorld, fragment: string) {
    // toHaveValue with a regex auto-retries until the condition is met,
    // unlike inputValue() + toContain() which snapshot-checks once.
    await expect(this.page.getByTestId("search-input")).toHaveValue(
      new RegExp(escapeForRegex(fragment)),
    );
  },
);

Then(
  "the search input should not contain {string}",
  async function (this: AnywhenWorld, fragment: string) {
    await expect(this.page.getByTestId("search-input")).not.toHaveValue(
      new RegExp(escapeForRegex(fragment)),
    );
  },
);

Then("the search input should be empty", async function (this: AnywhenWorld) {
  await expect(this.page.getByTestId("search-input")).toHaveValue("");
});

Then(
  "the atoms sentence should mention {string}",
  async function (this: AnywhenWorld, fragment: string) {
    const sentence = this.page.getByTestId("atoms-sentence");
    await expect(sentence).toBeVisible();
    await expect(sentence).toContainText(fragment);
  },
);

Then("the atoms sentence should not be visible", async function (this: AnywhenWorld) {
  await expect(this.page.getByTestId("atoms-sentence")).toBeHidden();
});

Then("the add button should be disabled", async function (this: AnywhenWorld) {
  await expect(this.page.getByTestId("add-button")).toBeDisabled();
});

Then("the add button should be enabled", async function (this: AnywhenWorld) {
  await expect(this.page.getByTestId("add-button")).toBeEnabled();
});
