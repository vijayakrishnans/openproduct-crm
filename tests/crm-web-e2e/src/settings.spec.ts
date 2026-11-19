import { expect, signIn, test } from "./fixtures";

test.describe("settings", () => {
  test("an administrator opens the settings and saves a change", async ({ page, workspace, dismissToast }) => {
    await signIn(page, workspace.owner.email);
    await expect(page.getByRole("link", { name: "Dashboard" })).toBeVisible();

    // Let the sign-in finish (it ends with a redirect to the dashboard) before
    // opening the menu, or the redirect can land after the Settings click.
    await expect(page.getByRole("link", { name: "Dashboard" })).toBeVisible({ timeout: 60_000 });
    await page.waitForLoadState("networkidle");
    // The user menu is the avatar, the last button of the header.
    await page.getByRole("navigation").first().getByRole("button").last().click();
    // Saving is refused until the form has the deals it checks stages against.
    const dealsLoaded = page.waitForResponse((r) => /\/crm\/deals\?.*perPage=1000/.test(r.url()), {
      timeout: 60_000,
    });
    await page.getByRole("menuitem", { name: "Settings" }).click();
    await dealsLoaded;

    // The page is the settings form, not "Not Found".
    await expect(page).toHaveURL(/\/settings$/);
    await expect(page.getByText("Not Found")).toHaveCount(0);
    const title = page.getByLabel("App Title");
    await expect(title).toBeVisible();

    await title.fill("Acme CRM");
    await page.getByRole("button", { name: "Save" }).click();
    await dismissToast("Configuration saved successfully");

    // The change is stored for the organization, not only in this tab.
    await page.reload();
    await expect(page.getByLabel("App Title")).toHaveValue("Acme CRM");
  });
});
