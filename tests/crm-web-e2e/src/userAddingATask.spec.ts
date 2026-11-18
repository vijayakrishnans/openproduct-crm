import { expect, signIn, test } from "./fixtures";

test.describe("user adding a task", () => {
  test.beforeEach(async ({ workspace }) => {
    const company = await workspace.createCompany({ name: "Smith Corp" });

    await workspace.createContact({
      first_name: "Jane",
      last_name: "Smith",
      title: "CEO",
      company_id: company.id,
      notes: [{ text: "Met at a conference." }],
    });
    await workspace.createContact({ first_name: "Bob", last_name: "Johnson", title: "CTO", company_id: company.id });
    await workspace.createContact({ first_name: "Alice", last_name: "Williams", title: "CFO", company_id: company.id });
  });

  test("user adding a task", async ({ page, workspace, menu, dismissToast }) => {
    await signIn(page, workspace.owner.email);

    await expect(page).toHaveTitle(/BrokeCRM/);
    await expect(page.getByText("Latest Activity")).toBeVisible();

    await menu.goToContacts();
    await page.waitForLoadState("networkidle");

    await page.getByText("Jane Smith").click();
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: "Add Task" }).click();
    await page.getByLabel("Description *").fill("Follow up with Jane");
    await page.getByLabel("Due date").fill("2026-04-11T21:00");
    await page.getByLabel("Type").click();
    await page.getByRole("option", { name: "Call" }).click();

    await page.getByRole("button", { name: "Save" }).click();
    await dismissToast("Task added");

    await expect(page.getByText("Tasks")).toBeVisible();
    await expect(page.getByText("Tasks").locator("..")).toHaveText(/Follow up with Jane/);
    await menu.goToDashboard();

    await expect(page.getByText("Upcoming Tasks")).toBeVisible();
    await expect(page.getByText("Upcoming Tasks").locator("../..")).toHaveText(/Follow up with Jane/);
    await expect(page.getByText("Follow up with Jane").locator("..")).toHaveText(
      "Call Follow up with Janedue 4/11/2026, 9:00:00 PM (Re: Jane Smith)",
    );
  });
});
