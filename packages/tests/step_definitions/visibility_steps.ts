import { When, Then } from "@cucumber/cucumber";
import { expect } from "@playwright/test";
import type { AnywhenWorld } from "../support/world";

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
      new RegExp(fragment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
  },
);

Then(
  "the search input should not contain {string}",
  async function (this: AnywhenWorld, fragment: string) {
    await expect(this.page.getByTestId("search-input")).not.toHaveValue(
      new RegExp(fragment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
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
