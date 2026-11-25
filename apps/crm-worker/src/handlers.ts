import type { SqlExecutor } from "@saas/db/hyperdrive";
import {
  attachmentPathsUnder,
  attachmentsError,
  deleteObjects,
  isNoteResource,
  pathsOf,
} from "./attachments.js";
import type { Actor } from "./authz.js";
import { DOC, documents, type OrgScope } from "./db.js";
import { companyLogo, contactAvatar, type Fetch } from "./favicons.js";
import { errorResponse, forbidden, notFound, successResponse, validationError } from "./http.js";
import { checkContactsLimit, type PlatformWork } from "./platform.js";
import { parseListQuery } from "./query.js";
import { SEARCH_RESOURCES, type ResourceDef } from "./resources.js";

export interface Ctx {
  tx: SqlExecutor;
  scope: OrgScope;
  actor: Actor;
  isAdmin: boolean;
  requestId: string;
  /** Where note attachments live; absent where no bucket is bound. */
  bucket: R2Bucket | undefined;
  /** Outbound fetch for favicons; absent turns the lookup off. */
  fetcher: Fetch | undefined;
  /** Work to do once the transaction has committed (R2 deletes): a
   *  rolled-back request must not have removed any file. */
  afterCommit: (() => Promise<void>)[];
  /** Events and seat records to write with this request (see platform.ts). */
  platform: PlatformWork;
  /** billing-worker, for the plan's contact limit; absent turns the check off. */
  billing: Fetcher | undefined;
}

type Body = Record<string, unknown>;

export async function readBody(request: Request): Promise<Body | null> {
  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Body;
  } catch {
    return null;
  }
}

function idCast(def: ResourceDef): string {
  return def.idType === "bigint" ? "bigint" : "text";
}

function quoted(columns: string[], prefix = ""): string {
  return columns.map((c) => `${prefix}"${c}"`).join(", ");
}

/** The member's CRM profile, created on first use so that records they write
 *  get an owner (the set_sales_id_default trigger looks it up). */
export async function ensureSalesProfile(ctx: Ctx): Promise<void> {
  const email = ctx.actor.email?.trim() || `${ctx.actor.subjectId}@no-email.invalid`;
  const firstName = ctx.actor.email ? email.split("@")[0]! : "API";
  const created = await ctx.tx.execute(
    `INSERT INTO crm.sales (org_id, subject_id, email, first_name, last_name, administrator)
     VALUES ($1::text::uuid, $2::text, $3::text, $4::text, '', $5::text::boolean)
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [ctx.scope.orgId, ctx.actor.subjectId, email, firstName, String(ctx.isAdmin)],
  );
  // A person's first use of the CRM is a seat; an API key is not a person.
  if (created.rows.length > 0 && ctx.actor.subjectType === "user") {
    ctx.platform.newSeats.push(ctx.actor.subjectId);
  }
}

export async function handleMe(ctx: Ctx): Promise<Response> {
  await ensureSalesProfile(ctx);
  // The administrator flag mirrors the member's role; refresh it here.
  const result = await ctx.tx.execute(
    `UPDATE crm.sales AS t SET administrator = $3::text::boolean
     WHERE t.org_id = $1::text::uuid AND t.subject_id = $2::text
     RETURNING ${DOC}`,
    [ctx.scope.orgId, ctx.actor.subjectId, String(ctx.isAdmin)],
  );
  const [profile] = documents(result.rows);
  if (!profile) return notFound(ctx.requestId);
  return successResponse(profile, ctx.requestId);
}

export async function handleList(ctx: Ctx, def: ResourceDef, search: URLSearchParams): Promise<Response> {
  const parsed = parseListQuery(def, search, ctx.scope.orgId);
  if (!parsed.ok) return validationError(ctx.requestId, parsed.fields);
  const q = parsed.query;

  const n = q.params.length;
  const rows = await ctx.tx.execute(
    `SELECT ${DOC} FROM ${def.relation} t WHERE ${q.where}
     ORDER BY ${q.orderBy} LIMIT $${n + 1}::text::integer OFFSET $${n + 2}::text::integer`,
    [...q.params, String(q.limit), String(q.offset)],
  );
  const count = await ctx.tx.execute<{ total: number }>(
    `SELECT count(*)::integer AS total FROM ${def.relation} t WHERE ${q.where}`,
    q.params,
  );

  return successResponse(
    {
      items: documents(rows.rows),
      total: Number(count.rows[0]?.total ?? 0),
      page: q.page,
      perPage: q.perPage,
    },
    ctx.requestId,
  );
}

export async function handleGet(ctx: Ctx, def: ResourceDef, id: string): Promise<Response> {
  const result = await ctx.tx.execute(
    `SELECT ${DOC} FROM ${def.relation} t WHERE t.org_id = $1::text::uuid AND t.id = $2::text::${idCast(def)}`,
    [ctx.scope.orgId, id],
  );
  const [doc] = documents(result.rows);
  if (!doc) return notFound(ctx.requestId);
  return successResponse(doc, ctx.requestId);
}

export async function handleCreate(ctx: Ctx, def: ResourceDef, body: Body | null): Promise<Response> {
  if (!body) return validationError(ctx.requestId, { body: ["must be a JSON object"] });

  const missing = def.required.filter((c) => body[c] === undefined || body[c] === null || body[c] === "");
  if (missing.length > 0) {
    return validationError(ctx.requestId, Object.fromEntries(missing.map((c) => [c, ["is required"]])));
  }

  await ensureSalesProfile(ctx);

  const values: Body = Object.fromEntries(def.writable.filter((c) => body[c] !== undefined).map((c) => [c, body[c]]));
  const invalid = await prepareValues(ctx, def, values, null);
  if (invalid) return invalid;
  const columns = Object.keys(values);

  if (def.name === "contacts") {
    const refused = await contactsLimitReached(ctx);
    if (refused) return refused;
  }

  const result = await ctx.tx.execute(
    `INSERT INTO ${def.table} AS t (org_id${columns.length ? ", " + quoted(columns) : ""})
     SELECT $1::text::uuid${columns.length ? ", " + quoted(columns, "r.") : ""}
     FROM jsonb_populate_record(NULL::${def.table}, $2::text::jsonb) r
     RETURNING ${DOC}`,
    [ctx.scope.orgId, JSON.stringify(values)],
  );
  const [doc] = documents(result.rows);
  if (doc) announceCreated(ctx, def, doc);
  return successResponse(doc, ctx.requestId, 201);
}

/** Refuses one more contact when the organization's plan is full. */
async function contactsLimitReached(ctx: Ctx): Promise<Response | null> {
  if (!ctx.billing) return null;
  const count = await ctx.tx.execute<{ n: number }>(
    "SELECT count(*)::integer AS n FROM crm.contacts c WHERE c.org_id = $1::text::uuid",
    [ctx.scope.orgId],
  );
  const gate = await checkContactsLimit(ctx.billing, ctx.scope.orgId, Number(count.rows[0]?.n ?? 0), ctx.requestId);
  if (gate.kind === "allow") return null;
  if (gate.kind === "unavailable") {
    return errorResponse("internal_error", "Billing service unavailable", 503, ctx.requestId);
  }
  return errorResponse("precondition_failed", gate.message, 412, ctx.requestId, {
    reason: "limit_reached",
    entitlementKey: "limit.crm_contacts",
  });
}

const fullName = (doc: Record<string, unknown>) =>
  [doc["first_name"], doc["last_name"]].filter((part) => typeof part === "string" && part !== "").join(" ");

function announceCreated(ctx: Ctx, def: ResourceDef, doc: Record<string, unknown>): void {
  if (def.name === "contacts") {
    const name = fullName(doc);
    ctx.platform.events.push({
      type: "crm.contact.created",
      subjectKind: "contact",
      subjectId: String(doc["id"]),
      subjectName: name,
      description: `Created contact ${name || `#${doc["id"]}`}`,
      payload: { contactId: doc["id"], companyId: doc["company_id"] ?? null, salesId: doc["sales_id"] ?? null },
    });
  } else if (def.name === "contact_notes" || def.name === "deal_notes") {
    const on = def.name === "contact_notes" ? "contact" : "deal";
    const parentId = doc[`${on}_id`];
    ctx.platform.events.push({
      type: "crm.note.created",
      subjectKind: "note",
      subjectId: String(doc["id"]),
      description: `Added a note to ${on} #${parentId}`,
      payload: {
        noteId: doc["id"],
        on,
        contactId: on === "contact" ? parentId : null,
        dealId: on === "deal" ? parentId : null,
        salesId: doc["sales_id"] ?? null,
        attachments: Array.isArray(doc["attachments"]) ? doc["attachments"].length : 0,
      },
    });
  }
}

export async function handleUpdate(ctx: Ctx, def: ResourceDef, id: string, body: Body | null): Promise<Response> {
  if (!body) return validationError(ctx.requestId, { body: ["must be a JSON object"] });

  const columns = def.writable.filter((c) => body[c] !== undefined);
  const blank = def.required.filter((c) => columns.includes(c) && (body[c] === null || body[c] === ""));
  if (blank.length > 0) {
    return validationError(ctx.requestId, Object.fromEntries(blank.map((c) => [c, ["is required"]])));
  }

  if (def.name === "sales" && !ctx.isAdmin) {
    // A member edits their own profile only, and cannot disable anyone.
    const own = await ctx.tx.execute<{ subject_id: string }>(
      "SELECT t.subject_id FROM crm.sales t WHERE t.org_id = $1::text::uuid AND t.id = $2::text::bigint",
      [ctx.scope.orgId, id],
    );
    if (own.rows.length === 0) return notFound(ctx.requestId);
    if (own.rows[0]!.subject_id !== ctx.actor.subjectId || columns.includes("disabled")) {
      return forbidden(ctx.requestId);
    }
  }

  await ensureSalesProfile(ctx);

  const values: Body = Object.fromEntries(columns.map((c) => [c, body[c]]));
  const invalid = await prepareValues(ctx, def, values, id);
  if (invalid) return invalid;

  const assignments = Object.keys(values).map((c) => `"${c}" = r."${c}"`);
  if (def.touchOnUpdate) assignments.push(`"${def.touchOnUpdate}" = now()`);
  if (assignments.length === 0) return handleGet(ctx, def, id);

  // Files a note no longer lists are removed once the update has committed.
  const replaced =
    isNoteResource(def.name) && values["attachments"] !== undefined
      ? await attachmentPathsUnder(ctx.tx, ctx.scope.orgId, def.name, id)
      : [];

  // A deal that moves is announced; know where it was before it moves.
  const stageBefore =
    def.name === "deals" && typeof values["stage"] === "string"
      ? (
          await ctx.tx.execute<{ stage: string }>(
            "SELECT d.stage FROM crm.deals d WHERE d.org_id = $1::text::uuid AND d.id = $2::text::bigint",
            [ctx.scope.orgId, id],
          )
        ).rows[0]?.stage
      : undefined;

  const result = await ctx.tx.execute(
    `UPDATE ${def.table} AS t SET ${assignments.join(", ")}
     FROM jsonb_populate_record(NULL::${def.table}, $3::text::jsonb) r
     WHERE t.org_id = $1::text::uuid AND t.id = $2::text::bigint
     RETURNING ${DOC}`,
    [ctx.scope.orgId, id, JSON.stringify(values)],
  );
  const [doc] = documents(result.rows);
  if (!doc) return notFound(ctx.requestId);
  if (replaced.length > 0) {
    const kept = new Set(pathsOf(values["attachments"]));
    removeFilesAfterCommit(ctx, replaced.filter((path) => !kept.has(path)));
  }
  if (stageBefore !== undefined && stageBefore !== doc["stage"]) {
    const deal = { dealId: doc["id"], companyId: doc["company_id"] ?? null, amount: doc["amount"] ?? null };
    ctx.platform.events.push({
      type: "crm.deal.stage_changed",
      subjectKind: "deal",
      subjectId: String(doc["id"]),
      subjectName: String(doc["name"] ?? ""),
      description: `Moved deal ${doc["name"]} from ${stageBefore} to ${doc["stage"]}`,
      payload: { ...deal, from: stageBefore, to: doc["stage"] },
    });
    if (doc["stage"] === "won") {
      ctx.platform.events.push({
        type: "crm.deal.won",
        subjectKind: "deal",
        subjectId: String(doc["id"]),
        subjectName: String(doc["name"] ?? ""),
        description: `Won deal ${doc["name"]}`,
        payload: deal,
      });
    }
  }
  return successResponse(doc, ctx.requestId);
}

function removeFilesAfterCommit(ctx: Ctx, paths: string[]): void {
  if (paths.length === 0) return;
  ctx.afterCommit.push(() => deleteObjects(ctx.bucket, ctx.scope.orgId, paths));
}

/** Validates and completes the values of a create (id null) or an update:
 *  note attachments must be uploads of this organization, a company without
 *  a logo gets its website's favicon, a contact without an avatar its email
 *  domain's. Returns a response when the values are refused. */
async function prepareValues(ctx: Ctx, def: ResourceDef, values: Body, id: string | null): Promise<Response | null> {
  if (isNoteResource(def.name) && values["attachments"] !== undefined) {
    const problem = attachmentsError(values["attachments"]);
    if (problem) return validationError(ctx.requestId, { attachments: [problem] });
    // Keep what describes the file; drop what a browser added (blob URLs…).
    values["attachments"] = ((values["attachments"] as Body[] | null) ?? []).map((a) => ({
      path: a["path"],
      title: typeof a["title"] === "string" ? a["title"].slice(0, 200) : null,
      type: typeof a["type"] === "string" ? a["type"].slice(0, 200) : null,
      size: typeof a["size"] === "number" ? a["size"] : null,
    }));
  }

  const favicons = { tx: ctx.tx, orgId: ctx.scope.orgId, fetcher: ctx.fetcher };

  if (def.name === "companies" && values["logo"] == null && values["website"] != null) {
    if (id === null || (await isEmpty(ctx, def, id, "logo"))) {
      const logo = await companyLogo(favicons, values["website"]);
      if (logo) values["logo"] = logo;
    }
  }

  if (def.name === "contacts" && values["avatar"] == null && values["email_jsonb"] != null) {
    if (id === null || (await isEmpty(ctx, def, id, "avatar"))) {
      const avatar = await contactAvatar(favicons, values["email_jsonb"]);
      if (avatar) values["avatar"] = avatar;
    }
  }

  return null;
}

async function isEmpty(ctx: Ctx, def: ResourceDef, id: string, column: "logo" | "avatar"): Promise<boolean> {
  const result = await ctx.tx.execute<{ empty: boolean }>(
    `SELECT t."${column}" IS NULL AS empty FROM ${def.table} t WHERE t.org_id = $1::text::uuid AND t.id = $2::text::bigint`,
    [ctx.scope.orgId, id],
  );
  return result.rows[0]?.empty === true;
}

export async function handleDelete(ctx: Ctx, def: ResourceDef, id: string): Promise<Response> {
  // The files of this record, or of the notes that go with it, go too.
  const files = await attachmentPathsUnder(ctx.tx, ctx.scope.orgId, def.name, id);
  const result = await ctx.tx.execute(
    `DELETE FROM ${def.table} AS t WHERE t.org_id = $1::text::uuid AND t.id = $2::text::bigint RETURNING ${DOC}`,
    [ctx.scope.orgId, id],
  );
  const [doc] = documents(result.rows);
  if (!doc) return notFound(ctx.requestId);
  removeFilesAfterCommit(ctx, files);
  return successResponse(doc, ctx.requestId);
}

function recordId(value: unknown): string | null {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return String(value);
  if (typeof value === "string" && /^[1-9]\d{0,15}$/.test(value)) return value;
  return null;
}

export async function handleMergeContacts(ctx: Ctx, body: Body | null): Promise<Response> {
  const loserId = recordId(body?.["loserId"]);
  const winnerId = recordId(body?.["winnerId"]);
  const fields: Record<string, string[]> = {};
  if (!loserId) fields["loserId"] = ["must be a contact id"];
  if (!winnerId) fields["winnerId"] = ["must be a contact id"];
  if (loserId && winnerId && loserId === winnerId) fields["loserId"] = ["must differ from winnerId"];
  if (Object.keys(fields).length > 0) return validationError(ctx.requestId, fields);

  await ensureSalesProfile(ctx);

  // Both contacts must belong to this org; otherwise the function raises
  // no_data_found, which the router answers with 404.
  await ctx.tx.execute("SELECT crm.merge_contacts($1::text::uuid, $2::text::bigint, $3::text::bigint)", [
    ctx.scope.orgId,
    loserId,
    winnerId,
  ]);
  const result = await ctx.tx.execute(
    `SELECT ${DOC} FROM crm.contacts t WHERE t.org_id = $1::text::uuid AND t.id = $2::text::bigint`,
    [ctx.scope.orgId, winnerId],
  );
  const [doc] = documents(result.rows);
  if (!doc) return notFound(ctx.requestId);
  return successResponse(doc, ctx.requestId);
}

export async function handleSearch(ctx: Ctx, search: URLSearchParams): Promise<Response> {
  const fields: Record<string, string[]> = {};
  const q = search.get("q") ?? "";

  let resources: string[] | null = null;
  const rawResources = search.get("resources");
  if (rawResources) {
    resources = rawResources.split(",").map((r) => r.trim()).filter(Boolean);
    const known: readonly string[] = SEARCH_RESOURCES;
    if (resources.some((r) => !known.includes(r))) {
      fields["resources"] = [`must be among ${SEARCH_RESOURCES.join(", ")}`];
    }
  }

  let limit = 50;
  const rawLimit = search.get("limit");
  if (rawLimit !== null) {
    limit = /^\d{1,3}$/.test(rawLimit) ? Number(rawLimit) : 0;
    if (limit < 1 || limit > 200) fields["limit"] = ["must be between 1 and 200"];
  }
  if (Object.keys(fields).length > 0) return validationError(ctx.requestId, fields);

  const result = await ctx.tx.execute(
    `SELECT to_jsonb(s) AS doc
     FROM crm.global_search(
       $1::text::uuid,
       $2::text,
       (SELECT array_agg(e) FROM jsonb_array_elements_text($3::text::jsonb) e),
       $4::text::integer
     ) s`,
    [ctx.scope.orgId, q, resources ? JSON.stringify(resources) : null, String(limit)],
  );
  return successResponse({ items: documents(result.rows) }, ctx.requestId);
}

/** Stages that end a deal when the caller names none. The CRM's own stage list
 *  lives in the organization's configuration, which this worker cannot read, so
 *  a caller with a different list passes `closedStages`. */
export const DEFAULT_CLOSED_STAGES = ["won", "lost", "closed"] as const;

export async function handleDashboard(ctx: Ctx, search: URLSearchParams = new URLSearchParams()): Promise<Response> {
  let closedStages: string[] = [...DEFAULT_CLOSED_STAGES];
  const raw = search.get("closedStages");
  if (raw !== null) {
    closedStages = [...new Set(raw.split(",").map((stage) => stage.trim()).filter(Boolean))];
    if (closedStages.length > 50 || closedStages.some((stage) => stage.length > 100)) {
      return validationError(ctx.requestId, { closedStages: ["must be at most 50 stages of at most 100 characters"] });
    }
  }

  // A deal is open while it is not archived and its stage is not a closed one.
  const result = await ctx.tx.execute(
    `WITH live AS (
       SELECT d.stage, d.amount, d.stage IN (SELECT jsonb_array_elements_text($2::text::jsonb)) AS closed
       FROM crm.deals d
       WHERE d.org_id = $1::text::uuid AND d.archived_at IS NULL
     )
     SELECT jsonb_build_object(
       'companies', (SELECT count(*) FROM crm.companies c WHERE c.org_id = $1::text::uuid),
       'contacts', (SELECT count(*) FROM crm.contacts c WHERE c.org_id = $1::text::uuid),
       'deals', jsonb_build_object(
         'open', (SELECT count(*) FROM live WHERE NOT live.closed),
         'amount', (SELECT coalesce(sum(live.amount), 0) FROM live WHERE NOT live.closed),
         'closedStages', $2::text::jsonb,
         'byStage', (
           SELECT coalesce(jsonb_agg(jsonb_build_object('stage', x.stage, 'count', x.n, 'amount', x.amount, 'open', NOT x.closed) ORDER BY x.stage), '[]'::jsonb)
           FROM (
             SELECT live.stage, bool_or(live.closed) AS closed, count(*) AS n, coalesce(sum(live.amount), 0) AS amount
             FROM live
             GROUP BY live.stage
           ) x
         )
       ),
       'tasks', jsonb_build_object(
         'open', (SELECT count(*) FROM crm.tasks t WHERE t.org_id = $1::text::uuid AND t.done_date IS NULL),
         'overdue', (SELECT count(*) FROM crm.tasks t WHERE t.org_id = $1::text::uuid AND t.done_date IS NULL AND t.due_date < now())
       ),
       'notes', (
         (SELECT count(*) FROM crm.contact_notes n WHERE n.org_id = $1::text::uuid)
         + (SELECT count(*) FROM crm.deal_notes n WHERE n.org_id = $1::text::uuid)
       )
     ) AS doc`,
    [ctx.scope.orgId, JSON.stringify(closedStages)],
  );
  const [doc] = documents(result.rows);
  return successResponse(doc, ctx.requestId);
}

/** Maps a constraint or data error raised by Postgres to a client error, or
 *  null when the failure is the server's. */
export function clientErrorFor(state: string | null, requestId: string): Response | null {
  if (!state) return null;
  if (state === "P0002") return notFound(requestId);
  if (state === "23503") {
    return validationError(requestId, {
      _: ["references a record that does not exist in this organization"],
    });
  }
  if (state === "23505") {
    return errorResponse("conflict", "A record with these values already exists", 409, requestId);
  }
  if (state === "23502" || state === "23514" || state.startsWith("22")) {
    return validationError(requestId, { _: ["a value is missing, malformed or out of range"] });
  }
  return null;
}
