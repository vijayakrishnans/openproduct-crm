// The gate from M2 on (design.md §1.3): on EVERY route of crm-worker, a member
// of org B gets 404 for org A — never 403, never data — and leaves org A's
// records exactly as they were. The route list is derived from the worker's
// own resource table, so a new resource or method is covered the day it lands.

import { RESOURCES } from "@crm-worker/resources";
import { createHarness, orgPublicId, type Harness, type Member } from "./harness";

const ORG_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ORG_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const A = `/v1/organizations/${orgPublicId(ORG_A)}/crm`;
const B = `/v1/organizations/${orgPublicId(ORG_B)}/crm`;

const alice: Member = { subjectId: "usr_alice", email: "alice@a.test", roles: { [ORG_A]: "owner" } };
const bob: Member = { subjectId: "usr_bob", email: "bob@b.test", roles: { [ORG_B]: "owner" } };
const stranger: Member = { subjectId: "usr_stranger", email: "s@nowhere.test", roles: {} };

interface RouteCase {
  method: string;
  /** Path below /crm; `:id` is replaced by a real id of org A. */
  path: string;
  body?: Record<string, unknown>;
}

/** Every route the worker serves. */
function allRoutes(): RouteCase[] {
  const routes: RouteCase[] = [
    { method: "GET", path: "/sales/me" },
    { method: "GET", path: "/search?q=secret" },
    { method: "GET", path: "/dashboard" },
    { method: "POST", path: "/contacts/merge", body: { loserId: ":contacts2", winnerId: ":contacts" } },
    { method: "POST", path: "/attachments?filename=intruder.txt", body: { any: "bytes" } },
    { method: "GET", path: "/attachments/:file" },
  ];
  for (const def of RESOURCES.values()) {
    routes.push({ method: "GET", path: `/${def.name}` });
    if (def.can.create) routes.push({ method: "POST", path: `/${def.name}`, body: { name: "intruder", color: "x", stage: "x" } });
    if (def.can.get) routes.push({ method: "GET", path: `/${def.name}/:id` });
    if (def.can.update) {
      routes.push({ method: "PATCH", path: `/${def.name}/:id`, body: { first_name: "intruder", name: "intruder", text: "intruder" } });
      routes.push({ method: "PUT", path: `/${def.name}/:id`, body: { first_name: "intruder", name: "intruder", text: "intruder" } });
    }
    if (def.can.delete) routes.push({ method: "DELETE", path: `/${def.name}/:id` });
  }
  return routes;
}

describe("cross-org isolation matrix", () => {
  let h: Harness;
  /** A real id of org A per resource (base table name). */
  const idsA: Record<string, number> = {};
  let snapshotA = "";
  /** The path of a file org A uploaded and attached to a note. */
  let fileA = "";

  async function snapshot(): Promise<string> {
    const res = await h.pg.query<{ doc: unknown }>(
      `SELECT jsonb_build_object(
         'sales', (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM crm.sales t WHERE org_id = $1),
         'tags', (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM crm.tags t WHERE org_id = $1),
         'companies', (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM crm.companies t WHERE org_id = $1),
         'contacts', (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM crm.contacts t WHERE org_id = $1),
         'contact_notes', (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM crm.contact_notes t WHERE org_id = $1),
         'deals', (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM crm.deals t WHERE org_id = $1),
         'deal_notes', (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM crm.deal_notes t WHERE org_id = $1),
         'tasks', (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM crm.tasks t WHERE org_id = $1)
       ) AS doc`,
      [ORG_A],
    );
    return JSON.stringify(res.rows[0]!.doc);
  }

  function resolvePath(c: RouteCase): { path: string; body?: Record<string, unknown> } {
    const resource = c.path.split("/")[1]!.split("?")[0]!;
    const base = resource.replace(/_summary$/, "");
    const path = c.path.replace(":id", String(idsA[base])).replace(":file", fileA);
    const body = c.body
      ? Object.fromEntries(
          Object.entries(c.body).map(([k, v]) => [
            k,
            v === ":contacts" ? idsA["contacts"] : v === ":contacts2" ? idsA["contacts2"] : v,
          ]),
        )
      : undefined;
    return body ? { path, body } : { path };
  }

  beforeAll(async () => {
    h = await createHarness([alice, bob, stranger]);

    const post = async (path: string, body: Record<string, unknown>) => {
      const res = await h.call(alice, "POST", `${A}${path}`, body);
      expect(res.status).toBe(201);
      return res.body.data.id as number;
    };
    idsA["sales"] = (await h.call(alice, "GET", `${A}/sales/me`)).body.data.id;
    idsA["tags"] = await post("/tags", { name: "secret tag", color: "#000" });
    idsA["companies"] = await post("/companies", { name: "Secret Corp" });
    idsA["contacts"] = await post("/contacts", {
      first_name: "Secret",
      last_name: "Agent",
      company_id: idsA["companies"],
      tags: [idsA["tags"]],
      email_jsonb: [{ email: "agent@a.test" }],
    });
    idsA["contacts2"] = await post("/contacts", { first_name: "Second", last_name: "Secret" });
    idsA["deals"] = await post("/deals", {
      name: "Secret deal",
      stage: "lead",
      company_id: idsA["companies"],
      contact_ids: [idsA["contacts"]],
    });
    const upload = await h.upload(alice, `${A}/attachments?filename=secret-plan.txt`, "secret contents", "text/plain");
    expect(upload.status).toBe(201);
    fileA = upload.body.data.path;
    idsA["contact_notes"] = await post("/contact_notes", {
      contact_id: idsA["contacts"],
      text: "secret note",
      attachments: [upload.body.data],
    });
    idsA["deal_notes"] = await post("/deal_notes", { deal_id: idsA["deals"], text: "secret deal note" });
    idsA["tasks"] = await post("/tasks", { contact_id: idsA["contacts"], text: "secret task" });

    // Bob uses his own org, so he has a profile and ids of his own.
    await h.call(bob, "GET", `${B}/sales/me`);
    snapshotA = await snapshot();
  }, 120_000);

  afterAll(async () => {
    await h.close();
  });

  const routes = allRoutes();

  it("covers every resource and every special route", () => {
    expect(routes.length).toBeGreaterThanOrEqual(45);
    for (const name of RESOURCES.keys()) {
      expect(routes.some((r) => r.path === `/${name}`)).toBe(true);
    }
  });

  describe.each([
    ["a member of another org", bob],
    ["someone in no org", stranger],
  ])("%s, on org A's routes", (_label, intruder) => {
    it.each(routes.map((r) => [`${r.method} ${r.path}`, r] as const))("%s → 404", async (_name, c) => {
      const { path, body } = resolvePath(c);
      const res = await h.call(intruder, c.method, `${A}${path}`, body);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("not_found");
      expect(JSON.stringify(res.body)).not.toMatch(/secret|agent@a\.test/i);
    });
  });

  describe("org B's member, on org B's routes, using org A's ids", () => {
    it.each(
      routes
        .filter((r) => r.path.includes(":id") || r.path.includes(":file") || r.path === "/contacts/merge")
        .map((r) => [`${r.method} ${r.path}`, r] as const),
    )("%s → 404", async (_name, c) => {
      const { path, body } = resolvePath(c);
      const res = await h.call(bob, c.method, `${B}${path}`, body);
      expect(res.status).toBe(404);
      expect(JSON.stringify(res.body)).not.toMatch(/secret|agent@a\.test/i);
    });

    it.each(routes.filter((r) => r.method === "GET" && !r.path.includes(":id") && !r.path.includes(":file")).map((r) => [r.path, r] as const))(
      "GET %s shows nothing of org A",
      async (_name, c) => {
        const res = await h.call(bob, "GET", `${B}${c.path}`);
        expect(res.status).toBe(200);
        expect(JSON.stringify(res.body)).not.toMatch(/secret|agent@a\.test/i);
      },
    );

    it("cannot attach its own records to org A's", async () => {
      const attempts: [string, Record<string, unknown>][] = [
        ["/contacts", { first_name: "b", company_id: idsA["companies"] }],
        ["/contacts", { first_name: "b", tags: [idsA["tags"]] }],
        ["/contacts", { first_name: "b", sales_id: idsA["sales"] }],
        ["/deals", { name: "b", stage: "lead", company_id: idsA["companies"] }],
        ["/deals", { name: "b", stage: "lead", contact_ids: [idsA["contacts"]] }],
        ["/tasks", { contact_id: idsA["contacts"], text: "b" }],
        ["/contact_notes", { contact_id: idsA["contacts"], text: "b" }],
        ["/deal_notes", { deal_id: idsA["deals"], text: "b" }],
      ];
      for (const [path, body] of attempts) {
        const res = await h.call(bob, "POST", `${B}${path}`, body);
        expect(res.status).toBe(422);
      }
    });

    it("cannot smuggle an org_id in a body", async () => {
      const res = await h.call(bob, "POST", `${B}/tags`, { name: "mine", color: "#111", org_id: ORG_A });
      expect(res.status).toBe(201);
      const inA = await h.call(alice, "GET", `${A}/tags`);
      expect(inA.body.data.items.map((t: any) => t.name)).toEqual(["secret tag"]);
    });
  });

  it("left org A's records exactly as they were", async () => {
    expect(await snapshot()).toBe(snapshotA);
    expect([...h.bucket.objects.keys()].filter((key) => key.startsWith(ORG_A))).toEqual([`${ORG_A}/${fileA}`]);
  });

  it("answers 404 for an org id that is not one", async () => {
    const res = await h.call(alice, "GET", "/v1/organizations/not-an-org/crm/contacts");
    expect(res.status).toBe(404);
  });
});
