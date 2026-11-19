// The OAuth 2.1 authorization server for the CRM's MCP server.
//
//   POST /v1/oauth/register           RFC 7591 dynamic registration (public clients)
//   GET  /v1/oauth/clients/:id        what the consent page shows; checks the redirect URI
//   POST /v1/oauth/authorize          the consent page's approval, made with the
//                                     person's BrokeCRM session; returns the redirect
//   POST /v1/oauth/token              authorization_code (PKCE S256) and refresh_token
//
// The authorization endpoint people see is a page of the CRM web app
// (/oauth/authorize), which signs the person in and posts the approval here.
// Tokens act as that person, in the one organization they approved, and only
// on that organization's CRM: api-edge refuses them anywhere else.
import { createSqlExecutor } from "@saas/db/hyperdrive";
import { createIdentityRepository } from "@saas/db/identity";
import { hashSha256 } from "../crypto.js";
import type { Env } from "../env.js";
import { errorResponse, extractBearerToken, successResponse, validationError } from "../http.js";
import { parseOrgPublicId, parseUserPublicId, userPublicId } from "../ids.js";
import { fetchAuthorizationContext } from "../membership-client.js";
import { createAuthService } from "../services/auth.js";
import {
  ACCESS_TOKEN_PREFIX,
  ACCESS_TTL_SECONDS,
  CODE_TTL_SECONDS,
  REFRESH_TOKEN_PREFIX,
  REFRESH_TTL_SECONDS,
  SCOPE,
  isValidCodeChallenge,
  newClientId,
  orgFromResource,
  parseRegistration,
  randomSecret,
  verifyPkce,
} from "./protocol.js";
import { createOAuthStore, type OAuthStore } from "./store.js";

export interface OAuthDeps {
  store: OAuthStore;
  now?: () => Date;
  /** The signed-in person behind a BrokeCRM session token, or null. */
  resolveSessionUser?: (token: string) => Promise<{ userId: string } | null>;
  /** Whether that person holds a role in the organization (public ids). */
  isMember?: (userPublicId: string, orgPublicId: string, requestId: string) => Promise<boolean>;
}

/** RFC 6749 §5.2 error body; never cached. */
function oauthError(error: string, description: string, status = 400): Response {
  return Response.json(
    { error, error_description: description },
    { status, headers: { "cache-control": "no-store", pragma: "no-cache" } },
  );
}

function oauthJson(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store", pragma: "no-cache" } });
}

/** Runs `fn` with injected deps, or with a store on a fresh connection. */
async function withStore(
  env: Env,
  deps: OAuthDeps | undefined,
  requestId: string,
  fn: (deps: OAuthDeps) => Promise<Response>,
): Promise<Response> {
  if (deps) return fn(deps);
  if (!env.PLATFORM_DB) return errorResponse("internal_error", "Database not configured", 503, requestId);
  const executor = createSqlExecutor(env.PLATFORM_DB);
  try {
    const auth = createAuthService({ repo: createIdentityRepository(executor), now: () => new Date() });
    return await fn({
      store: createOAuthStore(executor),
      resolveSessionUser: async (token) => {
        const result = await auth.resolveBearer(token);
        // A BrokeCRM session only: neither an API key nor another OAuth token.
        if ("error" in result || result.actorType !== "user" || !result.session) return null;
        const userId = parseUserPublicId(result.actorId);
        return userId ? { userId } : null;
      },
      isMember: async (subject, orgPublicId, rid) => {
        const orgUuid = parseOrgPublicId(orgPublicId);
        if (!orgUuid || !env.MEMBERSHIP_WORKER) return false;
        const context = await fetchAuthorizationContext(env.MEMBERSHIP_WORKER, subject, "user", orgUuid, rid);
        return (
          context.ok &&
          context.memberships.some(
            (f) => f?.kind === "role_assignment" && f.scope?.kind === "organization" && f.scope.orgId === orgUuid,
          )
        );
      },
    });
  } catch {
    return errorResponse("internal_error", "An unexpected error occurred", 500, requestId);
  } finally {
    await executor.dispose();
  }
}

export async function handleOAuthRegister(
  request: Request,
  env: Env,
  requestId: string,
  deps?: OAuthDeps,
): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return oauthError("invalid_client_metadata", "The body must be JSON");
  }
  const parsed = parseRegistration(body);
  if ("error" in parsed) return oauthError(parsed.error, parsed.description);

  return withStore(env, deps, requestId, async ({ store, now }) => {
    const createdAt = now ? now() : new Date();
    const clientId = newClientId();
    await store.createClient({ clientId, clientName: parsed.clientName, redirectUris: parsed.redirectUris, createdAt });
    return oauthJson(
      {
        client_id: clientId,
        client_id_issued_at: Math.floor(createdAt.getTime() / 1000),
        client_name: parsed.clientName,
        redirect_uris: parsed.redirectUris,
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
        scope: SCOPE,
      },
      201,
    );
  });
}

/** For the consent page: the client's name, once its redirect URI checks out.
 *  An unknown client or redirect URI must not be redirected to at all. */
export async function handleOAuthClientInfo(
  request: Request,
  env: Env,
  requestId: string,
  clientId: string,
  deps?: OAuthDeps,
): Promise<Response> {
  const redirectUri = new URL(request.url).searchParams.get("redirect_uri") ?? "";
  return withStore(env, deps, requestId, async ({ store }) => {
    const client = await store.getClient(clientId);
    if (!client) return errorResponse("not_found", "This app is not registered with BrokeCRM", 404, requestId);
    if (!client.redirectUris.includes(redirectUri)) {
      return validationError(requestId, { redirect_uri: ["This address is not registered for the app"] });
    }
    return successResponse({ client: { id: client.clientId, name: client.clientName } }, requestId);
  });
}

export async function handleOAuthAuthorize(
  request: Request,
  env: Env,
  requestId: string,
  deps?: OAuthDeps,
): Promise<Response> {
  const token = extractBearerToken(request);
  if (!token) return errorResponse("unauthenticated", "Sign in to BrokeCRM first", 401, requestId);

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return errorResponse("bad_request", "Invalid JSON body", 400, requestId);
  }
  const clientId = typeof body["client_id"] === "string" ? body["client_id"] : "";
  const redirectUri = typeof body["redirect_uri"] === "string" ? body["redirect_uri"] : "";
  const challenge = body["code_challenge"];
  const method = body["code_challenge_method"] ?? "S256";
  const state = typeof body["state"] === "string" ? body["state"] : null;
  const resource = typeof body["resource"] === "string" && body["resource"] ? body["resource"] : null;
  const orgId = typeof body["org_id"] === "string" ? body["org_id"] : "";
  const scope = typeof body["scope"] === "string" && body["scope"].trim() ? body["scope"].trim() : SCOPE;

  const fields: Record<string, string[]> = {};
  if (body["response_type"] !== undefined && body["response_type"] !== "code") fields["response_type"] = ["Only code is supported"];
  if (method !== "S256" || !isValidCodeChallenge(challenge)) fields["code_challenge"] = ["A PKCE S256 code_challenge is required"];
  if (scope.split(/\s+/).some((s) => s !== SCOPE)) fields["scope"] = [`Only the "${SCOPE}" scope exists`];
  if (!parseOrgPublicId(orgId)) fields["org_id"] = ["Choose an organization"];
  const resourceOrg = orgFromResource(resource);
  if (resource && resourceOrg && resourceOrg !== orgId) fields["org_id"] = ["The app asked for another organization"];
  if (Object.keys(fields).length > 0) return validationError(requestId, fields);

  return withStore(env, deps, requestId, async ({ store, now, resolveSessionUser, isMember }) => {
    const client = await store.getClient(clientId);
    if (!client || !client.redirectUris.includes(redirectUri)) {
      return errorResponse("not_found", "This app is not registered with BrokeCRM", 404, requestId);
    }
    const user = resolveSessionUser ? await resolveSessionUser(token) : null;
    if (!user) return errorResponse("unauthenticated", "Sign in to BrokeCRM first", 401, requestId);
    if (!isMember || !(await isMember(userPublicId(user.userId), orgId, requestId))) {
      return errorResponse("not_found", "Organization not found", 404, requestId);
    }

    const at = now ? now() : new Date();
    const code = randomSecret();
    await store.createCode({
      codeHash: await hashSha256(code),
      clientId,
      userId: user.userId,
      orgId,
      redirectUri,
      codeChallenge: challenge as string,
      scope,
      resource,
      expiresAt: new Date(at.getTime() + CODE_TTL_SECONDS * 1000),
    });
    const target = new URL(redirectUri);
    target.searchParams.set("code", code);
    if (state !== null) target.searchParams.set("state", state);
    return successResponse({ redirectTo: target.toString() }, requestId);
  });
}

async function readForm(request: Request): Promise<Record<string, string>> {
  const type = request.headers.get("content-type") ?? "";
  if (type.includes("application/json")) {
    const json = (await request.json()) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(json).filter(([, v]) => typeof v === "string")) as Record<string, string>;
  }
  const form: Record<string, string> = {};
  new URLSearchParams(await request.text()).forEach((value, key) => {
    form[key] = value;
  });
  return form;
}

export async function handleOAuthToken(
  request: Request,
  env: Env,
  requestId: string,
  deps?: OAuthDeps,
): Promise<Response> {
  let form: Record<string, string>;
  try {
    form = await readForm(request);
  } catch {
    return oauthError("invalid_request", "Unreadable body");
  }
  const grant = form["grant_type"];
  if (grant !== "authorization_code" && grant !== "refresh_token") {
    return oauthError("unsupported_grant_type", "Use authorization_code or refresh_token");
  }
  const clientId = form["client_id"] ?? "";

  return withStore(env, deps, requestId, async ({ store, now }) => {
    const at = now ? now() : new Date();
    const client = clientId ? await store.getClient(clientId) : null;
    if (!client) return oauthError("invalid_client", "Unknown client_id", 401);

    let grantTo: { userId: string; orgId: string; scope: string };
    if (grant === "authorization_code") {
      const code = await store.consumeCode(await hashSha256(form["code"] ?? ""), at);
      if (!code || code.clientId !== clientId) return oauthError("invalid_grant", "The code is invalid, used or expired");
      if ((form["redirect_uri"] ?? code.redirectUri) !== code.redirectUri) {
        return oauthError("invalid_grant", "redirect_uri does not match the authorization");
      }
      if (!(await verifyPkce(form["code_verifier"], code.codeChallenge))) {
        return oauthError("invalid_grant", "PKCE verification failed");
      }
      grantTo = code;
    } else {
      const previous = await store.consumeRefreshToken(await hashSha256(form["refresh_token"] ?? ""), at);
      if (!previous || previous.clientId !== clientId) {
        return oauthError("invalid_grant", "The refresh token is invalid, used or expired");
      }
      grantTo = previous;
    }

    const accessToken = ACCESS_TOKEN_PREFIX + randomSecret();
    const refreshToken = REFRESH_TOKEN_PREFIX + randomSecret();
    await store.createTokens({
      id: crypto.randomUUID(),
      accessTokenHash: await hashSha256(accessToken),
      refreshTokenHash: await hashSha256(refreshToken),
      clientId,
      userId: grantTo.userId,
      orgId: grantTo.orgId,
      scope: grantTo.scope,
      accessExpiresAt: new Date(at.getTime() + ACCESS_TTL_SECONDS * 1000),
      refreshExpiresAt: new Date(at.getTime() + REFRESH_TTL_SECONDS * 1000),
    });
    return oauthJson({
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: ACCESS_TTL_SECONDS,
      refresh_token: refreshToken,
      scope: grantTo.scope,
    });
  });
}

/** Resolves an OAuth access token for /v1/auth/resolve, or null if it is not one. */
export async function resolveOAuthAccessToken(
  token: string,
  store: OAuthStore,
  now: Date,
): Promise<
  | null
  | { error: true }
  | { actorId: string; email: string; displayName: string | null; orgId: string; scope: string }
> {
  if (!token.startsWith(ACCESS_TOKEN_PREFIX)) return null;
  const grant = await store.resolveAccessToken(await hashSha256(token), now);
  if (!grant) return { error: true };
  return {
    actorId: userPublicId(grant.userId),
    email: grant.email,
    displayName: grant.displayName,
    orgId: grant.orgId,
    scope: grant.scope,
  };
}
