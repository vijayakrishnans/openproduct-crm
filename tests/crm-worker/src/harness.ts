import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { btree_gin } from "@electric-sql/pglite/contrib/btree_gin";
import { unaccent } from "@electric-sql/pglite/contrib/unaccent";
import { createSqlExecutor, type SqlExecutor, type SqlRow } from "@saas/db/hyperdrive";
import type { Db } from "@crm-worker/db";
import type { Env } from "@crm-worker/env";
import { route } from "@crm-worker/router";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = resolve(__dirname, "../../..", "packages/db/src/migrations");
const MIGRATION = resolve(__dirname, "../../..", "packages/db/src/migrations/200_crm_core/up.sql");

export type Role = "owner" | "admin" | "builder" | "viewer" | "billing_admin";

export interface Member {
  subjectId: string;
  /** "user" unless given; an API key reaches the worker as "service_principal". */
  subjectType?: "user" | "service_principal";
  email: string;
  /** org uuid → role */
  roles: Record<string, Role>;
}

const CRM_ACTIONS: Record<Role, string[]> = {
  owner: ["organization.crm.read", "organization.crm.write", "organization.crm.manage"],
  admin: ["organization.crm.read", "organization.crm.write", "organization.crm.manage"],
  builder: ["organization.crm.read", "organization.crm.write"],
  viewer: ["organization.crm.read"],
  billing_admin: [],
};

function json(data: unknown): Response {
  return new Response(JSON.stringify({ data }), { headers: { "content-type": "application/json" } });
}

/** A real Postgres (PGlite) with the crm migration applied, behind the
 *  executor interface the worker uses in production. */
export async function createDatabase(): Promise<PGlite> {
  const pg = new PGlite({ extensions: { unaccent, btree_gin } });
  // The contexts crm-worker writes to besides its own: the event log (audit,
  // webhooks) and metering.
  for (const migration of ["030_events_audit_core", "100_metering_foundation"]) {
    await pg.exec(readFileSync(resolve(MIGRATIONS, migration, "up.sql"), "utf-8"));
  }
  await pg.exec(readFileSync(MIGRATION, "utf-8"));
  return pg;
}

export function executorFor(pg: PGlite): Db {
  let asOwner = false;
  const execute = async <T extends SqlRow = SqlRow>(text: string, params?: unknown[]) => {
    // The production driver (postgres.js) re-encodes a parameter by the type
    // Postgres infers for it: a JSON string bound to $n::jsonb is stringified
    // again, "true" bound to $n::boolean becomes false. The worker therefore
    // binds text only and casts in SQL; hold it to that here.
    // After RESET ROLE the transaction is writing to other contexts through
    // their own repositories (events, metering), which bind as they always
    // have; the rule is for the CRM's own statements.
    if (text === "RESET ROLE") asOwner = true;
    for (const param of asOwner ? [] : (params ?? [])) {
      if (param !== null && typeof param !== "string") {
        throw new Error(`crm-worker must bind text parameters only, got ${typeof param}`);
      }
    }
    const res = await pg.query(text, params);
    return { rows: res.rows as T[], rowCount: res.rows.length };
  };
  return {
    execute,
    async transaction<T>(fn: (executor: SqlExecutor) => Promise<T>): Promise<T> {
      await pg.exec("BEGIN");
      asOwner = false;
      try {
        const result = await fn({ execute });
        await pg.exec("COMMIT");
        return result;
      } catch (err) {
        await pg.exec("ROLLBACK");
        throw err;
      }
    },
    async dispose() {
      // PGlite is single-session: a transaction left open would leak the
      // role and settings into the next request, so make sure none is.
      await pg.exec("RESET ROLE");
    },
  };
}

/** An in-memory stand-in for the R2 bucket binding. */
export class FakeBucket {
  readonly objects = new Map<string, { body: Uint8Array; contentType: string | undefined }>();

  async put(key: string, value: ArrayBuffer, options?: { httpMetadata?: { contentType?: string } }) {
    this.objects.set(key, { body: new Uint8Array(value), contentType: options?.httpMetadata?.contentType });
  }

  async get(key: string) {
    const object = this.objects.get(key);
    if (!object) return null;
    return {
      body: new Blob([object.body]).stream(),
      size: object.body.byteLength,
      httpMetadata: { contentType: object.contentType },
    };
  }

  async delete(keys: string | string[]) {
    for (const key of Array.isArray(keys) ? keys : [keys]) this.objects.delete(key);
  }
}

export interface Harness {
  pg: PGlite;
  bucket: FakeBucket;
  /** Hosts whose /favicon.ico answers with an image; every fetch is recorded. */
  favicons: { hosts: Set<string>; requests: string[] };
  /** Sends raw bytes, as a file upload does. */
  upload(member: Member | null, path: string, bytes: Uint8Array | string, contentType?: string): Promise<{ status: number; body: any }>;
  /** Fetches a file; `bytes` is set on success, `body` on an error. */
  download(member: Member | null, path: string): Promise<{ status: number; headers: Headers; bytes?: Uint8Array; body?: any }>;
  /** Calls the worker as `member` would through the edge. */
  call(member: Member | null, method: string, path: string, body?: unknown): Promise<{ status: number; body: any }>;
  close(): Promise<void>;
}

/** With CRM_TEST_DATABASE_URL set (a Postgres that already has the migration
 *  applied, empty crm tables), requests go through the real driver instead of
 *  PGlite, exactly as on Workers. */
const REAL_DATABASE_URL = process.env["CRM_TEST_DATABASE_URL"];

export interface HarnessOptions {
  /** Stands in for billing-worker: what the plan says for an entitlement
   *  key. Absent, no BILLING_WORKER is bound and the limit is not checked. */
  billing?: (entitlementKey: string, orgPublicId: string) => Response | Promise<Response>;
}

export async function createHarness(members: Member[], options: HarnessOptions = {}): Promise<Harness> {
  const pg = await createDatabase();
  const bySubject = new Map(members.map((m) => [m.subjectId, m]));

  const membership = {
    async fetch(_url: string, init: RequestInit) {
      const { subject, orgId } = JSON.parse(String(init.body)) as { subject: { id: string }; orgId: string };
      const role = bySubject.get(subject.id)?.roles[orgId];
      return json({
        memberships: role ? [{ kind: "role_assignment", role, scope: { kind: "organization", orgId } }] : [],
      });
    },
  } as unknown as Fetcher;

  const policy = {
    async fetch(_url: string, init: RequestInit) {
      const req = JSON.parse(String(init.body)) as {
        action: string;
        resource: { orgId: string };
        context: { memberships: { role: Role; scope: { orgId: string } }[] };
      };
      const allow = req.context.memberships.some(
        (f) => f.scope.orgId === req.resource.orgId && CRM_ACTIONS[f.role].includes(req.action),
      );
      return json({ allow, reason: "test", policyVersion: 1, derivedScope: { orgId: req.resource.orgId } });
    },
  } as unknown as Fetcher;

  const bucket = new FakeBucket();
  const favicons = { hosts: new Set<string>(), requests: [] as string[] };
  const fetcher = async (input: string) => {
    favicons.requests.push(input);
    const host = new URL(input).host;
    return favicons.hosts.has(host)
      ? new Response("icon", { status: 200, headers: { "content-type": "image/x-icon" } })
      : new Response("nope", { status: 404, headers: { "content-type": "text/html" } });
  };

  const env: Env = {
    ENVIRONMENT: "test",
    MEMBERSHIP_WORKER: membership,
    POLICY_WORKER: policy,
    ATTACHMENTS: bucket as unknown as R2Bucket,
    ...(options.billing
      ? {
          BILLING_WORKER: {
            async fetch(_url: string, init: RequestInit) {
              const headers = new Headers(init.headers);
              if (headers.get("x-internal-caller") !== "crm-worker") return new Response("forbidden", { status: 403 });
              const { orgId, entitlementKey } = JSON.parse(String(init.body)) as { orgId: string; entitlementKey: string };
              return options.billing!(entitlementKey, orgId);
            },
          } as unknown as Fetcher,
        }
      : {}),
  };

  const actorHeaders = (member: Member | null) => {
    const headers = new Headers({ "x-request-id": "req_test" });
    if (member) {
      headers.set("x-actor-subject-id", member.subjectId);
      headers.set("x-actor-subject-type", member.subjectType ?? "user");
      headers.set("x-actor-email", member.email);
    }
    return headers;
  };
  const dispatch = (request: Request) =>
    route(request, env, {
      createDb: () =>
        REAL_DATABASE_URL ? createSqlExecutor({ connectionString: REAL_DATABASE_URL }) : executorFor(pg),
      fetcher,
    });

  return {
    pg,
    bucket,
    favicons,
    async upload(member, path, bytes, contentType = "application/octet-stream") {
      const headers = actorHeaders(member);
      headers.set("content-type", contentType);
      const response = await dispatch(new Request(`https://crm.internal${path}`, { method: "POST", headers, body: bytes }));
      return { status: response.status, body: await response.json() };
    },
    async download(member, path) {
      const response = await dispatch(new Request(`https://crm.internal${path}`, { method: "GET", headers: actorHeaders(member) }));
      if (response.status !== 200) return { status: response.status, headers: response.headers, body: await response.json() };
      return { status: 200, headers: response.headers, bytes: new Uint8Array(await response.arrayBuffer()) };
    },
    async call(member, method, path, body) {
      const headers = actorHeaders(member);
      if (body !== undefined) headers.set("content-type", "application/json");
      const init: RequestInit = { method, headers };
      if (body !== undefined) init.body = JSON.stringify(body);
      const request = new Request(`https://crm.internal${path}`, init);
      const response = await dispatch(request);
      return { status: response.status, body: await response.json() };
    },
    close: () => pg.close(),
  };
}

export function orgPublicId(uuid: string): string {
  return `org_${uuid.replace(/-/g, "")}`;
}
