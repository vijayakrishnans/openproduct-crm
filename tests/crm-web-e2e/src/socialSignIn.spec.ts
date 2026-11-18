import { expect, test } from "./fixtures";

// No real provider is involved: the identity service's part (the OAuth
// exchange) has its own tests. These cover the web app's two halves: offering
// the providers the service lists, and taking in what it sends back.
test.describe("sign-in with a provider", () => {
  test("offers the providers the service lists, and no others", async ({ page }) => {
    await page.route("**/v1/auth/oauth/providers", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "access-control-allow-origin": "*" },
        body: JSON.stringify({ data: { providers: [{ id: "google", displayName: "Google" }] } }),
      }),
    );
    await page.goto("/#/login");

    const google = page.getByRole("link", { name: "Continue with Google" });
    await expect(google).toBeVisible();
    const href = new URL((await google.getAttribute("href"))!);
    expect(href.pathname).toBe("/v1/auth/oauth/google/start");
    expect(href.searchParams.get("return_to")).toBe(`${new URL(page.url()).origin}/?signin=google`);
    await expect(page.getByRole("link", { name: "Continue with GitHub" })).toHaveCount(0);
    // the email code is still there
    await expect(page.getByLabel("Email")).toBeVisible();
  });

  test("coming back with a token signs the person in and leaves no token in the address", async ({ page, workspace }) => {
    const session = await workspace.ownerSession();
    await page.goto(
      `/?signin=google#token=${encodeURIComponent(session.token)}&token_type=bearer&expires_at=${encodeURIComponent(session.expiresAt)}`,
    );

    await expect(page.getByRole("link", { name: "Dashboard" })).toBeVisible({ timeout: 60_000 });
    expect(page.url()).not.toContain(session.token);
    expect(page.url()).not.toContain("signin=");
    const stored = await page.evaluate(() => JSON.parse(window.localStorage.getItem("openproduct-crm.session")!));
    expect(stored.email).toBe(workspace.owner.email);
  });

  test("coming back with an error shows why, on the sign-in form", async ({ page }) => {
    await page.goto("/?signin=github#error=email_unverified");

    await expect(page.getByText("That account's email is not verified.", { exact: false })).toBeVisible();
    await expect(page.getByLabel("Email")).toBeVisible();
    expect(page.url()).not.toContain("error=");
  });
});
