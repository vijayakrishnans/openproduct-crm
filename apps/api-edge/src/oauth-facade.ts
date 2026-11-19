import { crmWebWorkersDevOrigin } from "./app-config";
import type { Env } from "./env";
import { errorResponse } from "./http";

// OAuth 2.1 for the CRM's MCP server, so that an MCP client (Claude's
// connectors, for one) can sign a person in instead of being handed an API
// key. The metadata documents are answered here, because they describe this
// host; the endpoints themselves belong to identity-worker. The page where
// the person approves access is the CRM web app's /oauth/authorize.
//
//   /.well-known/oauth-protected-resource[/<resource path>]   RFC 9728
//   /.well-known/oauth-authorization-server[/<issuer path>]   RFC 8414
//   /v1/oauth/register | token | authorize | clients/:id      identity-worker

const PROTECTED_RESOURCE = "/.well-known/oauth-protected-resource";
const AUTHORIZATION_SERVER = "/.well-known/oauth-authorization-server";
const MCP_PATH_RE = /^\/v1\/organizations\/org_[0-9a-f]{32}\/crm\/mcp$/;

/**
 * The MCP server's one address for everyone: `<host>/mcp`. It names no
 * organization; the credential does. An OAuth token carries the organization
 * its owner chose when approving the client, and an API key belongs to one.
 * The per-organization paths above keep working beside it.
 */
export const GENERAL_MCP_PATH = "/mcp";
const IDENTITY_ROUTES: Record<string, string> = {
  "/v1/oauth/register": "POST",
  "/v1/oauth/token": "POST",
  "/v1/oauth/authorize": "POST",
};
const CLIENT_RE = /^\/v1\/oauth\/clients\/[^/]+$/;

export const OAUTH_SCOPE = "crm";

export function isMcpPath(pathname: string): boolean {
  return pathname === GENERAL_MCP_PATH || MCP_PATH_RE.test(pathname);
}

/** The per-organization MCP path the general address stands for. */
export function mcpPathForOrg(orgId: string): string {
  return `/v1/organizations/${orgId}/crm/mcp`;
}

export function isOAuthServerRoute(pathname: string): boolean {
  return (
    pathname === PROTECTED_RESOURCE ||
    pathname.startsWith(`${PROTECTED_RESOURCE}/`) ||
    pathname === AUTHORIZATION_SERVER ||
    pathname.startsWith(`${AUTHORIZATION_SERVER}/`) ||
    pathname in IDENTITY_ROUTES ||
    CLIENT_RE.test(pathname)
  );
}

/** Where people approve access: the CRM web app of this environment. */
export function crmWebOrigin(env: Env): string {
  return env.CRM_WEB_CUSTOM_DOMAIN
    ? `https://${env.CRM_WEB_CUSTOM_DOMAIN}`
    : crmWebWorkersDevOrigin(env.ENVIRONMENT ?? "local");
}

/** The challenge an MCP client follows to discover how to sign in. */
export function mcpAuthChallenge(request: Request, pathname: string): string {
  const origin = new URL(request.url).origin;
  return `Bearer resource_metadata="${origin}${PROTECTED_RESOURCE}${pathname}", scope="${OAUTH_SCOPE}"`;
}

function metadata(body: unknown): Response {
  return Response.json(body, { headers: { "cache-control": "public, max-age=300" } });
}

export async function handleOAuthServerRoute(
  request: Request,
  env: Env,
  requestId: string,
  pathname: string,
): Promise<Response> {
  const origin = new URL(request.url).origin;

  if (pathname === PROTECTED_RESOURCE || pathname.startsWith(`${PROTECTED_RESOURCE}/`)) {
    if (request.method !== "GET") return errorResponse("unsupported", "Method not allowed", 405, requestId);
    const resourcePath = pathname.slice(PROTECTED_RESOURCE.length);
    if (resourcePath && !isMcpPath(resourcePath)) return errorResponse("not_found", "Not found", 404, requestId);
    return metadata({
      resource: `${origin}${resourcePath}`,
      authorization_servers: [origin],
      scopes_supported: [OAUTH_SCOPE],
      bearer_methods_supported: ["header"],
      resource_name: "BrokeCRM",
    });
  }

  if (pathname === AUTHORIZATION_SERVER || pathname.startsWith(`${AUTHORIZATION_SERVER}/`)) {
    if (request.method !== "GET") return errorResponse("unsupported", "Method not allowed", 405, requestId);
    return metadata({
      issuer: origin,
      authorization_endpoint: `${crmWebOrigin(env)}/oauth/authorize`,
      token_endpoint: `${origin}/v1/oauth/token`,
      registration_endpoint: `${origin}/v1/oauth/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      scopes_supported: [OAUTH_SCOPE],
    });
  }

  const method = IDENTITY_ROUTES[pathname] ?? "GET";
  if (request.method !== method) return errorResponse("unsupported", "Method not allowed", 405, requestId);
  if (!env.IDENTITY_WORKER) {
    return errorResponse("internal_error", "Authentication service unavailable", 503, requestId);
  }

  const headers = new Headers({ "x-request-id": requestId });
  for (const name of ["content-type", "traceparent"]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  // Only the consent page's approval and the client lookup carry a session.
  if (pathname === "/v1/oauth/authorize" || CLIENT_RE.test(pathname)) {
    const authorization = request.headers.get("authorization");
    if (authorization) headers.set("authorization", authorization);
  }
  const target = new URL(pathname + new URL(request.url).search, "https://identity.internal");
  try {
    const downstream = await env.IDENTITY_WORKER.fetch(target.toString(), {
      method: request.method,
      headers,
      ...(request.method === "POST" ? { body: request.body } : {}),
    });
    return new Response(downstream.body, { status: downstream.status, headers: downstream.headers });
  } catch {
    return errorResponse("internal_error", "Authentication service unavailable", 503, requestId);
  }
}
