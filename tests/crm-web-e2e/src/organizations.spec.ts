import type { Page, Route } from "@playwright/test";

import { expect, signIn, test } from "./fixtures";

// The sign-in is real. The organization list and the invitee's invitations are
// answered here: this suite runs before a change reaches the API it talks to,
// and a second organization is a paid-plan feature there. The API's side has
// its own tests in tests/membership-worker.
const json = (route: Route, data: unknown) =>
  route.fulfill({
    status: 200,
    contentType: "application/json",
    headers: { "access-control-allow-origin": "*" },
    body: JSON.stringify({ data, meta: { requestId: "req_e2e", cursor: null } }),
  });

const session = (page: Page) =>
  page.evaluate(() => JSON.parse(window.localStorage.getItem("openproduct-crm.session")!));

const other = { id: "org_00000000000000000000000000000001", name: "Second Org", slug: "second-org" };

test("the header switches to another organization", async ({ page, workspace }) => {
  await signIn(page, workspace.owner.email);
  await expect(page.getByRole("link", { name: "Dashboard" })).toBeVisible();
  const current = await session(page);

  await page.route("**/v1/organizations", (route) =>
    route.request().method() === "GET"
      ? json(route, {
          organizations: [{ id: current.orgId, name: current.orgName, slug: current.orgSlug }, other],
        })
      : route.fallback(),
  );
  await page.route("**/v1/invitations", (route) => json(route, { invitations: [] }));
  await page.reload();

  await page.getByRole("button", { name: `Organization: ${current.orgName}` }).click();
  await page.getByRole("menuitem", { name: "Second Org" }).click();

  await expect
    .poll(async () => (await session(page)).orgId, { timeout: 30_000 })
    .toBe(other.id);
  expect((await session(page)).orgName).toBe("Second Org");
});

test("an invited person is offered the invitation after signing in", async ({ page, workspace }) => {
  let accepted = false;
  const invitation = {
    id: "inv_00000000000000000000000000000001",
    role: "builder",
    expiresAt: "2030-01-01T00:00:00.000Z",
    organization: other,
  };
  await page.route("**/v1/invitations", (route) => json(route, { invitations: [invitation] }));
  await page.route(`**/v1/invitations/${invitation.id}/accept`, (route) => {
    accepted = true;
    return json(route, { membership: { role: "builder" } });
  });

  await signIn(page, workspace.owner.email);

  await expect(page.getByRole("heading", { name: "You have been invited" })).toBeVisible();
  await page.getByRole("button", { name: "Join Second Org" }).click();

  await expect.poll(() => accepted).toBe(true);
  await expect.poll(async () => (await session(page)).orgId).toBe(other.id);
});
