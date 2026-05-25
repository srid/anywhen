import { When, Then } from "@cucumber/cucumber";
import { expect } from "@playwright/test";
import type { AnywhenWorld } from "../support/world";

// Escape regex metacharacters so a fragment from a Gherkin string parameter
// can be passed to toHaveValue() as a literal substring match.
const escapeForRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Maps the Gherkin lever name (in `When I click the <name> lever`) to the
// rendered data-testid. Adding a new lever is one entry here plus the
// matching `data-testid` in App.tsx — the scenarios use the same step
// vocabulary across all levers.
const LEVER_TESTIDS: Record<string, string> = {
  visibility: "visibility-lever",
  focus: "focus-lever",
};

const leverLocator = (page: AnywhenWorld["page"], name: string) => {
  const testId = LEVER_TESTIDS[name];
  if (!testId)
    throw new Error(`unknown lever name: "${name}" (expected one of: visibility, focus)`);
  return page.getByTestId(testId);
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
