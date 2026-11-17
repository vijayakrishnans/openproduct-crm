// M6: what the CRM tells the rest of the platform — events (audit log,
// webhooks), seats (metering) — and what the plan tells the CRM (the contact
// limit).
import { decideContactsLimit } from "@crm-worker/platform";
import { createHarness, orgPublicId, type Harness, type Member } from "./harness";

const ORG_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ORG_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const A = `/v1/organizations/${orgPublicId(ORG_A)}/crm`;
const B = `/v1/organizations/${orgPublicId(ORG_B)}/crm`;

const alice: Member = { subjectId: "usr_alice", email: "alice@a.test", roles: { [ORG_A]: "owner" } };
const amir: Member = { subjectId: "usr_amir", email: "amir@a.test", roles: { [ORG_A]: "builder" } };
const viewer: Member = { subjectId: "usr_viewer", email: "vera@a.test", roles: { [ORG_A]: "viewer" } };
const apiKey: Member = { subjectId: "svc_key", subjectType: "service_principal", email: "", roles: { [ORG_A]: "builder" } };
const bob: Member = { subjectId: "usr_bob", email: "bob@b.test", roles: { [ORG_B]: "owner" } };

interface EventRow {
  type: string;
  org_id: string;
  source: string;
  actor_id: string;
  subject_kind: string;
  subject_id: string;
  payload: Record<string, unknown>;
}

describe("events, for the audit log and webhooks", () => {
  let h: Harness;

  const events = async (org = ORG_A) => {
    const res = await h.pg.query<EventRow>(
      `SELECT type, org_id, source, actor_id, subject_kind, subject_id, payload
       FROM events.event_log WHERE org_id = $1 ORDER BY occurred_at, type`,
      [org],
    );
    return res.rows.map((row) => ({
      ...row,
      payload: typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload,
    }));
  };
  const audit = async (org = ORG_A) => {
    const res = await h.pg.query<{ category: string; description: string }>(
      "SELECT category, description FROM events.audit_entries WHERE org_id = $1 ORDER BY occurred_at, description",
      [org],
    );
    return res.rows;
  };

  beforeAll(async () => {
    h = await createHarness([alice, amir, viewer, apiKey, bob]);
  }, 120_000);

  afterAll(async () => {
    await h.close();
  });

  it("announces a new contact, with ids and no personal data", async () => {
    const res = await h.call(alice, "POST", `${A}/contacts`, {
      first_name: "Ada",
      last_name: "Lovelace",
      email_jsonb: [{ email: "ada@secret.test" }],
      background: "private background",
    });
    expect(res.status).toBe(201);

    const [event] = await events();
    expect(event).toMatchObject({
      type: "crm.contact.created",
      org_id: ORG_A,
      source: "crm-worker",
      actor_id: "usr_alice",
      subject_kind: "contact",
      subject_id: String(res.body.data.id),
      payload: { orgId: orgPublicId(ORG_A), contactId: res.body.data.id, companyId: null },
    });
    expect(JSON.stringify(event!.payload)).not.toMatch(/secret\.test|private background/);
    expect(await audit()).toEqual([{ category: "crm", description: "Created contact Ada Lovelace" }]);
  });

  it("announces notes on contacts and on deals", async () => {
    const contact = (await h.call(alice, "GET", `${A}/contacts`)).body.data.items[0];
    const deal = (await h.call(alice, "POST", `${A}/deals`, { name: "Engine", stage: "opportunity", amount: 900 })).body.data;
    await h.call(amir, "POST", `${A}/contact_notes`, { contact_id: contact.id, text: "the note's words stay in the CRM" });
    await h.call(amir, "POST", `${A}/deal_notes`, { deal_id: deal.id, text: "also private" });

    const notes = (await events()).filter((e) => e.type === "crm.note.created");
    expect(notes.map((e) => e.payload)).toEqual([
      expect.objectContaining({ on: "contact", contactId: contact.id, dealId: null, attachments: 0 }),
      expect.objectContaining({ on: "deal", dealId: deal.id, contactId: null }),
    ]);
    expect(notes.every((e) => e.actor_id === "usr_amir")).toBe(true);
    expect(JSON.stringify(notes)).not.toMatch(/words stay|also private/);
  });

  it("announces a deal that changes stage, and a deal that is won", async () => {
    const deal = (await h.call(alice, "GET", `${A}/deals`)).body.data.items[0];
    const before = (await events()).length;

    // Not a stage change: nothing is announced
    await h.call(alice, "PATCH", `${A}/deals/${deal.id}`, { amount: 1000 });
    await h.call(alice, "PATCH", `${A}/deals/${deal.id}`, { stage: "opportunity" });
    expect((await events()).length).toBe(before);

    await h.call(alice, "PATCH", `${A}/deals/${deal.id}`, { stage: "proposal-sent" });
    await h.call(alice, "PATCH", `${A}/deals/${deal.id}`, { stage: "won" });

    const moved = (await events()).slice(before);
    expect(moved.map((e) => [e.type, e.payload["from"] ?? null, e.payload["to"] ?? null])).toEqual([
      ["crm.deal.stage_changed", "opportunity", "proposal-sent"],
      ["crm.deal.stage_changed", "proposal-sent", "won"],
      ["crm.deal.won", null, null],
    ]);
    expect(moved[2]!.payload).toMatchObject({ dealId: deal.id, amount: 1000 });
    expect((await audit()).map((a) => a.description)).toEqual(
      expect.arrayContaining(["Moved deal Engine from proposal-sent to won", "Won deal Engine"]),
    );
  });

  it("announces what an assistant does over MCP too, as the key that did it", async () => {
    const before = (await events()).length;
    const res = await h.call(apiKey, "POST", `${A}/mcp`, {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "create_contact", arguments: { first_name: "Via", last_name: "Mcp" } },
    });
    expect(res.body.result.isError).toBe(false);
    const [event] = (await events()).slice(before);
    expect(event).toMatchObject({ type: "crm.contact.created", actor_id: "svc_key" });
  });

  it("announces nothing for a request that fails or is refused", async () => {
    const before = (await events()).length;
    expect((await h.call(alice, "POST", `${A}/contacts`, { first_name: "Ghost", company_id: 999999 })).status).toBe(422);
    expect((await h.call(viewer, "POST", `${A}/contacts`, { first_name: "Nope" })).status).toBe(403);
    expect((await h.call(bob, "POST", `${A}/contacts`, { first_name: "Intruder" })).status).toBe(404);
    expect((await events()).length).toBe(before);
  });

  it("keeps each organization's events its own", async () => {
    await h.call(bob, "POST", `${B}/contacts`, { first_name: "Bea" });
    const inB = await events(ORG_B);
    expect(inB.map((e) => e.type)).toEqual(["crm.contact.created"]);
    expect(inB[0]!.payload["orgId"]).toBe(orgPublicId(ORG_B));
    expect((await events(ORG_A)).every((e) => e.org_id === ORG_A && e.payload["orgId"] === orgPublicId(ORG_A))).toBe(true);
  });

  it("leaves crm_app without any right on the event log", async () => {
    await h.pg.exec("BEGIN; SET LOCAL ROLE crm_app;");
    await expect(h.pg.query("SELECT count(*) FROM events.event_log")).rejects.toThrow(/permission denied/);
    await h.pg.exec("ROLLBACK");
  });
});

describe("seats, for metering", () => {
  let h: Harness;

  const seats = async (org: string) => {
    const res = await h.pg.query<{ metric: string; quantity: number; idempotency_key: string }>(
      "SELECT metric, quantity::int AS quantity, idempotency_key FROM metering.usage_records WHERE org_id = $1 ORDER BY idempotency_key",
      [org],
    );
    return res.rows;
  };

  beforeAll(async () => {
    h = await createHarness([alice, amir, apiKey, bob]);
  }, 120_000);

  afterAll(async () => {
    await h.close();
  });

  it("records one seat the first time a person uses the CRM, and never again", async () => {
    await h.call(alice, "GET", `${A}/sales/me`);
    await h.call(alice, "GET", `${A}/sales/me`);
    await h.call(alice, "POST", `${A}/tags`, { name: "vip", color: "#f00" });
    expect(await seats(ORG_A)).toEqual([{ metric: "crm_seats", quantity: 1, idempotency_key: "crm_seats:usr_alice" }]);

    await h.call(amir, "POST", `${A}/tags`, { name: "warm", color: "#0f0" });
    expect((await seats(ORG_A)).map((s) => s.idempotency_key)).toEqual(["crm_seats:usr_alice", "crm_seats:usr_amir"]);
  });

  it("does not count an API key as a seat", async () => {
    await h.call(apiKey, "POST", `${A}/tags`, { name: "from key", color: "#00f" });
    expect(await seats(ORG_A)).toHaveLength(2);
  });

  it("counts seats per organization", async () => {
    await h.call(bob, "GET", `${B}/sales/me`);
    expect(await seats(ORG_B)).toEqual([{ metric: "crm_seats", quantity: 1, idempotency_key: "crm_seats:usr_bob" }]);
    expect(await seats(ORG_A)).toHaveLength(2);
  });
});

describe("the plan's contact limit", () => {
  const decision = (limitValue: number | null) =>
    Response.json({
      data: { allowed: true, orgId: "x", entitlementKey: "limit.crm_contacts", valueType: "quantity", limitValue, source: "plan", subscriptionId: null },
    });

  it("lets contacts in up to the limit, then answers 412, for the UI and for MCP", async () => {
    const asked: string[] = [];
    const h = await createHarness([alice], {
      billing: (key, org) => {
        asked.push(`${key} ${org}`);
        return decision(2);
      },
    });
    try {
      expect((await h.call(alice, "POST", `${A}/contacts`, { first_name: "One" })).status).toBe(201);
      expect((await h.call(alice, "POST", `${A}/contacts`, { first_name: "Two" })).status).toBe(201);

      const third = await h.call(alice, "POST", `${A}/contacts`, { first_name: "Three" });
      expect(third.status).toBe(412);
      expect(third.body.error).toMatchObject({
        code: "precondition_failed",
        message: "Your plan's limit of 2 contacts has been reached",
        details: { reason: "limit_reached", entitlementKey: "limit.crm_contacts" },
      });

      const viaMcp = await h.call(alice, "POST", `${A}/mcp`, {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "create_contact", arguments: { first_name: "Four" } },
      });
      expect(viaMcp.body.result.isError).toBe(true);

      expect((await h.call(alice, "GET", `${A}/contacts`)).body.data.total).toBe(2);
      // Only contacts are limited, and only the creation of one asks billing
      expect((await h.call(alice, "POST", `${A}/companies`, { name: "Free of limits" })).status).toBe(201);
      expect(asked).toEqual(Array(4).fill(`limit.crm_contacts ${orgPublicId(ORG_A)}`));

      // Deleting one makes room again
      const first = (await h.call(alice, "GET", `${A}/contacts`)).body.data.items[0];
      await h.call(alice, "DELETE", `${A}/contacts/${first.id}`);
      expect((await h.call(alice, "POST", `${A}/contacts`, { first_name: "Room" })).status).toBe(201);
    } finally {
      await h.close();
    }
  }, 120_000);

  it("treats a null limit as unlimited", async () => {
    const h = await createHarness([alice], { billing: () => decision(null) });
    try {
      for (const name of ["a", "b", "c"]) {
        expect((await h.call(alice, "POST", `${A}/contacts`, { first_name: name })).status).toBe(201);
      }
    } finally {
      await h.close();
    }
  }, 120_000);

  it("fails closed when billing does not answer, and creates nothing", async () => {
    for (const billing of [
      () => new Response("down", { status: 500 }),
      () => Response.json({ nonsense: true }),
      () => {
        throw new Error("network");
      },
    ]) {
      const h = await createHarness([alice], { billing });
      try {
        const res = await h.call(alice, "POST", `${A}/contacts`, { first_name: "x" });
        expect(res.status).toBe(503);
        expect((await h.call(alice, "GET", `${A}/contacts`)).body.data.total).toBe(0);
      } finally {
        await h.close();
      }
    }
  }, 180_000);

  it("refuses when the plan disables or does not define the key", async () => {
    const h = await createHarness([alice], {
      billing: () => Response.json({ data: { allowed: false, orgId: "x", entitlementKey: "limit.crm_contacts", reason: "disabled" } }),
    });
    try {
      expect((await h.call(alice, "POST", `${A}/contacts`, { first_name: "x" })).status).toBe(412);
    } finally {
      await h.close();
    }
  }, 120_000);

  it("decides from a decision alone", () => {
    const allowed = (limitValue: unknown, valueType = "quantity") =>
      ({ allowed: true, orgId: "o", entitlementKey: "k", valueType, limitValue, source: "plan", subscriptionId: null }) as never;
    expect(decideContactsLimit(allowed(10), 9)).toEqual({ kind: "allow" });
    expect(decideContactsLimit(allowed(10), 10).kind).toBe("deny");
    expect(decideContactsLimit(allowed(null), 1_000_000)).toEqual({ kind: "allow" });
    expect(decideContactsLimit(allowed(-1), 0).kind).toBe("deny");
    expect(decideContactsLimit(allowed("many"), 0).kind).toBe("deny");
    expect(decideContactsLimit(allowed(null, "boolean"), 0).kind).toBe("deny");
    expect(decideContactsLimit({ allowed: false, orgId: "o", entitlementKey: "k", reason: "not_configured" } as never, 0).kind).toBe("deny");
  });
});
