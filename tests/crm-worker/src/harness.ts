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
const MIGRATION = resolve(__dirname, "../../..", "packages/db/src/migrations/200_crm_core/up.sql");

export type Role = "owner" | "admin" | "builder" | "viewer" | "billing_admin";

export interface Member {
  subjectId: string;
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
  await pg.exec(readFileSync(MIGRATION, "utf-8"));
  return pg;
}

export function executorFor(pg: PGlite): Db {
  const execute = async <T extends SqlRow = SqlRow>(text: string, params?: unknown[]) => {
    // The production driver (postgres.js) re-encodes a parameter by the type
    // Postgres infers for it: a JSON string bound to $n::jsonb is stringified
    // again, "true" bound to $n::boolean becomes false. The worker therefore
    // binds text only and casts in SQL; hold it to that here.
    for (const param of params ?? []) {
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

export interface Harness {
  pg: PGlite;
  /** Calls the worker as `member` would through the edge. */
  call(member: Member | null, method: string, path: string, body?: unknown): Promise<{ status: number; body: any }>;
  close(): Promise<void>;
}

/** With CRM_TEST_DATABASE_URL set (a Postgres that already has the migration
 *  applied, empty crm tables), requests go through the real driver instead of
 *  PGlite, exactly as on Workers. */
const REAL_DATABASE_URL = process.env["CRM_TEST_DATABASE_URL"];

export async function createHarness(members: Member[]): Promise<Harness> {
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

  const env: Env = { ENVIRONMENT: "test", MEMBERSHIP_WORKER: membership, POLICY_WORKER: policy };

  return {
    pg,
    async call(member, method, path, body) {
      const headers = new Headers({ "x-request-id": "req_test" });
      if (member) {
        headers.set("x-actor-subject-id", member.subjectId);
        headers.set("x-actor-subject-type", "user");
        headers.set("x-actor-email", member.email);
      }
      if (body !== undefined) headers.set("content-type", "application/json");
      const init: RequestInit = { method, headers };
      if (body !== undefined) init.body = JSON.stringify(body);
      const request = new Request(`https://crm.internal${path}`, init);
      const response = await route(request, env, {
        createDb: () =>
          REAL_DATABASE_URL ? createSqlExecutor({ connectionString: REAL_DATABASE_URL }) : executorFor(pg),
      });
      return { status: response.status, body: await response.json() };
    },
    close: () => pg.close(),
  };
}

export function orgPublicId(uuid: string): string {
  return `org_${uuid.replace(/-/g, "")}`;
}
