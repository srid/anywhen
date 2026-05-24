import { When, Then } from "@cucumber/cucumber";
import { expect } from "@playwright/test";
import type { AnywhenWorld } from "../support/world";

// Escape regex metacharacters so a fragment from a Gherkin string parameter
// can be passed to toHaveValue() as a literal substring match.
const escapeForRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

When("I click the visibility lever", async function (this: AnywhenWorld) {
  await this.page.getByTestId("visibility-lever").click();
});

Then("the visibility lever should be on", async function (this: AnywhenWorld) {
  await expect(this.page.getByTestId("visibility-lever")).toHaveAttribute("aria-pressed", "true");
});

Then("the visibility lever should be off", async function (this: AnywhenWorld) {
  await expect(this.page.getByTestId("visibility-lever")).toHaveAttribute("aria-pressed", "false");
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
