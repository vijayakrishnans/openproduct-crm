import { expect, test } from "./fixtures";

// Upstream: the first visitor creates the one account of the instance. Here
// anyone signs in with an email code and names an organization of their own.
test("user onboarding", async ({ page, menu, dismissToast }) => {
  const local = `e2e-onboarding-${Date.now().toString(36)}`;

  await page.goto("/");
  await expect(page).toHaveTitle(/OpenProduct CRM/);
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();

  await page.getByLabel("Email").fill(`${local}@example.com`);
  await page.getByRole("button", { name: "Send code" }).click();
  await expect(page.getByLabel("Sign-in code")).not.toHaveValue("");
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page.getByRole("heading", { name: "Name your organization" })).toBeVisible();
  await page.getByLabel("Organization name").fill(`Onboarding ${local}`);
  await page.getByRole("button", { name: "Create organization" }).click();

  await expect(page.getByText("What's next?")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("1/3 done")).toBeVisible();
  await expect(page.getByText("Install OpenProduct CRM")).toBeVisible();
  await expect(page.getByText("Add your first contact")).toBeVisible();
  await expect(page.getByText("Add your first note")).toBeVisible();
  await expect(page.getByRole("button", { name: "Import data" })).toBeVisible();

  await page.getByRole("link", { name: "Add contact" }).click();
  await page.waitForLoadState("networkidle");

  await page.getByRole("radio", { name: "She/Her" }).click();
  await page.getByLabel("First name").fill("Jane");
  await page.getByLabel("Last name").fill("Smith");
  await page.getByLabel("Title").fill("CEO");
  await page.getByLabel("Company").click();
  await page.getByPlaceholder("Search").fill("Smith Corp");
  await page.getByText("Create Smith Corp").click();
  // The company is created on the server before it is selected; against a
  // remote API that takes a few seconds, and the form must not move on first.
  await expect(page.getByLabel("Company")).toHaveText(/Smith Corp/);
  await page
    .getByRole("group", { name: "Email addresses" })
    .getByRole("textbox", { name: "Email" })
    .fill("jane@smithcorp.com");
  await page.getByRole("group", { name: "Email addresses" }).getByRole("button", { name: "Add" }).click();
  await page
    .getByRole("group", { name: "Phone numbers" })
    .getByRole("textbox", { name: "Phone number" })
    .fill("+1234567890");
  await page.getByRole("group", { name: "Phone numbers" }).getByRole("button", { name: "Add" }).click();
  await page.getByLabel("LinkedIn URL").fill("https://www.linkedin.com/in/jane-smith");
  await page.getByLabel("Background info (bio, how you met, etc)").fill("Met at a conference.");
  await page.getByRole("switch", { name: "Has newsletter" }).check();
  // The profile is named after the email until the member edits it
  await expect(page.getByLabel("Account manager *")).toHaveText(local);
  await page.getByRole("button", { name: "Save" }).click();

  await dismissToast("Element created");

  await expect(page.locator("h5")).toHaveText("Jane Smith");
  await expect(page.getByText("CEO at Smith Corp")).toBeVisible();

  await menu.goToDashboard();
  await page.waitForLoadState("networkidle");
  await expect(page.getByText("2/3 done")).toBeVisible();

  await page.getByRole("link", { name: "Add note" }).click();
  await page.waitForLoadState("networkidle");
  await page.getByPlaceholder("Add a note").fill("This is a note about Jane.");
  await page.getByRole("button", { name: "Add this note" }).click();

  await dismissToast("Note added");

  await expect(page.getByText("You added a note", { exact: false })).toBeVisible();
  await expect(page.getByText("This is a note about Jane.")).toBeVisible();

  await menu.goToDashboard();
  await page.waitForLoadState("networkidle");

  const activity = page.getByText("Latest Activity").locator("xpath=../..");
  await expect(page.getByText("Latest Activity")).toBeVisible();
  await expect(activity).toHaveText(/You added company Smith Corp today at/);
  await expect(activity).toHaveText(/You added Jane Smith to Smith Corp today at/);
  await expect(activity).toHaveText(/You added a note about Jane Smith today at/);
});
