import type { Env } from "./env.js";
import { errorResponse, withEdgeTimings } from "./http.js";
import { replayOrExecute } from "./idempotency.js";
import { resolveActor } from "./resolve-actor.js";
import { createTimings } from "@saas/contracts/timing";

// Everything under an org's /crm goes to crm-worker, which owns the routes
// below it (resources, search, merge, dashboard). The edge authenticates,
// rate-limits, replays idempotent writes and hands over the actor; the worker
// decides membership and answers 404 for anything outside the caller's org.
const CRM_RE = /^\/v1\/organizations\/[^/]+\/crm(?:\/.*)?$/;

const METHODS: ReadonlySet<string> = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);
const BODY_METHODS: ReadonlySet<string> = new Set(["POST", "PUT", "PATCH"]);

const FORWARDED_HEADERS = ["content-type", "traceparent", "idempotency-key"];

export function isCrmRoute(pathname: string): boolean {
  return CRM_RE.test(pathname);
}

export async function handleCrmRoute(
  request: Request,
  env: Env,
  requestId: string,
  pathname: string,
): Promise<Response> {
  if (!METHODS.has(request.method)) {
    return errorResponse("unsupported", "Method not allowed", 405, requestId);
  }

  return replayOrExecute(request, requestId, env, "crm", async () => {
    if (!env.IDENTITY_WORKER) {
      return errorResponse("internal_error", "Authentication service unavailable", 503, requestId);
    }
    if (!env.CRM_WORKER) {
      return errorResponse("internal_error", "CRM service unavailable", 503, requestId);
    }

    const timings = createTimings();
    const endTotal = timings.start("edge_total");
    const actor = await timings.measure("edge_auth", () => resolveActor(request, env, requestId));
    if ("error" in actor) {
      return actor.error;
    }

    // Actor headers are set here and nowhere else: whatever a client sends
    // under these names is dropped, because only FORWARDED_HEADERS are copied.
    const headers = new Headers();
    headers.set("x-request-id", requestId);
    headers.set("x-actor-subject-id", actor.subjectId);
    headers.set("x-actor-subject-type", actor.subjectType);
    if (actor.email) headers.set("x-actor-email", actor.email);
    for (const name of FORWARDED_HEADERS) {
      const value = request.headers.get(name);
      if (value) headers.set(name, value);
    }

    const url = new URL(request.url);
    const target = new URL(pathname + url.search, "https://crm.internal");
    const init: RequestInit = { method: request.method, headers };
    if (BODY_METHODS.has(request.method)) {
      init.body = request.body;
    }

    try {
      const downstream = await timings.measure("edge_downstream", () =>
        env.CRM_WORKER!.fetch(target.toString(), init),
      );
      const res = new Response(downstream.body, {
        status: downstream.status,
        headers: downstream.headers,
      });
      endTotal();
      return withEdgeTimings(res, requestId, "edge.crm", timings);
    } catch {
      return errorResponse("internal_error", "CRM service unavailable", 503, requestId);
    }
  });
}
