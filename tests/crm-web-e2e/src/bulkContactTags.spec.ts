import { expect, signIn, test } from "./fixtures";

test("user adds a tag to several contacts", async ({ page, workspace, menu, dismissToast }) => {
  await workspace.createContact({ first_name: "Ada", last_name: "Lovelace", title: "CTO" });
  await workspace.createContact({ first_name: "Grace", last_name: "Hopper", title: "Rear Admiral" });

  await signIn(page, workspace.owner.email);
  await expect(page).toHaveTitle(/OpenProduct CRM/);
  await expect(page.getByRole("link", { name: "Contacts" })).toBeVisible();

  await menu.goToContacts();
  await expect(page.getByText("Ada Lovelace")).toBeVisible();
  await expect(page.getByText("Grace Hopper")).toBeVisible();

  const checkboxes = page.getByRole("checkbox");
  await checkboxes.nth(1).click();
  await page.getByRole("button", { name: /select all/i }).click();

  await page.getByRole("button", { name: /^Tag$/ }).click();
  await page.getByRole("button", { name: "Create new tag" }).click();
  await page.getByLabel("Tag name").fill("Prospect");
  await page.getByRole("button", { name: "Save" }).click();

  await dismissToast("Tag added to 2 contacts");

  await expect(page.getByText("Grace Hopper").locator("xpath=ancestor::a[1]")).toContainText("Prospect");
  await expect(page.getByText("Ada Lovelace").locator("xpath=ancestor::a[1]")).toContainText("Prospect");
});
