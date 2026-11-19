import { expect, signIn, signInWithCode, test } from "./fixtures";

// Replaces upstream's signup.spec ("only the first user can sign up"): an
// instance is no longer one team. Anyone may sign in; what they reach is
// decided by their organization.
test("a returning member lands in their organization without being asked", async ({ page, workspace }) => {
  // The one test that signs in through the form; the others reuse a session.
  await signInWithCode(page, workspace.owner.email);
  await expect(page.getByRole("link", { name: "Dashboard" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Name your organization" })).toBeHidden();
});

test("signing out ends the session", async ({ page, workspace }) => {
  await signIn(page, workspace.owner.email);
  await expect(page.getByRole("link", { name: "Dashboard" })).toBeVisible();

  await page.evaluate(() => window.localStorage.removeItem("openproduct-crm.session"));
  await page.reload();
  // with no session, the site's root is the landing page again, not the app
  await expect(page.getByRole("heading", { level: 1, name: "The CRM for teams with no CRM budget." })).toBeVisible();
  await expect(page.getByRole("link", { name: "Dashboard" })).toHaveCount(0);

  // and a route inside the app asks for a sign-in
  await page.goto("/#/contacts");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
});

test("a member of one organization cannot open another's records", async ({ page, workspace, http }) => {
  const contact = await workspace.createContact({ first_name: "Private", last_name: "Person" });

  // A second, unrelated user with an organization of their own
  const { Workspace } = await import("./fixtures");
  const other = await Workspace.create(http, { first_name: "Eve", last_name: "Other" });
  await other.createContact({ first_name: "Own", last_name: "Contact" });

  await signIn(page, other.owner.email);
  await page.getByRole("link", { name: "Contacts" }).click();
  await expect(page.getByText("Own Contact")).toBeVisible();
  await expect(page.getByText("Private Person")).toBeHidden();

  // Even with the id in hand
  await page.goto(`/#/contacts/${contact.id}/show`);
  await page.waitForLoadState("networkidle");
  await expect(page.getByText("Private Person")).toBeHidden();
});
