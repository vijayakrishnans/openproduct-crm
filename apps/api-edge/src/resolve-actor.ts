import type { Env } from "./env";
import { errorResponse } from "./http";
import { cacheApiStore, bearerToken, type ActorCacheStore } from "./actor-cache";

export interface ActorInfo {
  subjectId: string;
  subjectType: string;
  email: string;
  orgId?: string;
  /** Set when the bearer is an OAuth access token: a person, for one
   *  organization's CRM only (see oauth-facade.ts). */
  grant?: { kind: "oauth"; orgId: string; scope: string };
}

export interface ActorFailure {
  error: Response;
}

export interface ResolveActorDeps {
  /** Injectable cache store (tests). Defaults to the Cache-API store. */
  cache?: ActorCacheStore;
  /** Accept OAuth access tokens. Only the CRM facade does, and it checks the
   *  organization; every other route refuses them. */
  acceptOAuth?: boolean;
}

function refuseOAuth(info: ActorInfo, deps: ResolveActorDeps | undefined, requestId: string): ActorFailure | null {
  if (!info.grant || deps?.acceptOAuth) return null;
  return {
    error: errorResponse("unauthenticated", "This access token only works with the CRM's MCP server", 401, requestId),
  };
}

/**
 * Resolves bearer token to actor context via IDENTITY_WORKER /v1/auth/resolve.
 * Supports both user sessions (sps_ses_ tokens) and API keys (service_principal).
 *
 * Hot-path cache (Task 0131 / PERF2): a successful resolution is cached by a
 * hash of the token for a short TTL, so repeat requests skip the identity-worker
 * hop + its DB queries. Misses and failures fall through to a live resolve.
 */
export async function resolveActor(
  request: Request,
  env: Env,
  requestId: string,
  deps?: ResolveActorDeps,
): Promise<ActorInfo | ActorFailure> {
  const authorization = request.headers.get("authorization");
  const token = bearerToken(authorization);
  if (!authorization || !token) {
    return {
      error: errorResponse("unauthenticated", "Missing or invalid Authorization header", 401, requestId),
    };
  }

  if (!env.IDENTITY_WORKER) {
    return {
      error: errorResponse("internal_error", "Authentication service unavailable", 503, requestId),
    };
  }

  const cache = deps?.cache ?? cacheApiStore();
  const cached = await cache.get(token);
  if (cached) return refuseOAuth(cached, deps, requestId) ?? cached;

  const headers = new Headers();
  headers.set("authorization", authorization);
  headers.set("x-request-id", requestId);

  const target = new URL("/v1/auth/resolve", "https://identity.internal");

  try {
    const response = await env.IDENTITY_WORKER.fetch(target.toString(), {
      method: "GET",
      headers,
    });

    if (!response.ok) {
      return {
        error: errorResponse("unauthenticated", "Authentication failed", 401, requestId),
      };
    }

    const json = (await response.json()) as {
      data?: {
        actor?: {
          actorType?: string;
          actorId?: string;
          email?: string;
          orgId?: string;
        };
        grant?: { kind?: string; orgId?: string; scope?: string };
        user?: { id?: string; email?: string };
      };
    };

    const actor = json?.data?.actor;
    if (!actor?.actorType || !actor?.actorId) {
      return {
        error: errorResponse("unauthenticated", "Authentication failed", 401, requestId),
      };
    }

    // For user actors, prefer user-level email; for service_principal, use actor email or empty
    const email = json?.data?.user?.email ?? actor.email ?? "";

    const info: ActorInfo = {
      subjectId: actor.actorId,
      subjectType: actor.actorType,
      email,
      ...(actor.orgId && { orgId: actor.orgId }),
    };
    const grant = json?.data?.grant;
    if (grant?.kind === "oauth" && grant.orgId) {
      info.grant = { kind: "oauth", orgId: grant.orgId, scope: grant.scope ?? "" };
    }
    // Cache only successful resolutions (best-effort; never cache a denial).
    await cache.set(token, info);
    return refuseOAuth(info, deps, requestId) ?? info;
  } catch {
    return {
      error: errorResponse("internal_error", "Authentication service unavailable", 503, requestId),
    };
  }
}
