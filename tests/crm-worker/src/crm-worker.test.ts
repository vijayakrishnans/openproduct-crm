import { createHarness, orgPublicId, type Harness, type Member } from "./harness";

const ORG = "11111111-1111-4111-8111-111111111111";
const BASE = `/v1/organizations/${orgPublicId(ORG)}/crm`;

const owner: Member = { subjectId: "usr_owner", email: "olivia@acme.test", roles: { [ORG]: "owner" } };
const builder: Member = { subjectId: "usr_builder", email: "ben@acme.test", roles: { [ORG]: "builder" } };
const viewer: Member = { subjectId: "usr_viewer", email: "vera@acme.test", roles: { [ORG]: "viewer" } };
const billing: Member = { subjectId: "usr_billing", email: "bill@acme.test", roles: { [ORG]: "billing_admin" } };

function filter(value: Record<string, unknown>): string {
  return `filter=${encodeURIComponent(JSON.stringify(value))}`;
}

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

describe("crm-worker SQL", () => {
  const src = resolve(dirname(fileURLToPath(import.meta.url)), "../../../apps/crm-worker/src");

  it.each(["handlers.ts", "query.ts", "db.ts"])("binds every parameter of %s as text", (file) => {
    const code = readFileSync(resolve(src, file), "utf-8")
      .replace(/^\s*\/\/.*$/gm, "")
      // bind() mints the placeholder; its callers add the cast.
      .replace("return `$${params.length}`;", "");
    const placeholders = code.match(/(\$\d+|\$\$\{[^}]+\}|\$\{p\})(::\w+)?/g) ?? [];
    expect(placeholders.length).toBeGreaterThan(0);
    for (const placeholder of placeholders) {
      expect(placeholder).toMatch(/::text$/);
    }
  });
});

describe("crm-worker", () => {
  let h: Harness;
  const ids: Record<string, number> = {};

  beforeAll(async () => {
    h = await createHarness([owner, builder, viewer, billing]);
  }, 120_000);

  afterAll(async () => {
    await h.close();
  });

  it("answers /health without an actor", async () => {
    const res = await h.call(null, "GET", "/health");
    expect(res.status).toBe(200);
    expect(res.body.data.service).toBe("crm-worker");
  });

  it("requires an actor on every CRM route", async () => {
    const res = await h.call(null, "GET", `${BASE}/contacts`);
    expect(res.status).toBe(401);
  });

  describe("sales profile", () => {
    it("creates the caller's profile on first use and mirrors the admin role", async () => {
      const me = await h.call(owner, "GET", `${BASE}/sales/me`);
      expect(me.status).toBe(200);
      expect(me.body.data).toMatchObject({
        subject_id: "usr_owner",
        email: "olivia@acme.test",
        first_name: "olivia",
        administrator: true,
        disabled: false,
      });
      expect(me.body.data.org_id).toBeUndefined();
      ids["ownerSales"] = me.body.data.id;

      const again = await h.call(owner, "GET", `${BASE}/sales/me`);
      expect(again.body.data.id).toBe(ids["ownerSales"]);

      const other = await h.call(builder, "GET", `${BASE}/sales/me`);
      expect(other.body.data.administrator).toBe(false);
      ids["builderSales"] = other.body.data.id;
    });

    it("lets a member edit their own profile but not someone else's", async () => {
      const own = await h.call(builder, "PATCH", `${BASE}/sales/${ids["builderSales"]}`, {
        first_name: "Ben",
        last_name: "Builder",
        email: "ignored@acme.test",
      });
      expect(own.status).toBe(200);
      expect(own.body.data).toMatchObject({ first_name: "Ben", last_name: "Builder", email: "ben@acme.test" });

      const others = await h.call(builder, "PATCH", `${BASE}/sales/${ids["ownerSales"]}`, { first_name: "x" });
      expect(others.status).toBe(403);
      const disable = await h.call(builder, "PATCH", `${BASE}/sales/${ids["builderSales"]}`, { disabled: true });
      expect(disable.status).toBe(403);

      const admin = await h.call(owner, "PATCH", `${BASE}/sales/${ids["builderSales"]}`, { disabled: true });
      expect(admin.status).toBe(200);
      expect(admin.body.data.disabled).toBe(true);
    });

    it("does not let a client create or delete profiles", async () => {
      expect((await h.call(owner, "POST", `${BASE}/sales`, { email: "x@y.test" })).status).toBe(405);
      expect((await h.call(owner, "DELETE", `${BASE}/sales/${ids["builderSales"]}`)).status).toBe(405);
    });
  });

  describe("create, read, update, delete", () => {
    it("creates a company owned by the caller", async () => {
      const res = await h.call(owner, "POST", `${BASE}/companies`, {
        name: "Acme Hélène",
        sector: "Retail",
        size: 50,
        website: "https://acme.test",
        context_links: ["https://acme.test/about"],
        nb_contacts: 99,
        org_id: "22222222-2222-4222-8222-222222222222",
      });
      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({
        name: "Acme Hélène",
        size: 50,
        sales_id: ids["ownerSales"],
        context_links: ["https://acme.test/about"],
      });
      expect(res.body.data.fts).toBeUndefined();
      expect(res.body.data.org_id).toBeUndefined();
      ids["company"] = res.body.data.id;
    });

    it("rejects a create without its required fields", async () => {
      const res = await h.call(owner, "POST", `${BASE}/companies`, { sector: "Retail" });
      expect(res.status).toBe(422);
      expect(res.body.error.details.fields).toEqual({ name: ["is required"] });
      const deal = await h.call(owner, "POST", `${BASE}/deals`, { name: "x" });
      expect(deal.body.error.details.fields).toEqual({ stage: ["is required"] });
    });

    it("rejects a body that is not a JSON object", async () => {
      const res = await h.call(owner, "POST", `${BASE}/companies`, [1, 2]);
      expect(res.status).toBe(422);
    });

    it("creates tags, contacts with arrays and JSON, and lowercases emails", async () => {
      const tag = await h.call(owner, "POST", `${BASE}/tags`, { name: "vip", color: "#f00" });
      expect(tag.status).toBe(201);
      ids["tag"] = tag.body.data.id;

      const thomas = await h.call(builder, "POST", `${BASE}/contacts`, {
        first_name: "Thomas",
        last_name: "Dupont",
        company_id: ids["company"],
        tags: [ids["tag"]],
        email_jsonb: [{ email: "TD@Acme.test", type: "Work" }],
        phone_jsonb: [{ number: "555-0100", type: "Work" }],
        first_seen: "2026-01-02T03:04:05.000Z",
        last_seen: "2026-01-02T03:04:05.000Z",
        has_newsletter: true,
      });
      expect(thomas.status).toBe(201);
      expect(thomas.body.data).toMatchObject({
        tags: [ids["tag"]],
        email_jsonb: [{ email: "td@acme.test", type: "Work" }],
        has_newsletter: true,
        sales_id: ids["builderSales"],
      });
      ids["thomas"] = thomas.body.data.id;

      const tom = await h.call(owner, "POST", `${BASE}/contacts`, {
        first_name: "Tom",
        last_name: "Dupond",
        email_jsonb: [{ email: "tom@elsewhere.test" }],
        last_seen: "2026-02-02T00:00:00.000Z",
      });
      ids["tom"] = tom.body.data.id;
      const zoe = await h.call(owner, "POST", `${BASE}/contacts`, { first_name: "Zoé", last_name: "Martin" });
      ids["zoe"] = zoe.body.data.id;
    });

    it("refuses references to records that do not exist", async () => {
      const company = await h.call(owner, "POST", `${BASE}/contacts`, { first_name: "x", company_id: 999999 });
      expect(company.status).toBe(422);
      const tag = await h.call(owner, "POST", `${BASE}/contacts`, { first_name: "x", tags: [999999] });
      expect(tag.status).toBe(422);
      const leftovers = await h.call(owner, "GET", `${BASE}/contacts?${filter({ first_name: "x" })}`);
      expect(leftovers.body.data.total).toBe(0);
    });

    it("refuses malformed values", async () => {
      const res = await h.call(owner, "POST", `${BASE}/deals`, {
        name: "Bad date",
        stage: "lead",
        expected_closing_date: "20261-01-01",
      });
      expect(res.status).toBe(422);
      const type = await h.call(owner, "POST", `${BASE}/companies`, { name: "x", size: "many" });
      expect(type.status).toBe(422);
    });

    it("reads one record and answers 404 for an unknown or malformed id", async () => {
      const one = await h.call(viewer, "GET", `${BASE}/contacts/${ids["thomas"]}`);
      expect(one.status).toBe(200);
      expect(one.body.data.first_name).toBe("Thomas");
      expect((await h.call(viewer, "GET", `${BASE}/contacts/999999`)).status).toBe(404);
      expect((await h.call(viewer, "GET", `${BASE}/contacts/abc`)).status).toBe(404);
      expect((await h.call(viewer, "GET", `${BASE}/contacts/1;drop`)).status).toBe(404);
      expect((await h.call(viewer, "GET", `${BASE}/nothing`)).status).toBe(404);
    });

    it("updates only the fields it is given, and stamps deals", async () => {
      const deal = await h.call(owner, "POST", `${BASE}/deals`, {
        name: "Big deal",
        stage: "opportunity",
        company_id: ids["company"],
        contact_ids: [ids["thomas"], ids["tom"]],
        categories: ["software", "services"],
        amount: 120000,
        index: 1,
        expected_closing_date: "2027-01-31",
      });
      expect(deal.status).toBe(201);
      ids["deal"] = deal.body.data.id;

      const updated = await h.call(builder, "PATCH", `${BASE}/deals/${ids["deal"]}`, { stage: "won", id: 5 });
      expect(updated.status).toBe(200);
      expect(updated.body.data).toMatchObject({ id: ids["deal"], stage: "won", name: "Big deal", amount: 120000 });
      expect(new Date(updated.body.data.updated_at).getTime()).toBeGreaterThanOrEqual(
        new Date(deal.body.data.updated_at).getTime(),
      );

      const cleared = await h.call(builder, "PUT", `${BASE}/deals/${ids["deal"]}`, { description: null, name: "" });
      expect(cleared.status).toBe(422);
      expect((await h.call(builder, "PATCH", `${BASE}/deals/999999`, { stage: "won" })).status).toBe(404);
    });

    it("keeps notes and tasks with their parents, and touches last_seen", async () => {
      const note = await h.call(owner, "POST", `${BASE}/contact_notes`, {
        contact_id: ids["thomas"],
        text: "Called about the renewal",
        date: "2026-06-01T10:00:00.000Z",
        attachments: [{ title: "quote.pdf", path: "x/quote.pdf" }],
      });
      expect(note.status).toBe(201);
      expect(note.body.data.attachments).toEqual([{ title: "quote.pdf", path: "x/quote.pdf" }]);
      ids["note"] = note.body.data.id;

      const contact = await h.call(owner, "GET", `${BASE}/contacts/${ids["thomas"]}`);
      expect(new Date(contact.body.data.last_seen).toISOString()).toBe("2026-06-01T10:00:00.000Z");

      const dealNote = await h.call(owner, "POST", `${BASE}/deal_notes`, { deal_id: ids["deal"], text: "Sent the quote" });
      expect(dealNote.status).toBe(201);
      const task = await h.call(owner, "POST", `${BASE}/tasks`, {
        contact_id: ids["thomas"],
        text: "Follow up",
        type: "call",
        due_date: "2020-01-01T00:00:00.000Z",
      });
      expect(task.status).toBe(201);
      ids["task"] = task.body.data.id;
      const orphan = await h.call(owner, "POST", `${BASE}/tasks`, { text: "no contact" });
      expect(orphan.status).toBe(422);
    });
  });

  describe("lists", () => {
    it("paginates and reports the total", async () => {
      const page1 = await h.call(viewer, "GET", `${BASE}/contacts?sort=last_name&order=ASC&page=1&perPage=2`);
      expect(page1.status).toBe(200);
      expect(page1.body.data).toMatchObject({ total: 3, page: 1, perPage: 2 });
      expect(page1.body.data.items.map((c: any) => c.last_name)).toEqual(["Dupond", "Dupont"]);
      const page2 = await h.call(viewer, "GET", `${BASE}/contacts?sort=last_name&order=ASC&page=2&perPage=2`);
      expect(page2.body.data.items.map((c: any) => c.last_name)).toEqual(["Martin"]);
    });

    it("sorts either way with nulls last", async () => {
      const desc = await h.call(viewer, "GET", `${BASE}/contacts?sort=last_seen&order=DESC`);
      expect(desc.body.data.items.map((c: any) => c.first_name)).toEqual(["Thomas", "Tom", "Zoé"]);
      const asc = await h.call(viewer, "GET", `${BASE}/contacts?sort=last_seen&order=ASC`);
      expect(asc.body.data.items.map((c: any) => c.first_name)).toEqual(["Tom", "Thomas", "Zoé"]);
    });

    it.each([
      [{ last_name: "Dupont" }, ["Thomas"]],
      [{ "last_name@neq": "Dupont" }, ["Tom", "Zoé"]],
      [{ "last_name@ilike": "dup%" }, ["Thomas", "Tom"]],
      [{ "last_name@like": "dup%" }, []],
      [{ "company_id@is": null }, ["Tom", "Zoé"]],
      [{ "company_id@isnot": null }, ["Thomas"]],
      [{ company_id: null }, ["Tom", "Zoé"]],
      [{ has_newsletter: true }, ["Thomas"]],
      [{ "last_seen@gte": "2026-03-01T00:00:00Z" }, ["Thomas"]],
      [{ "last_seen@lt": "2026-03-01T00:00:00Z" }, ["Tom"]],
      [{ q: "tho dup" }, ["Thomas"]],
      [{ q: "zoe" }, ["Zoé"]],
      [{ q: "acme" }, ["Thomas"]],
      [{ q: "   " }, ["Thomas", "Tom", "Zoé"]],
      [{ "last_name@ilike": "dup%", "company_id@is": null }, ["Tom"]],
    ])("filters contacts by %j", async (f, expected) => {
      const res = await h.call(viewer, "GET", `${BASE}/contacts?sort=first_name&order=ASC&${filter(f)}`);
      expect(res.status).toBe(200);
      expect(res.body.data.items.map((c: any) => c.first_name)).toEqual(expected);
      expect(res.body.data.total).toBe(expected.length);
    });

    it("filters by id lists and array containment", async () => {
      const byIds = await h.call(viewer, "GET", `${BASE}/contacts?${filter({ "id@in": [ids["tom"], ids["zoe"]] })}`);
      expect(byIds.body.data.total).toBe(2);
      const implicit = await h.call(viewer, "GET", `${BASE}/contacts?${filter({ id: [ids["tom"]] })}`);
      expect(implicit.body.data.total).toBe(1);
      const tagged = await h.call(viewer, "GET", `${BASE}/contacts?${filter({ "tags@cs": [ids["tag"]] })}`);
      expect(tagged.body.data.items.map((c: any) => c.first_name)).toEqual(["Thomas"]);
      const deals = await h.call(viewer, "GET", `${BASE}/deals?${filter({ "contact_ids@cs": [ids["tom"]] })}`);
      expect(deals.body.data.total).toBe(1);
      const none = await h.call(viewer, "GET", `${BASE}/contacts?${filter({ "id@in": [] })}`);
      expect(none.body.data.total).toBe(0);
    });

    it.each([
      ["sort=password", "sort"],
      ["sort=email_jsonb", "sort"],
      ["order=sideways", "order"],
      ["page=0", "page"],
      ["perPage=5000", "perPage"],
      ["filter=nope", "filter"],
      [filter({ password: "x" }), "filter.password"],
      [filter({ "last_name@regex": "x" }), "filter.last_name@regex"],
      [filter({ "email_jsonb@ilike": "x" }), "filter.email_jsonb@ilike"],
      [filter({ "last_name@cs": ["x"] }), "filter.last_name@cs"],
      [filter({ "id@in": "1" }), "filter.id@in"],
      [filter({ last_name: { $ne: 1 } }), "filter.last_name"],
      [filter({ 'id" OR 1=1 --': 1 }), 'filter.id" OR 1=1 --'],
    ])("rejects the list query %s", async (query, field) => {
      const res = await h.call(viewer, "GET", `${BASE}/contacts?${query}`);
      expect(res.status).toBe(422);
      expect(Object.keys(res.body.error.details.fields)).toEqual([field]);
    });

    it("answers 422, not 500, for a value of the wrong type", async () => {
      const res = await h.call(viewer, "GET", `${BASE}/contacts?${filter({ company_id: "abc" })}`);
      expect(res.status).toBe(422);
    });

    it("treats hostile filter values as data", async () => {
      const res = await h.call(viewer, "GET", `${BASE}/contacts?${filter({ last_name: "x'; DROP TABLE crm.contacts; --" })}`);
      expect(res.status).toBe(200);
      expect(res.body.data.total).toBe(0);
      const still = await h.call(viewer, "GET", `${BASE}/contacts`);
      expect(still.body.data.total).toBe(3);
    });

    it("serves the summary views with their computed columns", async () => {
      const contacts = await h.call(viewer, "GET", `${BASE}/contacts_summary?${filter({ q: "dupont" })}`);
      expect(contacts.body.data.items[0]).toMatchObject({
        first_name: "Thomas",
        company_name: "Acme Hélène",
        nb_tasks: 1,
      });
      const companies = await h.call(viewer, "GET", `${BASE}/companies_summary`);
      expect(companies.body.data.items[0]).toMatchObject({ name: "Acme Hélène", nb_deals: 1, nb_contacts: 1 });
      const one = await h.call(viewer, "GET", `${BASE}/companies_summary/${ids["company"]}`);
      expect(one.body.data.nb_contacts).toBe(1);
      expect((await h.call(owner, "POST", `${BASE}/companies_summary`, { name: "x" })).status).toBe(405);
      expect((await h.call(owner, "DELETE", `${BASE}/contacts_summary/${ids["tom"]}`)).status).toBe(405);
    });
  });

  describe("search, activity and dashboard", () => {
    it("searches across resources, unaccented, by prefix", async () => {
      const res = await h.call(viewer, "GET", `${BASE}/search?q=hel`);
      expect(res.status).toBe(200);
      expect(res.body.data.items.map((r: any) => [r.resource, r.title])).toEqual([["companies", "Acme Hélène"]]);

      const quote = await h.call(viewer, "GET", `${BASE}/search?q=quote`);
      expect(quote.body.data.items.map((r: any) => r.resource).sort()).toEqual(["contact_notes", "deal_notes"]);

      const narrowed = await h.call(viewer, "GET", `${BASE}/search?q=quote&resources=deal_notes&limit=5`);
      expect(narrowed.body.data.items.map((r: any) => r.resource)).toEqual(["deal_notes"]);

      expect((await h.call(viewer, "GET", `${BASE}/search?q=`)).body.data.items).toEqual([]);
      expect((await h.call(viewer, "GET", `${BASE}/search?q=x&resources=secrets`)).status).toBe(422);
      expect((await h.call(viewer, "GET", `${BASE}/search?q=x&limit=1000`)).status).toBe(422);
    });

    it("lists the activity log, newest first, filterable by company", async () => {
      const res = await h.call(viewer, "GET", `${BASE}/activity_log?perPage=50`);
      expect(res.status).toBe(200);
      expect(res.body.data.total).toBe(7);
      const types = res.body.data.items.map((a: any) => a.type);
      expect(types).toEqual(expect.arrayContaining([
        "company.created",
        "contact.created",
        "contactNote.created",
        "deal.created",
        "dealNote.created",
      ]));
      expect(res.body.data.items[0].company?.fts).toBeUndefined();

      const forCompany = await h.call(viewer, "GET", `${BASE}/activity_log?${filter({ company_id: ids["company"] })}`);
      expect(forCompany.body.data.total).toBe(5);
      expect((await h.call(viewer, "GET", `${BASE}/activity_log/1`)).status).toBe(404);
    });

    it("summarizes the org for the dashboard", async () => {
      const res = await h.call(viewer, "GET", `${BASE}/dashboard`);
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({
        companies: 1,
        contacts: 3,
        deals: { open: 1, amount: 120000, byStage: [{ stage: "won", count: 1, amount: 120000 }] },
        tasks: { open: 1, overdue: 1 },
        notes: 2,
      });
    });
  });

  describe("roles", () => {
    it("lets a viewer read and nothing else", async () => {
      expect((await h.call(viewer, "GET", `${BASE}/deals`)).status).toBe(200);
      expect((await h.call(viewer, "POST", `${BASE}/tags`, { name: "x", color: "y" })).status).toBe(403);
      expect((await h.call(viewer, "PATCH", `${BASE}/contacts/${ids["tom"]}`, { title: "x" })).status).toBe(403);
      expect((await h.call(viewer, "DELETE", `${BASE}/contacts/${ids["tom"]}`)).status).toBe(403);
      expect((await h.call(viewer, "POST", `${BASE}/contacts/merge`, { loserId: 1, winnerId: 2 })).status).toBe(403);
    });

    it("gives a member without a CRM permission a 403, not a 404", async () => {
      expect((await h.call(billing, "GET", `${BASE}/deals`)).status).toBe(403);
    });

    it("answers 405 for methods a route does not have", async () => {
      expect((await h.call(owner, "DELETE", `${BASE}/contacts`)).status).toBe(405);
      expect((await h.call(owner, "POST", `${BASE}/search`)).status).toBe(405);
      expect((await h.call(owner, "POST", `${BASE}/contacts/${ids["tom"]}`)).status).toBe(405);
    });
  });

  describe("merge and delete", () => {
    it("validates a merge request", async () => {
      const same = await h.call(owner, "POST", `${BASE}/contacts/merge`, { loserId: ids["tom"], winnerId: ids["tom"] });
      expect(same.status).toBe(422);
      const missing = await h.call(owner, "POST", `${BASE}/contacts/merge`, { loserId: "x" });
      expect(missing.status).toBe(422);
      const unknown = await h.call(owner, "POST", `${BASE}/contacts/merge`, { loserId: 999999, winnerId: ids["tom"] });
      expect(unknown.status).toBe(404);
    });

    it("merges two contacts in one transaction", async () => {
      const res = await h.call(builder, "POST", `${BASE}/contacts/merge`, {
        loserId: ids["tom"],
        winnerId: ids["thomas"],
      });
      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(ids["thomas"]);
      expect(res.body.data.email_jsonb.map((e: any) => e.email).sort()).toEqual(["td@acme.test", "tom@elsewhere.test"]);

      expect((await h.call(owner, "GET", `${BASE}/contacts/${ids["tom"]}`)).status).toBe(404);
      const deal = await h.call(owner, "GET", `${BASE}/deals/${ids["deal"]}`);
      expect(deal.body.data.contact_ids).toEqual([ids["thomas"]]);
    });

    it("deletes a record and what hangs off it, and returns what it removed", async () => {
      const tag = await h.call(owner, "DELETE", `${BASE}/tags/${ids["tag"]}`);
      expect(tag.status).toBe(200);
      expect(tag.body.data.name).toBe("vip");
      const contact = await h.call(owner, "GET", `${BASE}/contacts/${ids["thomas"]}`);
      expect(contact.body.data.tags).toEqual([]);

      const removed = await h.call(owner, "DELETE", `${BASE}/contacts/${ids["thomas"]}`);
      expect(removed.status).toBe(200);
      expect((await h.call(owner, "GET", `${BASE}/contact_notes/${ids["note"]}`)).status).toBe(404);
      expect((await h.call(owner, "GET", `${BASE}/tasks/${ids["task"]}`)).status).toBe(404);
      const deal = await h.call(owner, "GET", `${BASE}/deals/${ids["deal"]}`);
      expect(deal.body.data.contact_ids).toEqual([]);
      expect((await h.call(owner, "DELETE", `${BASE}/contacts/${ids["thomas"]}`)).status).toBe(404);
    });
  });
});
