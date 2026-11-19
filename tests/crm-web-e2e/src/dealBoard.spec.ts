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
      // once saved, the board reloads: wait for that before the next move
      const reloaded = page.waitForResponse((r) => r.request().method() === "GET" && decodeURIComponent(r.url()).includes('/crm/deals?') && decodeURIComponent(r.url()).includes('"archived_at@is":null'));
      expect((await saved).status()).toBe(200);
      await reloaded;
      await page.waitForLoadState("networkidle");
    };

    // into an empty column
    await move("Beta", "ArrowRight");
    // next to the deal with the retired stage: it must take the column's stage, not that one
    await move("Beta", "ArrowLeft");
    await move("Alpha", "ArrowRight", "ArrowRight");

    // two moves of the same deal without waiting for the first to be saved:
    // the second must start from where the first left it
    const drag = async (name: string, key: string) => {
      await card(name).focus();
      await page.keyboard.press("Space");
      await page.keyboard.press(key);
      await page.keyboard.press("Space");
    };
    const settled = page.waitForResponse(
      (r) => r.request().method() === "GET" && decodeURIComponent(r.url()).includes('"archived_at@is":null'),
      { timeout: 90_000 },
    );
    await drag("Orphan", "ArrowRight");
    await drag("Orphan", "ArrowRight");
    await settled;
    await page.waitForLoadState("networkidle");

    await expect(page.getByText("Something went wrong")).toHaveCount(0);

    await page.reload();
    await expect(card("Alpha")).toBeVisible({ timeout: 60_000 });
    const column = (title: string) => page.getByRole("heading", { name: title, exact: true }).locator("xpath=../..");
    await expect(column("In Negotiation").getByRole("button", { name: /- Alpha/ })).toBeVisible();
    await expect(column("Opportunity").getByRole("button", { name: /- Beta/ })).toBeVisible();
    await expect(column("In Negotiation").getByRole("button", { name: /- Orphan/ })).toBeVisible();
  });

  test("a deal written without an amount or contacts opens", async ({ page, workspace }) => {
    // What the API and the MCP server store when a client leaves them out.
    const company = await workspace.createCompany({ name: "Lean Corp" });
    const deal = await workspace.createDeal({ name: "No amount", stage: "opportunity", company_id: company.id, contact_ids: null });

    await signIn(page, workspace.owner.email);
    await page.goto(`/#/deals/${deal.id}/show`);
    await expect(page.getByRole("heading", { name: "No amount" })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText("No amount", { exact: true }).last()).toBeVisible();
    await expect(page.getByText("Something went wrong")).toHaveCount(0);

    // and the company page lists it
    await page.goto(`/#/companies/${company.id}/show`);
    await expect(page.getByText("No amount").first()).toBeVisible({ timeout: 60_000 });
  });
});
