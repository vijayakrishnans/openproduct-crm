import type { SqlExecutor, SqlRow, TransactionalSqlExecutor } from "@saas/db/hyperdrive";
import type { Uuid } from "@saas/db/ids";

export type Db = TransactionalSqlExecutor & { dispose(): Promise<void> };

export interface OrgScope {
  orgId: Uuid;
  subjectId: string;
}

/**
 * Runs `fn` the only way crm-worker touches the database: inside one
 * transaction, as the crm_app role (no BYPASSRLS), with the request's org and
 * actor set for that transaction only. The row-level policies of the crm
 * schema then admit that org's rows and nothing else — on top of the org_id
 * predicate every statement carries itself.
 */
export async function withOrg<T>(
  db: Db,
  scope: OrgScope,
  fn: (tx: SqlExecutor) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute("SET LOCAL ROLE crm_app");
    await tx.execute(
      "SELECT set_config('app.org_id', $1::text, true), set_config('app.subject_id', $2::text, true)",
      [scope.orgId, scope.subjectId],
    );
    return fn(tx);
  });
}

/** Rows are selected as one jsonb document each, so both drivers hand back the
 *  same shapes (numbers for bigint ids, arrays for arrays, ISO timestamps). */
export function documents(rows: SqlRow[]): Record<string, unknown>[] {
  return rows.map((r) => {
    const doc = r["doc"];
    return (typeof doc === "string" ? JSON.parse(doc) : doc) as Record<string, unknown>;
  });
}

export const DOC = "to_jsonb(t) - 'fts' - 'org_id' AS doc";

/** SQLSTATE of a driver error, if it has one. */
export function sqlState(err: unknown): string | null {
  if (err && typeof err === "object" && "code" in err) {
    const code = (err as { code: unknown }).code;
    if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return code;
  }
  return null;
}
