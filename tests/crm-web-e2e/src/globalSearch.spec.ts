import { expect, signIn, test } from "./fixtures";

test.describe("global search", () => {
  test.beforeEach(async ({ workspace }) => {
    // The contact is created before its notes, so every note is newer
    await workspace.createContact({
      first_name: "Zebulon",
      last_name: "Durand",
      notes: Array.from({ length: 12 }, (_, index) => ({
        text: `Called Zebulon about the renewal (${index + 1})`,
      })),
    });
  });

  test("finds an old contact despite many newer notes mentioning them", async ({ page, workspace }) => {
    await signIn(page, workspace.owner.email);
    await expect(page.getByText("Latest Activity")).toBeVisible();

    await page.getByRole("button", { name: "Search", exact: true }).click();
    await page.getByPlaceholder("Search contacts, companies, deals, tasks and notes...").fill("zebulon");

    const contacts = page.getByRole("group", { name: "Contacts" });
    await expect(contacts.getByRole("option")).toHaveCount(1);
    await expect(contacts.getByRole("option")).toContainText("Zebulon Durand");

    // 3 notes, then the rest of the 10 fetched once expanded
    const notes = page.getByRole("group", { name: "Contact notes" });
    await expect(notes.getByRole("option")).toHaveCount(4);
    await notes.getByRole("option", { name: "Show more" }).click();
    await expect(notes.getByRole("option")).toHaveCount(10);
  });
});
