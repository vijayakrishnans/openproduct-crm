import { createSqlExecutor } from "@saas/db/hyperdrive";
import type { Uuid } from "@saas/db/ids";
import { handleDownload, handleUpload } from "./attachments.js";
import { authorize, type Actor, type CrmAction } from "./authz.js";
import { sqlState, withOrg, type Db } from "./db.js";
import type { Env } from "./env.js";
import type { Fetch } from "./favicons.js";
import {
  clientErrorFor,
  handleCreate,
  handleDashboard,
  handleDelete,
  handleGet,
  handleList,
  handleMe,
  handleMergeContacts,
  handleSearch,
  handleUpdate,
  readBody,
  type Ctx,
} from "./handlers.js";
import { errorResponse, forbidden, methodNotAllowed, notFound, successResponse } from "./http.js";
import { generateRequestId, parseOrgPublicId, parseRecordId } from "./ids.js";
import { handleMcp } from "./mcp.js";
import { RESOURCES, type ResourceDef } from "./resources.js";

const REQUEST_ID_RE = /^[\w-]{1,128}$/;
const CRM_RE = /^\/v1\/organizations\/([^/]+)\/crm(?:\/(.*))?$/;

export interface RouteDeps {
  /** Tests hand in a database; production opens one per request from Hyperdrive. */
  createDb?: (env: Env) => Db | null;
  /** Outbound fetch for favicons; tests hand in a fake, or null for none. */
  fetcher?: Fetch | null;
}

type Operation =
  | { kind: "me" }
  | { kind: "search" }
  | { kind: "dashboard" }
  | { kind: "merge" }
  | { kind: "upload" }
  | { kind: "mcp" }
  | { kind: "download"; path: string }
  | { kind: "list"; def: ResourceDef }
  | { kind: "create"; def: ResourceDef }
  | { kind: "get"; def: ResourceDef; id: string }
  | { kind: "update"; def: ResourceDef; id: string }
  | { kind: "delete"; def: ResourceDef; id: string };

type Match = { op: Operation; action: CrmAction } | "not_found" | "method_not_allowed";

const READ: CrmAction = "organization.crm.read";
const WRITE: CrmAction = "organization.crm.write";

function matchOperation(method: string, rest: string): Match {
  const segments = rest.split("/").filter((s) => s.length > 0);
  const [first, second, ...more] = segments;
  if (!first) return "not_found";

  // /attachments (upload) and /attachments/<uuid>/<file name> (download)
  if (first === "attachments") {
    if (!second) return method === "POST" ? { op: { kind: "upload" }, action: WRITE } : "method_not_allowed";
    if (more.length !== 1) return "not_found";
    let name: string;
    try {
      name = decodeURIComponent(more[0]!);
    } catch {
      return "not_found";
    }
    return method === "GET" ? { op: { kind: "download", path: `${second}/${name}` }, action: READ } : "method_not_allowed";
  }

  if (more.length > 0) return "not_found";

  if (!second) {
    // The MCP endpoint: one JSON-RPC message per POST. No server-sent stream.
    if (first === "mcp") return method === "POST" ? { op: { kind: "mcp" }, action: READ } : "method_not_allowed";
    if (first === "search") return method === "GET" ? { op: { kind: "search" }, action: READ } : "method_not_allowed";
    if (first === "dashboard") return method === "GET" ? { op: { kind: "dashboard" }, action: READ } : "method_not_allowed";
    const def = RESOURCES.get(first);
    if (!def) return "not_found";
    if (method === "GET") return { op: { kind: "list", def }, action: READ };
    if (method === "POST") return def.can.create ? { op: { kind: "create", def }, action: WRITE } : "method_not_allowed";
    return "method_not_allowed";
  }

  if (first === "sales" && second === "me") {
    return method === "GET" ? { op: { kind: "me" }, action: READ } : "method_not_allowed";
  }
  if (first === "contacts" && second === "merge") {
    return method === "POST" ? { op: { kind: "merge" }, action: WRITE } : "method_not_allowed";
  }

  const def = RESOURCES.get(first);
  if (!def) return "not_found";
  const id = parseRecordId(second);
  if (!id || def.idType !== "bigint") return "not_found";

  if (method === "GET") return def.can.get ? { op: { kind: "get", def, id }, action: READ } : "method_not_allowed";
  if (method === "PUT" || method === "PATCH") {
    return def.can.update ? { op: { kind: "update", def, id }, action: WRITE } : "method_not_allowed";
  }
  if (method === "DELETE") return def.can.delete ? { op: { kind: "delete", def, id }, action: WRITE } : "method_not_allowed";
  return "method_not_allowed";
}

function resolveRequestId(request: Request): string {
  const header = request.headers.get("x-request-id");
  if (header && REQUEST_ID_RE.test(header)) return header;
  return generateRequestId();
}

function resolveActor(request: Request): Actor | null {
  const subjectId = request.headers.get("x-actor-subject-id");
  const subjectType = request.headers.get("x-actor-subject-type");
  if (!subjectId || !subjectType) return null;
  return { subjectId, subjectType, email: request.headers.get("x-actor-email") };
}

function health(env: Env, requestId: string): Response {
  return successResponse(
    {
      status: "ok",
      service: "crm-worker",
      environment: env.ENVIRONMENT ?? "local",
      timestamp: new Date().toISOString(),
      checks: {
        database: { configured: !!env.PLATFORM_DB },
        attachments: { configured: !!env.ATTACHMENTS },
        membership: { configured: !!env.MEMBERSHIP_WORKER },
        policy: { configured: !!env.POLICY_WORKER },
      },
    },
    requestId,
  );
}

async function run(op: Operation, ctx: Ctx, request: Request, url: URL): Promise<Response> {
  switch (op.kind) {
    case "me":
      return handleMe(ctx);
    case "search":
      return handleSearch(ctx, url.searchParams);
    case "dashboard":
      return handleDashboard(ctx);
    case "merge":
      return handleMergeContacts(ctx, await readBody(request));
    case "mcp":
    case "upload":
    case "download":
      // Served without a database transaction; see route().
      return notFound(ctx.requestId);
    case "list":
      return handleList(ctx, op.def, url.searchParams);
    case "create":
      return handleCreate(ctx, op.def, await readBody(request));
    case "get":
      return handleGet(ctx, op.def, op.id);
    case "update":
      return handleUpdate(ctx, op.def, op.id, await readBody(request));
    case "delete":
      return handleDelete(ctx, op.def, op.id);
  }
}

/** A response that is not a success rolls the transaction back, so a handler
 *  that returns 4xx half-way leaves nothing behind. */
class Rollback extends Error {
  constructor(readonly response: Response) {
    super("rollback");
  }
}

export async function route(request: Request, env: Env, deps: RouteDeps = {}): Promise<Response> {
  const url = new URL(request.url);
  const requestId = resolveRequestId(request);

  try {
    if (url.pathname === "/health" && request.method === "GET") return health(env, requestId);

    const crm = url.pathname.match(CRM_RE);
    if (!crm) return notFound(requestId);

    const actor = resolveActor(request);
    if (!actor) return errorResponse("unauthenticated", "Authentication required", 401, requestId);

    const orgId: Uuid | null = parseOrgPublicId(crm[1]!);
    if (!orgId) return notFound(requestId);

    const match = matchOperation(request.method, crm[2] ?? "");

    // Membership is settled before anything else is revealed: to someone
    // outside the org every path under it answers 404, whatever the method.
    const action = typeof match === "string" ? READ : match.action;
    const access = await authorize(env, actor, orgId, action, requestId);
    if (access.kind === "not_member") return notFound(requestId);
    if (match === "not_found") return notFound(requestId);
    if (match === "method_not_allowed") return methodNotAllowed(requestId);
    if (access.kind === "denied") return forbidden(requestId);

    // Files go straight to and from R2; the path a client gives is always
    // read under its own organization's prefix.
    if (match.op.kind === "upload" || match.op.kind === "download") {
      if (!env.ATTACHMENTS) return errorResponse("internal_error", "Service unavailable", 503, requestId);
      return match.op.kind === "upload"
        ? await handleUpload(request, env.ATTACHMENTS, orgId, requestId)
        : await handleDownload(env.ATTACHMENTS, orgId, match.op.path, requestId);
    }

    const fetcher: Fetch | undefined =
      deps.fetcher === null ? undefined : (deps.fetcher ?? ((input, init) => fetch(input, init)));

    /** Runs `work` in one transaction for this organization. A response that
     *  is not a success rolls it back; file deletions wait for the commit. */
    const transact = async (work: (ctx: Ctx) => Promise<Response>): Promise<Response> => {
      const db = deps.createDb ? deps.createDb(env) : env.PLATFORM_DB ? createSqlExecutor(env.PLATFORM_DB) : null;
      if (!db) return errorResponse("internal_error", "Service unavailable", 503, requestId);
      const afterCommit: (() => Promise<void>)[] = [];
      try {
        const response = await withOrg(db, { orgId, subjectId: actor.subjectId }, async (tx) => {
          const ctx: Ctx = {
            tx,
            scope: { orgId, subjectId: actor.subjectId },
            actor,
            isAdmin: access.isAdmin,
            requestId,
            bucket: env.ATTACHMENTS,
            fetcher,
            afterCommit,
          };
          const response = await work(ctx);
          if (!response.ok) throw new Rollback(response);
          return response;
        });
        // The records are gone for good; a file that fails to delete is only
        // an orphan in the bucket, never a reason to fail the request.
        for (const task of afterCommit) {
          try {
            await task();
          } catch {
            // eslint-disable-next-line no-console -- surfaced in Workers Logs
            console.error(JSON.stringify({ level: "error", msg: "crm.attachment_cleanup_failed", requestId }));
          }
        }
        return response;
      } catch (err) {
        if (err instanceof Rollback) return err.response;
        const clientError = clientErrorFor(sqlState(err), requestId);
        if (clientError) return clientError;
        throw err;
      } finally {
        await db.dispose();
      }
    };

    if (match.op.kind === "mcp") {
      return await handleMcp(request, {
        transact,
        canWrite: async () => (await authorize(env, actor, orgId, WRITE, requestId)).kind === "allowed",
      });
    }

    const op = match.op;
    return await transact((ctx) => run(op, ctx, request, url));
  } catch {
    return errorResponse("internal_error", "An unexpected error occurred", 500, requestId);
  }
}
