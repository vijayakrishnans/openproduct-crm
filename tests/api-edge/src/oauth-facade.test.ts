import { handleCrmRoute } from "@api-edge/crm-facade";
import { handleOAuthServerRoute, isOAuthServerRoute } from "@api-edge/oauth-facade";
import { handleOrgRoute } from "@api-edge/org-facade";

const ORG = "org_da4790db37fd4e0685e10be5fdcee96f";
const OTHER = "org_00000000000000000000000000000001";
const MCP = `/v1/organizations/${ORG}/crm/mcp`;
const HOST = "https://api.brokecrm.cloud";

type Call = { url: string; init: RequestInit };

function fetcher(respond: (url: string) => Response) {
  const calls: Call[] = [];
  const f = {
    fetch(input: string | Request | URL, init?: RequestInit) {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      calls.push({ url, init: init ?? {} });
      return Promise.resolve(respond(url));
    },
    connect() {
      throw new Error("not implemented");
    },
  } as unknown as Fetcher;
  return { fetcher: f, calls };
}

/** identity-worker answering /v1/auth/resolve for an OAuth access token. */
function oauthIdentity(orgId = ORG) {
  return fetcher(() =>
    Response.json({
      data: {
        actor: { actorType: "user", actorId: "usr_abc", email: "rahul@example.com" },
        grant: { kind: "oauth", orgId, scope: "crm" },
        user: { id: "usr_abc", email: "rahul@example.com" },
      },
    }),
  );
}

const ok = () => fetcher(() => Response.json({ data: { ok: true } }));
let n = 0;
const bearer = () => ({ authorization: `Bearer sps_oat_test-token-${n++}` });

describe("OAuth discovery for the MCP server", () => {
  const env = { ENVIRONMENT: "prod", CRM_WEB_CUSTOM_DOMAIN: "www.brokecrm.cloud" } as never;

  it("routes the metadata documents and the identity endpoints", () => {
    expect(isOAuthServerRoute("/.well-known/oauth-protected-resource" + MCP)).toBe(true);
    expect(isOAuthServerRoute("/.well-known/oauth-authorization-server")).toBe(true);
    expect(isOAuthServerRoute("/v1/oauth/token")).toBe(true);
    expect(isOAuthServerRoute("/v1/oauth/clients/oac_x")).toBe(true);
    expect(isOAuthServerRoute("/v1/oauth/anything")).toBe(false);
  });

  it("describes the MCP server as a protected resource of this host", async () => {
    const res = await handleOAuthServerRoute(
      new Request(`${HOST}/.well-known/oauth-protected-resource${MCP}`),
      env,
      "req",
      `/.well-known/oauth-protected-resource${MCP}`,
    );
    expect(await res.json()).toMatchObject({
      resource: `${HOST}${MCP}`,
      authorization_servers: [HOST],
      scopes_supported: ["crm"],
    });
  });

  it("does not describe paths that are not an MCP server", async () => {
    const res = await handleOAuthServerRoute(
      new Request(`${HOST}/.well-known/oauth-protected-resource/v1/organizations`),
      env,
      "req",
      "/.well-known/oauth-protected-resource/v1/organizations",
    );
    expect(res.status).toBe(404);
  });

  it("sends people to the CRM web app to approve, with PKCE and no client secrets", async () => {
    const res = await handleOAuthServerRoute(
      new Request(`${HOST}/.well-known/oauth-authorization-server`),
      env,
      "req",
      "/.well-known/oauth-authorization-server",
    );
    expect(await res.json()).toMatchObject({
      issuer: HOST,
      authorization_endpoint: "https://www.brokecrm.cloud/oauth/authorize",
      token_endpoint: `${HOST}/v1/oauth/token`,
      registration_endpoint: `${HOST}/v1/oauth/register`,
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
    });
  });

  it("forwards the token endpoint to identity without a session", async () => {
    const identity = ok();
    await handleOAuthServerRoute(
      new Request(`${HOST}/v1/oauth/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", authorization: "Bearer leak" },
        body: "grant_type=refresh_token",
      }),
      { ...(env as object), IDENTITY_WORKER: identity.fetcher } as never,
      "req",
      "/v1/oauth/token",
    );
    expect(identity.calls[0]!.url).toBe("https://identity.internal/v1/oauth/token");
    expect(new Headers(identity.calls[0]!.init.headers as HeadersInit).get("authorization")).toBeNull();
  });
});

describe("OAuth access tokens at the edge", () => {
  it("asks an MCP client without a token to sign in", async () => {
    const crm = ok();
    const res = await handleCrmRoute(
      new Request(`${HOST}${MCP}`, { method: "POST", body: "{}" }),
      { ENVIRONMENT: "test", IDENTITY_WORKER: ok().fetcher, CRM_WORKER: crm.fetcher } as never,
      "req",
      MCP,
    );
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe(
      `Bearer resource_metadata="${HOST}/.well-known/oauth-protected-resource${MCP}", scope="crm"`,
    );
    expect(crm.calls).toHaveLength(0);
  });

  it("lets a token reach its organization's MCP server, as the person", async () => {
    const crm = ok();
    const res = await handleCrmRoute(
      new Request(`${HOST}${MCP}`, { method: "POST", headers: bearer(), body: "{}" }),
      { ENVIRONMENT: "test", IDENTITY_WORKER: oauthIdentity().fetcher, CRM_WORKER: crm.fetcher } as never,
      "req",
      MCP,
    );
    expect(res.status).toBe(200);
    const headers = new Headers(crm.calls[0]!.init.headers as HeadersInit);
    expect(headers.get("x-actor-subject-id")).toBe("usr_abc");
    expect(headers.get("x-actor-subject-type")).toBe("user");
  });

  it.each([
    [`/v1/organizations/${OTHER}/crm/mcp`],
    [`/v1/organizations/${ORG}/crm/contacts`],
  ])("refuses the token on %s", async (path) => {
    const crm = ok();
    const res = await handleCrmRoute(
      new Request(`${HOST}${path}`, { method: path.endsWith("mcp") ? "POST" : "GET", headers: bearer() }),
      { ENVIRONMENT: "test", IDENTITY_WORKER: oauthIdentity().fetcher, CRM_WORKER: crm.fetcher } as never,
      "req",
      path,
    );
    expect(res.status).toBe(403);
    expect(crm.calls).toHaveLength(0);
  });

  it("refuses the token outside the CRM", async () => {
    const membership = ok();
    const res = await handleOrgRoute(
      new Request(`${HOST}/v1/organizations/${ORG}/members`, { headers: bearer() }),
      { ENVIRONMENT: "test", IDENTITY_WORKER: oauthIdentity().fetcher, MEMBERSHIP_WORKER: membership.fetcher } as never,
      "req",
      `/v1/organizations/${ORG}/members`,
    );
    expect(res.status).toBe(401);
    expect(membership.calls).toHaveLength(0);
  });
});
