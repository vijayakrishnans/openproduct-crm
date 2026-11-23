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
    await expect(page.getByRole("link", { name: "Apache-2.0 licence" })).toHaveAttribute("href", /\/LICENSE$/);
    // the app has not started behind it
    await expect(page.getByLabel("Email")).toHaveCount(0);

    // the commitment, the way to support it, and the assistant's address
    await expect(page.getByRole("heading", { level: 2, name: "Our commitment" })).toBeVisible();
    await expect(page.getByRole("link", { name: "COMMITMENT.md" })).toHaveAttribute("href", /\/COMMITMENT\.md$/);
    await expect(page.getByRole("link", { name: "Support us on Patreon" })).toHaveAttribute("href", /patreon\.com/);
    await expect(page.getByText("https://mcp.brokecrm.cloud/mcp").first()).toBeVisible();
    await expect(page.getByRole("link", { name: /^The workspace/ })).toHaveAttribute("href", "https://openproduct.live/broke-crm/workspace");

    await page.getByRole("link", { name: "Free forever" }).first().click();
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

  test("the terms and the privacy policy are one click from the landing page", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "Terms", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Terms of use" })).toBeVisible();
    await expect(page.getByText("Apache License, Version 2.0")).toBeVisible();

    await page.getByRole("link", { name: "Privacy", exact: true }).first().click();
    await expect(page.getByRole("heading", { level: 1, name: "Privacy policy" })).toBeVisible();
    await expect(page.getByText("No analytics, advertising or tracking scripts", { exact: false })).toBeVisible();
  });

  test("a link to a place on the page does not start the app, and the demo offers a way to ask for it", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "Contact" }).first().click();
    await expect(page.getByRole("heading", { level: 2, name: "Want it for your team?" })).toBeVisible();
    // the branding form is gone
    await expect(page.getByRole("link", { name: "Make it yours" })).toHaveCount(0);

    await page.goto("/?demo");
    const card = page.getByRole("complementary", { name: "Get this CRM for your team" });
    await expect(card.getByRole("link", { name: "vijayakrishnan.kartha@orunbase.com" })).toHaveAttribute("href", /^mailto:/);
    await expect(card.getByRole("link", { name: "support@brokecrm.cloud" })).toHaveAttribute("href", /^mailto:/);
    await expect(card.getByText("gmail.com")).toHaveCount(0);
  });

  test("the logo on the sign-in page leads back to the landing page", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/#/login");
    await page.getByRole("link", { name: "BrokeCRM home" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "The CRM for teams with no CRM budget." })).toBeVisible();
    await expect(page).toHaveURL(/\/$/);
  });

  test("the landing page leads to the pages a search can land on, and its structured data parses", async ({ page }) => {
    await page.goto("/");
    const blocks = await page.locator('script[type="application/ld+json"]').allTextContents();
    const types = blocks.flatMap((b) => (JSON.parse(b)["@graph"] as { "@type": string }[]).map((n) => n["@type"]));
    expect(types).toEqual(expect.arrayContaining(["SoftwareApplication", "Organization", "FAQPage"]));

    for (const [name, heading] of [
      ["Free CRM for small teams", "A free CRM for small teams"],
      ["Open-source CRM", "An open-source CRM, all the way down"],
      ["CRM for AI agents", "A CRM your AI assistant can work in"],
    ] as const) {
      await page.goto("/");
      await page.getByRole("contentinfo").getByRole("link", { name, exact: true }).click();
      await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /^https:\/\/www\.brokecrm\.cloud\/[a-z-]+$/);
      JSON.parse((await page.locator('script[type="application/ld+json"]').textContent()) ?? "");
    }
  });

  test("the sign-in form links to both", async ({ page }) => {
    await page.goto("/#/login");
    await expect(page.getByRole("link", { name: "terms", exact: true })).toHaveAttribute("href", "/terms.html");
    await expect(page.getByRole("link", { name: "privacy policy" })).toHaveAttribute("href", "/privacy.html");
  });
});
