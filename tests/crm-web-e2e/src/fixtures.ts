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

class Api {
  constructor(
    private readonly http: APIRequestContext,
    private token: string | null = null,
  ) {}

  async call<T = Json>(method: string, path: string, body?: Json): Promise<T> {
    const headers: Record<string, string> = {};
    if (this.token) headers["authorization"] = `Bearer ${this.token}`;
    if (method !== "GET") headers["idempotency-key"] = unique("e2e");
    const response = await this.http.fetch(path, { method, headers, data: body });
    const payload = (await response.json().catch(() => ({}))) as Json;
    if (!response.ok()) {
      throw new Error(`${method} ${path} → ${response.status()} ${JSON.stringify(payload).slice(0, 300)}`);
    }
    return (payload["data"] ?? payload) as T;
  }

  async status(method: string, path: string): Promise<number> {
    const headers: Record<string, string> = {};
    if (this.token) headers["authorization"] = `Bearer ${this.token}`;
    const response = await this.http.fetch(path, { method, headers });
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
    return new Api(http, session["token"]);
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
    const me = await mate.call("GET", `${this.crm}/sales/me`);
    return (await mate.call("PATCH", `${this.crm}/sales/${me["id"]}`, teammate)) as Sales;
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

/** The adapted login: email, then the code (prefilled where the API returns
 *  it), then straight into the user's only organization. */
export async function signIn(page: Page, email: string) {
  await page.goto("/");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Send code" }).click();
  await expect(page.getByLabel("Sign-in code")).not.toHaveValue("");
  await page.getByRole("button", { name: "Sign in" }).click();
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
