// Fixtures for the ported Atomic CRM specs. Upstream reset one shared
// database before each test and seeded it through Supabase's admin client.
// Here every test gets a brand-new user and organization instead, created
// through the public API — tenancy gives each test its own empty CRM, and
// nothing needs an admin key.
import { test as base, expect, request, type APIRequestContext, type Page } from "@playwright/test";

import { API_URL } from "../playwright.config";

type Json = Record<string, any>;

let counter = 0;
const unique = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(counter++).toString(36)}`;

/** Requests to stage cross the internet from a CI runner, and a connection
 *  is sometimes reset mid-flight (ECONNRESET). Writes carry an idempotency
 *  key, so sending the same request again is safe. */
async function fetchWithRetry(
  http: APIRequestContext,
  path: string,
  options: Parameters<APIRequestContext["fetch"]>[1],
) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await http.fetch(path, options);
    } catch (error) {
      const message = String((error as Error)?.message ?? error);
      if (attempt >= 4 || !/ECONNRESET|ETIMEDOUT|ECONNREFUSED|socket hang up|EPIPE/.test(message)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
    }
  }
}

/** Sessions the fixtures signed in through the API, by email. The page reuses
 *  them (see signIn) instead of signing in again: stage allows 10 sign-in
 *  requests a minute from one address, and the suite runs tests in parallel. */
type Org = { id: string; name: string; slug: string };
const sessions = new Map<string, { token: string; expiresAt: string; org?: Org }>();
const orgs = new Map<string, Org>();

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

class Api {
  constructor(
    private readonly http: APIRequestContext,
    private token: string | null = null,
  ) {}

  async call<T = Json>(method: string, path: string, body?: Json): Promise<T> {
    const headers: Record<string, string> = {};
    if (this.token) headers["authorization"] = `Bearer ${this.token}`;
    if (method !== "GET") headers["idempotency-key"] = unique("e2e");
    let response = await fetchWithRetry(this.http, path, { method, headers, data: body });
    // Rate limited (sign-in is capped per address): wait as told and try again.
    for (let attempt = 0; response.status() === 429 && attempt < 20; attempt++) {
      const told = Number((await response.json().catch(() => ({})))?.error?.details?.retryAfterSeconds);
      await sleep(((Number.isFinite(told) && told > 0 ? told : 5) + 1) * 1000);
      response = await fetchWithRetry(this.http, path, { method, headers, data: body });
    }
    const payload = (await response.json().catch(() => ({}))) as Json;
    if (!response.ok()) {
      throw new Error(`${method} ${path} → ${response.status()} ${JSON.stringify(payload).slice(0, 300)}`);
    }
    return (payload["data"] ?? payload) as T;
  }

  async status(method: string, path: string): Promise<number> {
    const headers: Record<string, string> = {};
    if (this.token) headers["authorization"] = `Bearer ${this.token}`;
    const response = await fetchWithRetry(this.http, path, { method, headers });
    return response.status();
  }

  /** Signs in the way a person does; the API returns the code where
   *  identity runs with debug delivery. */
  static async signIn(http: APIRequestContext, email: string): Promise<Api> {
    const anonymous = new Api(http);
    const challenge = await anonymous.call("POST", "/v1/auth/login/start", { email });
    const code = challenge["delivery"]?.code;
    if (!code) throw new Error("This API does not return sign-in codes; the e2e suite needs one that does (stage).");
    const session = await anonymous.call("POST", "/v1/auth/login/complete", {
      challengeId: challenge["challengeId"],
      code,
    });
    sessions.set(email, { token: session["token"], expiresAt: session["expiresAt"] });
    return new Api(http, session["token"]);
  }

  /** A second session for the same account, as a provider sign-in would yield. */
  static async newSession(http: APIRequestContext, email: string): Promise<{ token: string; expiresAt: string }> {
    const anonymous = new Api(http);
    const challenge = await anonymous.call("POST", "/v1/auth/login/start", { email });
    const session = await anonymous.call("POST", "/v1/auth/login/complete", {
      challengeId: challenge["challengeId"],
      code: challenge["delivery"]?.code,
    });
    return { token: session["token"], expiresAt: session["expiresAt"] };
  }
}

export type Sales = { id: number; email: string; first_name: string; last_name: string };

/** A fresh organization with its owner, plus helpers to seed it. */
export class Workspace {
  constructor(
    private readonly http: APIRequestContext,
    private readonly api: Api,
    readonly orgId: string,
    readonly owner: Sales,
  ) {}

  private get crm() {
    return `/v1/organizations/${this.orgId}/crm`;
  }

  static async create(http: APIRequestContext, owner: { first_name: string; last_name: string }) {
    const email = `${unique("e2e")}@example.com`;
    const api = await Api.signIn(http, email);
    const slug = unique("e2e");
    const { organization } = await api.call("POST", "/v1/organizations", { name: `E2E ${slug}`, slug });
    orgs.set(organization.id, organization);
    const session = sessions.get(email);
    if (session) session.org = organization;
    const me = await api.call("GET", `/v1/organizations/${organization.id}/crm/sales/me`);
    const profile = await api.call("PATCH", `/v1/organizations/${organization.id}/crm/sales/${me["id"]}`, owner);
    return new Workspace(http, api, organization.id, profile as Sales);
  }

  /** A second member: invited, joined, with a CRM profile. */
  async addTeammate(teammate: { first_name: string; last_name: string }): Promise<Sales> {
    const email = `${unique("e2e-mate")}@example.com`;
    const invitation = await this.api.call("POST", `/v1/organizations/${this.orgId}/invitations`, {
      email,
      role: "builder",
    });
    const mate = await Api.signIn(this.http, email);
    await mate.call("POST", `/v1/organizations/${this.orgId}/invitations/accept`, {
      token: invitation["delivery"]?.token,
    });
    const session = sessions.get(email);
    const org = orgs.get(this.orgId);
    if (session && org) session.org = org;
    const me = await mate.call("GET", `${this.crm}/sales/me`);
    return (await mate.call("PATCH", `${this.crm}/sales/${me["id"]}`, teammate)) as Sales;
  }

  /** Stores the organization's CRM configuration, as the settings page does. */
  async setConfiguration(config: Json) {
    await this.api.call("POST", `/v1/organizations/${this.orgId}/config/settings`, {
      key: "crm.configuration",
      value: config,
    });
  }

  async createDeal(deal: {
    name: string;
    stage: string;
    company_id?: number;
    index?: number;
    amount?: number;
    contact_ids?: number[] | null;
  }) {
    return this.api.call<{ id: number }>("POST", `${this.crm}/deals`, {
      sales_id: this.owner.id,
      contact_ids: [],
      ...deal,
    });
  }

  /** A fresh session token for the owner (see Api.newSession). */
  ownerSession() {
    return Api.newSession(this.http, this.owner.email);
  }

  async createCompany({ name, salesId }: { name: string; salesId?: number }) {
    return this.api.call<{ id: number }>("POST", `${this.crm}/companies`, {
      name,
      sales_id: salesId ?? this.owner.id,
    });
  }

  async createNotes({
    contactId,
    salesId,
    notes,
  }: {
    contactId: number;
    salesId?: number;
    notes: { text: string; date?: string; status?: "cold" | "warm" | "hot" }[];
  }) {
    for (const { text, date, status = "cold" } of notes) {
      await this.api.call("POST", `${this.crm}/contact_notes`, {
        contact_id: contactId,
        sales_id: salesId ?? this.owner.id,
        text,
        status,
        ...(date ? { date } : {}),
      });
    }
  }

  async listNotes(contactId: number) {
    const filter = encodeURIComponent(JSON.stringify({ contact_id: contactId }));
    const { items } = await this.api.call<{ items: { id: number; attachments: Json[] }[] }>(
      "GET",
      `${this.crm}/contact_notes?filter=${filter}`,
    );
    return items;
  }

  async deleteNote(noteId: number) {
    await this.api.call("DELETE", `${this.crm}/contact_notes/${noteId}`);
  }

  /** The status this member gets for a stored file, in their own
   *  organization or, with `orgId`, in another's. */
  async fileStatus(path: string, orgId = this.orgId): Promise<number> {
    const encoded = path.split("/").map(encodeURIComponent).join("/");
    return this.api.status("GET", `/v1/organizations/${orgId}/crm/attachments/${encoded}`);
  }

  async createContact({
    first_name,
    last_name,
    title = "",
    company_id = null,
    sales_id,
    notes = [],
  }: {
    first_name: string;
    last_name: string;
    title?: string;
    company_id?: number | null;
    sales_id?: number;
    notes?: { text: string; date?: string; status?: "cold" | "warm" | "hot" }[];
  }) {
    const now = new Date().toISOString();
    const contact = await this.api.call<{ id: number }>("POST", `${this.crm}/contacts`, {
      first_name,
      last_name,
      title,
      company_id,
      sales_id: sales_id ?? this.owner.id,
      first_seen: now,
      last_seen: now,
      has_newsletter: false,
      tags: [],
      gender: "unknown",
      status: "cold",
      background: "",
      email_jsonb: [],
      phone_jsonb: [],
    });
    await this.createNotes({ contactId: contact.id, salesId: sales_id ?? this.owner.id, notes });
    return contact;
  }
}

/** Opens the app as this person. With a session and organization from the
 *  fixtures, the page starts signed in, in that organization; otherwise it
 *  signs in through the form (signInWithCode). */
export async function signIn(page: Page, email: string) {
  const session = sessions.get(email);
  if (!session?.org) return signInWithCode(page, email);
  const { org, ...stored } = session;
  await page.goto("/");
  await page.evaluate(
    (value) => window.localStorage.setItem("openproduct-crm.session", value),
    JSON.stringify({ ...stored, email, orgId: org.id, orgSlug: org.slug, orgName: org.name }),
  );
  // With a stored session the root is the app, opened in that organization.
  await page.reload();
  await expect(page.getByRole("link", { name: "Dashboard" })).toBeVisible({ timeout: 60_000 });
}

/** The adapted login: email, then the code (prefilled where the API returns
 *  it), then straight into the user's only organization. */
export async function signInWithCode(page: Page, email: string) {
  // "/" is the landing page for a signed-out visitor; this is the sign-in form
  await page.goto("/#/login");
  await submitSignInForm(page, email);
}

/** Fills the sign-in form and gets past it. Stage caps sign-in requests per
 *  address, and tests run in parallel: when the form reports the limit, wait
 *  the time it gives and press the button again. */
export async function submitSignInForm(page: Page, email: string) {
  await page.getByLabel("Email").fill(email);
  await pressPastRateLimit(page, "Send code", async () => {
    await page.getByLabel("Sign-in code").waitFor({ timeout: 20_000 });
  });
  await expect(page.getByLabel("Sign-in code")).not.toHaveValue("");
  await pressPastRateLimit(page, "Sign in", async () => {
    await page.getByLabel("Sign-in code").waitFor({ state: "hidden", timeout: 20_000 });
  });
}

async function pressPastRateLimit(page: Page, button: string, passed: () => Promise<void>) {
  const notices = page.getByText(/Rate limit exceeded/);
  for (let attempt = 0; attempt < 12; attempt++) {
    const before = await notices.count();
    await page.getByRole("button", { name: button }).click();
    const outcome = await Promise.race([
      passed().then(() => "passed" as const),
      notices.nth(before).waitFor({ timeout: 20_000 }).then(() => "limited" as const),
    ]).catch(() => "unknown" as const);
    if (outcome !== "limited") return;
    const text = (await notices.nth(before).textContent()) ?? "";
    await page.waitForTimeout((Number(text.match(/Retry after (\d+)/)?.[1] ?? 5) + 1) * 1000);
  }
}

// Both the desktop header and the mobile bottom bar expose navigation as links.
const getMenuMethod = ({ page }: { page: Page }) => ({
  goToDashboard: async () => {
    await page.getByRole("link", { name: "Dashboard" }).click();
    await page.waitForLoadState("networkidle");
  },
  goToContacts: async () => {
    await page.getByRole("link", { name: "Contacts" }).click();
    await page.waitForLoadState("networkidle");
  },
});

const dismissToast = async (page: Page, content: string) => {
  await expect(page.getByText(content)).toBeVisible();
  await page.getByLabel("Close toast").first().click();
  // The UI is optimistic: dismissing the toast triggers the request it stands for
  await page.waitForLoadState("networkidle");
};

export const test = base.extend<{
  http: APIRequestContext;
  /** A new organization owned by John Doe, signed in nowhere yet. */
  workspace: Workspace;
  menu: ReturnType<typeof getMenuMethod>;
  dismissToast: (content: string) => Promise<void>;
}>({
  // eslint-disable-next-line no-empty-pattern
  http: async ({}, use, testInfo) => {
    const proxy = testInfo.project.use.proxy;
    const http = await request.newContext({ baseURL: API_URL, ...(proxy ? { proxy } : {}) });
    await use(http);
    await http.dispose();
  },
  workspace: async ({ http }, use) => {
    await use(await Workspace.create(http, { first_name: "John", last_name: "Doe" }));
  },
  menu: async ({ page }, use) => {
    await use(getMenuMethod({ page }));
  },
  dismissToast: async ({ page }, use) => {
    await use((content: string) => dismissToast(page, content));
  },
});

export { expect };
