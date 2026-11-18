import { expect, signIn, test } from "./fixtures";

test.describe("landing page", () => {
  test("a visitor with no session sees the landing page, and its button leads to sign-in", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("heading", { level: 1, name: "The CRM for teams with no CRM budget." })).toBeVisible();
    await expect(page).toHaveTitle(/BrokeCRM/);
    // the credits and the links the page owes
    await expect(page.getByRole("link", { name: "Atomic CRM" }).first()).toHaveAttribute("href", "https://github.com/marmelab/atomic-crm");
    await expect(page.getByRole("link", { name: "Orunbase" }).first()).toHaveAttribute("href", "https://orunbase.com");
    await expect(page.getByRole("link", { name: "openproduct" }).first()).toHaveAttribute("href", /openproduct\.live/);
    await expect(page.getByRole("link", { name: "Apache-2.0 licence" })).toHaveAttribute("href", /\/LICENSE$/);
    // the app has not started behind it
    await expect(page.getByLabel("Email")).toHaveCount(0);

    await page.getByRole("link", { name: "Start free" }).first().click();
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: "The CRM for teams with no CRM budget." })).toBeHidden();
  });

  test("someone signed in gets the app at the same address", async ({ page, workspace }) => {
    await signIn(page, workspace.owner.email);
    await expect(page.getByRole("link", { name: "Dashboard" })).toBeVisible();

    await page.goto("/");
    await expect(page.getByRole("link", { name: "Dashboard" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: "The CRM for teams with no CRM budget." })).toBeHidden();
  });

  test("the terms and the privacy policy are one click from the landing page", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "Terms", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Terms of use" })).toBeVisible();
    await expect(page.getByText("Apache License, Version 2.0")).toBeVisible();

    await page.getByRole("link", { name: "Privacy", exact: true }).first().click();
    await expect(page.getByRole("heading", { level: 1, name: "Privacy policy" })).toBeVisible();
    await expect(page.getByText("No analytics, advertising or tracking scripts", { exact: false })).toBeVisible();
  });

  test("the sign-in form links to both", async ({ page }) => {
    await page.goto("/#/login");
    await expect(page.getByRole("link", { name: "terms", exact: true })).toHaveAttribute("href", "/terms.html");
    await expect(page.getByRole("link", { name: "privacy policy" })).toHaveAttribute("href", "/privacy.html");
  });
});
