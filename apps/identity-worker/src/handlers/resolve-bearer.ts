import type { Env } from "../env.js";
import { createSqlExecutor } from "@saas/db/hyperdrive";
import { createIdentityRepository } from "@saas/db/identity";
import { createAuthService } from "../services/auth.js";
import { successResponse, errorResponse, extractBearerToken, withTimings } from "../http.js";
import { createTimings } from "@saas/contracts/timing";
import { resolveOAuthAccessToken } from "../oauth-server/handlers.js";
import { createOAuthStore } from "../oauth-server/store.js";

export async function handleResolveBearer(request: Request, env: Env, requestId: string): Promise<Response> {
  const token = extractBearerToken(request);
  if (!token) {
    return errorResponse("unauthenticated", "Missing or invalid Authorization header", 401, requestId);
  }

  if (!env.PLATFORM_DB) {
    return errorResponse("internal_error", "Database not configured", 503, requestId);
  }

  const executor = createSqlExecutor(env.PLATFORM_DB);
  // PERF14b: the `resolve` phase times the DB-backed resolution (a single
  // JOINed query since PERF12d) — the cost of every edge bearer-cache miss.
  const timings = createTimings();
  const endTotal = timings.start("total");
  const route = "identity.resolve";
  try {
    // An OAuth access token (an MCP client acting for a person) resolves to
    // that person, with the one organization it was granted for. api-edge
    // only accepts it on that organization's CRM.
    const oauth = await timings.measure("resolve", () =>
      resolveOAuthAccessToken(token, createOAuthStore(executor), new Date()),
    );
    if (oauth) {
      endTotal();
      if ("error" in oauth) {
        return withTimings(errorResponse("unauthenticated", "Invalid or expired access token", 401, requestId), requestId, route, timings);
      }
      return withTimings(successResponse(
        {
          actor: {
            actorType: "user",
            actorId: oauth.actorId,
            email: oauth.email,
            ...(oauth.displayName !== null && { displayName: oauth.displayName }),
          },
          grant: { kind: "oauth", orgId: oauth.orgId, scope: oauth.scope },
          user: { id: oauth.actorId, email: oauth.email, displayName: oauth.displayName },
        },
        requestId,
        200,
      ), requestId, route, timings);
    }

    const repo = createIdentityRepository(executor);
    const auth = createAuthService({ repo, now: () => new Date() });
    const result = await timings.measure("resolve", () => auth.resolveBearer(token));
    endTotal();

    if ("error" in result) {
      return withTimings(errorResponse(result.error, result.message, 401, requestId), requestId, route, timings);
    }

    return withTimings(successResponse(
      {
        actor: {
          actorType: result.actorType,
          actorId: result.actorId,
          ...(result.orgId !== undefined && { orgId: result.orgId }),
          ...(result.projectId !== undefined && { projectId: result.projectId }),
          ...(result.displayName !== undefined && { displayName: result.displayName }),
          ...(result.email !== undefined && { email: result.email }),
        },
        ...(result.session && {
          session: {
            id: result.session.id,
            expiresAt: result.session.expiresAt.toISOString(),
            createdAt: result.session.createdAt.toISOString(),
          },
        }),
        ...(result.user && { user: result.user }),
      },
      requestId,
      200,
    ), requestId, route, timings);
  } catch {
    return errorResponse("internal_error", "An unexpected error occurred", 500, requestId);
  } finally {
    await executor.dispose();
  }
}
