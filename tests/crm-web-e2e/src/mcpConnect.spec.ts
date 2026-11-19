import type { Page, Route } from "@playwright/test";

import { expect, signIn, test } from "./fixtures";

// The page an MCP client (Claude's connectors) sends a person to. The sign-in
// is real; the OAuth endpoints are answered here, because this suite runs
// before a change reaches the API. tests/identity-worker covers their logic.
const json = (route: Route, data: unknown, status = 200) =>
  route.fulfill({
    status,
    contentType: "application/json",
    headers: { "access-control-allow-origin": "*" },
    body: JSON.stringify(status < 400 ? { data } : { error: data }),
  });

const CALLBACK = "https://mcp-client.example/callback";
const CHALLENGE = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";

async function open(page: Page, orgId: string) {
  const q = new URLSearchParams({
    response_type: "code",
    client_id: "oac_test",
    redirect_uri: CALLBACK,
    code_challenge: CHALLENGE,
    code_challenge_method: "S256",
    state: "xyz",
    scope: "crm",
    resource: `https://api.brokecrm.cloud/v1/organizations/${orgId}/crm/mcp`,
  });
  await page.goto(`/oauth/authorize?${q}`);
}

test("a signed-in person approves an MCP client for their organization", async ({ page, workspace }) => {
  await signIn(page, workspace.owner.email);
  await expect(page.getByRole("link", { name: "Dashboard" })).toBeVisible();
  const session = await page.evaluate(() => JSON.parse(window.localStorage.getItem("openproduct-crm.session")!));

  let approval: Record<string, unknown> | null = null;
  await page.route("**/v1/oauth/clients/oac_test**", (route) => json(route, { client: { id: "oac_test", name: "Claude" } }));
  await page.route("**/v1/oauth/authorize", async (route) => {
    approval = route.request().postDataJSON();
    await json(route, { redirectTo: `${CALLBACK}?code=the-code&state=xyz` });
  });
  await page.route(`${CALLBACK}**`, (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<p>back in the app</p>" }));

  await open(page, session.orgId);
  await expect(page.getByRole("heading", { name: "Allow Claude to use your CRM?" })).toBeVisible();
  await expect(page.getByLabel(session.orgName)).toBeChecked();
  await page.getByRole("button", { name: "Allow" }).click();

  await page.waitForURL(`${CALLBACK}?code=the-code&state=xyz`);
  expect(approval).toMatchObject({
    client_id: "oac_test",
    redirect_uri: CALLBACK,
    code_challenge: CHALLENGE,
    org_id: session.orgId,
    state: "xyz",
  });
});

test("denying sends the client an access_denied error", async ({ page, workspace }) => {
  await signIn(page, workspace.owner.email);
  await expect(page.getByRole("link", { name: "Dashboard" })).toBeVisible();
  const session = await page.evaluate(() => JSON.parse(window.localStorage.getItem("openproduct-crm.session")!));
  await page.route("**/v1/oauth/clients/oac_test**", (route) => json(route, { client: { id: "oac_test", name: "Claude" } }));
  await page.route(`${CALLBACK}**`, (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<p>back</p>" }));

  await open(page, session.orgId);
  await page.getByRole("button", { name: "Deny" }).click();
  await page.waitForURL(/error=access_denied/);
  expect(new URL(page.url()).searchParams.get("state")).toBe("xyz");
});

test("an unregistered app is never redirected to", async ({ page }) => {
  let redirected = false;
  await page.route("**/v1/oauth/clients/oac_test**", (route) => json(route, { code: "not_found", message: "no" }, 404));
  await page.route(`${CALLBACK}**`, (route) => {
    redirected = true;
    return route.fulfill({ status: 200, body: "" });
  });

  await open(page, "org_00000000000000000000000000000001");
  await expect(page.getByRole("alert")).toContainText("not registered");
  expect(redirected).toBe(false);
});

test("someone without a session signs in on the page first", async ({ page }) => {
  await page.route("**/v1/oauth/clients/oac_test**", (route) => json(route, { client: { id: "oac_test", name: "Claude" } }));
  await open(page, "org_00000000000000000000000000000001");
  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(page.getByText("Claude wants to connect to BrokeCRM")).toBeVisible();
});
