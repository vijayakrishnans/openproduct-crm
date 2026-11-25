// M5: the MCP server. Typed, org-scoped tools over the same handlers as the
// REST routes; a caller outside the organization gets nothing.
import { schemaError, TOOLS } from "@crm-worker/mcp";
import { createHarness, orgPublicId, type Harness, type Member } from "./harness";

const ORG_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ORG_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const A = `/v1/organizations/${orgPublicId(ORG_A)}/crm`;
const B = `/v1/organizations/${orgPublicId(ORG_B)}/crm`;

// API keys reach the worker as service principals with a role in one org.
const keyA: Member = { subjectId: "svc_key_a", subjectType: "service_principal", email: "", roles: { [ORG_A]: "builder" } };
const readOnlyA: Member = { subjectId: "svc_reader_a", subjectType: "service_principal", email: "", roles: { [ORG_A]: "viewer" } };
const keyB: Member = { subjectId: "svc_key_b", subjectType: "service_principal", email: "", roles: { [ORG_B]: "owner" } };
const stranger: Member = { subjectId: "svc_stranger", subjectType: "service_principal", email: "", roles: {} };

describe("MCP server", () => {
  let h: Harness;
  let nextId = 1;

  const rpc = (member: Member | null, base: string, method: string, params?: unknown) =>
    h.call(member, "POST", `${base}/mcp`, { jsonrpc: "2.0", id: nextId++, method, params });

  /** Calls a tool and returns its parsed result. */
  const tool = async (member: Member, base: string, name: string, args: Record<string, unknown> = {}) => {
    const res = await rpc(member, base, "tools/call", { name, arguments: args });
    expect(res.status).toBe(200);
    const result = res.body.result;
    return { isError: result.isError as boolean, data: JSON.parse(result.content[0].text) };
  };

  beforeAll(async () => {
    h = await createHarness([keyA, readOnlyA, keyB, stranger]);
  }, 120_000);

  afterAll(async () => {
    await h.close();
  });

  describe("protocol", () => {
    it("initializes, echoing a version it supports", async () => {
      const res = await rpc(keyA, A, "initialize", {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "test", version: "0" },
      });
      expect(res.body).toMatchObject({
        jsonrpc: "2.0",
        result: {
          protocolVersion: "2025-03-26",
          capabilities: { tools: {} },
          serverInfo: { name: "openproduct-crm" },
        },
      });
      const unknown = await rpc(keyA, A, "initialize", { protocolVersion: "1999-01-01" });
      expect(unknown.body.result.protocolVersion).toBe("2025-06-18");
    });

    it("accepts notifications without replying, and answers ping", async () => {
      const res = await h.call(keyA, "POST", `${A}/mcp`, { jsonrpc: "2.0", method: "notifications/initialized" }).catch((e) => e);
      // 202 with an empty body: the harness cannot parse it as JSON
      expect(String(res)).toMatch(/JSON|Unexpected end/);
      expect((await rpc(keyA, A, "ping")).body.result).toEqual({});
    });

    it("lists typed tools, none of which runs SQL or deletes", async () => {
      const res = await rpc(keyA, A, "tools/list");
      const tools = res.body.result.tools as { name: string; inputSchema: any; annotations: any }[];
      expect(tools.map((t) => t.name).sort()).toEqual(TOOLS.map((t) => t.name).sort());
      for (const t of tools) {
        expect(t.inputSchema.type).toBe("object");
        expect(t.inputSchema.additionalProperties).toBe(false);
        expect(t.annotations.destructiveHint).toBe(false);
        expect(t.name).not.toMatch(/sql|query|delete|remove|merge/i);
      }
      expect(tools.find((t) => t.name === "search")!.annotations.readOnlyHint).toBe(true);
      expect(tools.find((t) => t.name === "create_contact")!.annotations.readOnlyHint).toBe(false);
    });

    it("answers JSON-RPC errors for bad requests", async () => {
      expect((await rpc(keyA, A, "resources/list")).body.error.code).toBe(-32601);
      expect((await rpc(keyA, A, "tools/call", { name: "run_sql", arguments: { sql: "select 1" } })).body.error.code).toBe(-32602);
      const batch = await h.call(keyA, "POST", `${A}/mcp`, [{ jsonrpc: "2.0", id: 1, method: "ping" }]);
      expect(batch.status).toBe(400);
      const notRpc = await h.call(keyA, "POST", `${A}/mcp`, { id: 1, method: "ping" });
      expect(notRpc.body.error.code).toBe(-32600);
      expect((await h.call(keyA, "GET", `${A}/mcp`)).status).toBe(405);
    });
  });

  describe("tools", () => {
    const ids: Record<string, number> = {};

    it("creates a company, a contact, a deal, a note and a task", async () => {
      const company = await tool(keyA, A, "create_company", { name: "Acme Hélène", sector: "Retail" });
      expect(company.isError).toBe(false);
      ids["company"] = company.data.id;

      const contact = await tool(keyA, A, "create_contact", {
        first_name: "Ada",
        last_name: "Lovelace",
        company_id: ids["company"],
        email_jsonb: [{ email: "Ada@Acme.test", type: "Work" }],
      });
      expect(contact.data).toMatchObject({ first_name: "Ada", email_jsonb: [{ email: "ada@acme.test", type: "Work" }] });
      ids["contact"] = contact.data.id;

      const deal = await tool(keyA, A, "create_deal", {
        name: "Engine",
        stage: "opportunity",
        company_id: ids["company"],
        contact_ids: [ids["contact"]],
        amount: 5000,
      });
      ids["deal"] = deal.data.id;

      const note = await tool(keyA, A, "add_note", { contact_id: ids["contact"], text: "Met at the fair" });
      expect(note.data).toMatchObject({ contact_id: ids["contact"], text: "Met at the fair" });
      const dealNote = await tool(keyA, A, "add_note", { deal_id: ids["deal"], text: "Sent the quote" });
      expect(dealNote.data.deal_id).toBe(ids["deal"]);

      const task = await tool(keyA, A, "create_task", { contact_id: ids["contact"], text: "Call back", type: "call" });
      ids["task"] = task.data.id;
      expect(task.data.done_date).toBeNull();
    });

    it("reads them back: search, list with a filter, get, dashboard", async () => {
      const search = await tool(keyA, A, "search", { query: "hel", resources: ["companies"] });
      expect(search.data.items.map((r: any) => r.title)).toEqual(["Acme Hélène"]);

      const list = await tool(keyA, A, "list", { resource: "contacts", filter: { company_id: ids["company"] }, perPage: 5 });
      expect(list.data).toMatchObject({ total: 1 });
      expect(list.data.items[0]).toMatchObject({ first_name: "Ada", company_name: "Acme Hélène", nb_tasks: 1 });

      const get = await tool(keyA, A, "get", { resource: "deals", id: ids["deal"] });
      expect(get.data).toMatchObject({ name: "Engine", amount: 5000 });

      const dashboard = await tool(keyA, A, "dashboard");
      expect(dashboard.data).toMatchObject({ companies: 1, contacts: 1, deals: { open: 1, amount: 5000 }, tasks: { open: 1 } });
      const custom = await tool(keyA, A, "dashboard", { closed_stages: ["opportunity"] });
      expect(custom.data).toMatchObject({ deals: { open: 0, amount: 0, closedStages: ["opportunity"] } });
    });

    it("updates only the fields given, and completes a task", async () => {
      const deal = await tool(keyA, A, "update_deal", { id: ids["deal"], stage: "won" });
      expect(deal.data).toMatchObject({ stage: "won", name: "Engine", amount: 5000 });
      const contact = await tool(keyA, A, "update_contact", { id: ids["contact"], title: "Countess" });
      expect(contact.data).toMatchObject({ title: "Countess", last_name: "Lovelace" });
      const company = await tool(keyA, A, "update_company", { id: ids["company"], city: "London" });
      expect(company.data).toMatchObject({ city: "London", name: "Acme Hélène" });

      const done = await tool(keyA, A, "complete_task", { id: ids["task"] });
      expect(done.data.done_date).not.toBeNull();
      const reopened = await tool(keyA, A, "complete_task", { id: ids["task"], done: false });
      expect(reopened.data.done_date).toBeNull();
    });

    it("refuses arguments outside a tool's schema, before touching the database", async () => {
      const cases: [string, Record<string, unknown>, RegExp][] = [
        ["create_company", {}, /name is required/],
        ["create_company", { name: "x", org_id: ORG_B }, /org_id is not a known field/],
        ["create_contact", { first_name: 3 }, /must be string/],
        ["create_contact", { sales_id: 1 }, /not a known field/],
        ["get", { resource: "secrets", id: 1 }, /must be one of/],
        ["get", { resource: "contacts", id: "1; drop table crm.contacts" }, /must be integer/],
        ["list", { resource: "contacts", perPage: 5000 }, /at most 100/],
        ["search", { query: "x", resources: ["passwords"] }, /must be one of/],
        ["add_note", { text: "x" }, /exactly one/],
        ["add_note", { text: "x", contact_id: 1, deal_id: 1 }, /exactly one/],
      ];
      for (const [name, args, message] of cases) {
        const res = await tool(keyA, A, name, args);
        expect(res.isError).toBe(true);
        expect(res.data.error.message).toMatch(message);
      }
    });

    it("reports a failed call as a tool error and leaves nothing behind", async () => {
      const missing = await tool(keyA, A, "update_contact", { id: 999999, title: "x" });
      expect(missing).toMatchObject({ isError: true, data: { error: { code: "not_found" } } });
      const dangling = await tool(keyA, A, "create_contact", { first_name: "Ghost", company_id: 999999 });
      expect(dangling).toMatchObject({ isError: true, data: { error: { code: "validation_failed" } } });
      const ghosts = await tool(keyA, A, "list", { resource: "contacts", filter: { first_name: "Ghost" } });
      expect(ghosts.data.total).toBe(0);
    });

    it("lets a read-only key read and refuses its writes", async () => {
      const read = await tool(readOnlyA, A, "search", { query: "ada" });
      expect(read.isError).toBe(false);
      expect(read.data.items.length).toBeGreaterThan(0);
      for (const t of TOOLS.filter((t) => t.writes)) {
        const res = await tool(readOnlyA, A, t.name, { id: ids["contact"], name: "x", stage: "x", text: "x", contact_id: ids["contact"] });
        expect(res.isError).toBe(true);
      }
      const unchanged = await tool(keyA, A, "get", { resource: "contacts", id: ids["contact"] });
      expect(unchanged.data.title).toBe("Countess");
    });

    describe("another organization's key", () => {
      it("gets 404 from org A's endpoint for every method, with no hint that it exists", async () => {
        for (const caller of [keyB, stranger]) {
          for (const [method, params] of [
            ["initialize", { protocolVersion: "2025-06-18" }],
            ["tools/list", undefined],
            ["tools/call", { name: "search", arguments: { query: "ada" } }],
            ["tools/call", { name: "get", arguments: { resource: "contacts", id: ids["contact"] } }],
            ["tools/call", { name: "update_contact", arguments: { id: ids["contact"], title: "pwned" } }],
          ] as const) {
            const res = await rpc(caller, A, method, params);
            expect(res.status).toBe(404);
            expect(JSON.stringify(res.body)).not.toMatch(/ada|lovelace|acme/i);
          }
        }
        expect((await rpc(null, A, "tools/list")).status).toBe(401);
      });

      it("cannot reach org A's records through its own endpoint", async () => {
        const get = await tool(keyB, B, "get", { resource: "contacts", id: ids["contact"] });
        expect(get).toMatchObject({ isError: true, data: { error: { code: "not_found" } } });
        const update = await tool(keyB, B, "update_deal", { id: ids["deal"], stage: "lost" });
        expect(update).toMatchObject({ isError: true, data: { error: { code: "not_found" } } });
        const attach = await tool(keyB, B, "create_contact", { first_name: "B", company_id: ids["company"] });
        expect(attach.isError).toBe(true);
        const note = await tool(keyB, B, "add_note", { contact_id: ids["contact"], text: "from B" });
        expect(note.isError).toBe(true);

        for (const [name, args] of [
          ["search", { query: "ada" }],
          ["search", { query: "acme" }],
          ["list", { resource: "contacts" }],
          ["list", { resource: "contacts", filter: { id: ids["contact"] } }],
          ["list", { resource: "activity_log" }],
          ["dashboard", {}],
        ] as const) {
          const res = await tool(keyB, B, name, args);
          expect(res.isError).toBe(false);
          expect(JSON.stringify(res.data)).not.toMatch(/ada|lovelace|acme/i);
        }
      });

      it("left org A as it was", async () => {
        const contact = await tool(keyA, A, "get", { resource: "contacts", id: ids["contact"] });
        expect(contact.data).toMatchObject({ title: "Countess", first_name: "Ada" });
        const deal = await tool(keyA, A, "get", { resource: "deals", id: ids["deal"] });
        expect(deal.data.stage).toBe("won");
        const notes = await tool(keyA, A, "list", { resource: "contact_notes" });
        expect(notes.data.items.map((n: any) => n.text)).toEqual(["Met at the fair"]);
      });
    });
  });

  describe("schema check", () => {
    it("covers types, enums, ranges, nesting and unknown keys", () => {
      const schema = {
        type: "object",
        properties: {
          n: { type: "integer", minimum: 1, maximum: 3 },
          kind: { type: "string", enum: ["a", "b"] },
          list: { type: "array", items: { type: "object", properties: { email: { type: "string" } }, required: ["email"], additionalProperties: false } },
          maybe: { type: ["string", "null"] },
        },
        required: ["n"],
        additionalProperties: false,
      };
      expect(schemaError(schema, { n: 2, kind: "a", list: [{ email: "x" }], maybe: null })).toBeNull();
      expect(schemaError(schema, {})).toMatch(/n is required/);
      expect(schemaError(schema, { n: 1.5 })).toMatch(/must be integer/);
      expect(schemaError(schema, { n: 4 })).toMatch(/at most 3/);
      expect(schemaError(schema, { n: 1, kind: "c" })).toMatch(/one of/);
      expect(schemaError(schema, { n: 1, list: [{}] })).toMatch(/list\[0\]\.email is required/);
      expect(schemaError(schema, { n: 1, list: [{ email: "x", extra: 1 }] })).toMatch(/extra is not a known field/);
      expect(schemaError(schema, { n: 1, maybe: 3 })).toMatch(/string or null/);
      expect(schemaError(schema, [])).toMatch(/must be object/);
    });
  });
});
