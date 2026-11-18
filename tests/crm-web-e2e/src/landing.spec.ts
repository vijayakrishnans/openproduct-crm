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
});
