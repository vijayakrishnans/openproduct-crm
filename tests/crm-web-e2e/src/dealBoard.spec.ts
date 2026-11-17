import { expect, signIn, test } from "./fixtures";

// Cards are dragged with the keyboard (space, arrows, space): the same code
// path as the mouse, without depending on pixel positions.
test.describe("deal board", () => {
  test("a deal dragged to another column stays there", async ({ page, workspace }) => {
    const company = await workspace.createCompany({ name: "Smith Corp" });
    for (const [index, name] of ["Alpha", "Beta"].entries()) {
      await workspace.createDeal({ name, stage: "opportunity", company_id: company.id, index });
    }
    // a deal whose stage is not configured any more: shown in the first column
    await workspace.createDeal({ name: "Orphan", stage: "retired-stage", company_id: company.id, index: 2 });

    await signIn(page, workspace.owner.email);
    await page.getByRole("link", { name: "Deals" }).click();
    const card = (name: string) => page.getByRole("button", { name: new RegExp(`- ${name}`) });
    await expect(card("Alpha")).toBeVisible({ timeout: 60_000 });

    const move = async (name: string, ...keys: string[]) => {
      const saved = page.waitForResponse(
        (r) => r.request().method() === "PATCH" && /\/crm\/deals\/\d+$/.test(r.url()) && (r.request().postData() ?? "").includes("stage"),
      );
      await card(name).focus();
      await page.keyboard.press("Space");
      for (const key of keys) await page.keyboard.press(key);
      await page.keyboard.press("Space");
      expect((await saved).status()).toBe(200);
      await page.waitForLoadState("networkidle");
    };

    // into an empty column
    await move("Beta", "ArrowRight");
    // next to the deal with the retired stage: it must take the column's stage, not that one
    await move("Beta", "ArrowLeft");
    await move("Alpha", "ArrowRight", "ArrowRight");

    await expect(page.getByText("Something went wrong")).toHaveCount(0);

    await page.reload();
    await expect(card("Alpha")).toBeVisible({ timeout: 60_000 });
    const column = (title: string) => page.getByRole("heading", { name: title, exact: true }).locator("xpath=../..");
    await expect(column("In Negotiation").getByRole("button", { name: /- Alpha/ })).toBeVisible();
    await expect(column("Opportunity").getByRole("button", { name: /- Beta/ })).toBeVisible();
    await expect(column("Opportunity").getByRole("button", { name: /- Orphan/ })).toBeVisible();
  });
});
