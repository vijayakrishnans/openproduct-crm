import { expect, signIn, test, type Sales } from "./fixtures";

test.describe("admin filtering by account manager", () => {
  let teammate: Sales;

  test.beforeEach(async ({ workspace }) => {
    teammate = await workspace.addTeammate({ first_name: "Marie", last_name: "Curie" });
    const company = await workspace.createCompany({ name: "Smith Corp" });

    await workspace.createContact({ company_id: company.id, first_name: "Ada", last_name: "Lovelace", title: "CTO" });
    await workspace.createContact({
      company_id: company.id,
      first_name: "Grace",
      last_name: "Hopper",
      sales_id: teammate.id,
      title: "Rear Admiral",
    });
  });

  test("admin narrows the contact list down to a teammate's contacts", async ({ page, workspace, menu }) => {
    await signIn(page, workspace.owner.email);

    await menu.goToContacts();
    await expect(page.getByText("Ada Lovelace")).toBeVisible();
    await expect(page.getByText("Grace Hopper")).toBeVisible();

    await page.getByRole("button", { name: "Marie Curie" }).click();
    await expect(page.getByText("Grace Hopper")).toBeVisible();
    await expect(page.getByText("Ada Lovelace")).toBeHidden();

    await page.getByRole("button", { name: "Marie Curie" }).click();
    await expect(page.getByText("Ada Lovelace")).toBeVisible();
    await expect(page.getByText("Grace Hopper")).toBeVisible();
  });

  test("a non-admin user gets no account manager list", async ({ page, menu }) => {
    await signIn(page, teammate.email);

    await menu.goToContacts();
    await expect(page.getByText("Grace Hopper")).toBeVisible();

    await expect(page.getByRole("button", { name: "Me", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "John Doe" })).toBeHidden();
  });
});
