import crypto from "node:crypto";
import {
  handleOAuthAuthorize,
  handleOAuthClientInfo,
  handleOAuthRegister,
  handleOAuthToken,
  resolveOAuthAccessToken,
  type OAuthDeps,
} from "../../../apps/identity-worker/src/oauth-server/handlers";
import {
  isAllowedRedirectUri,
  orgFromResource,
  verifyPkce,
} from "../../../apps/identity-worker/src/oauth-server/protocol";
import type {
  AuthorizationCode,
  IssuedTokens,
  OAuthClient,
  OAuthStore,
} from "../../../apps/identity-worker/src/oauth-server/store";
import type { Env } from "../../../apps/identity-worker/src/env";

const env = { ENVIRONMENT: "test", DEBUG_DELIVERY: "false" } as Env;
const USER = "0f3a3c1e-1b2c-4d5e-8f90-112233445566";
const USER_PUBLIC = "usr_0f3a3c1e1b2c4d5e8f90112233445566";
const ORG = "org_da4790db37fd4e0685e10be5fdcee96f";
const OTHER_ORG = "org_00000000000000000000000000000001";
const REDIRECT = "https://claude.ai/api/mcp/auth_callback";
const RESOURCE = `https://api.brokecrm.cloud/v1/organizations/${ORG}/crm/mcp`;
const VERIFIER = "a".repeat(20) + "-._~" + "B".repeat(30);
const CHALLENGE = crypto.createHash("sha256").update(VERIFIER).digest("base64url");

function memoryStore() {
  const clients = new Map<string, OAuthClient>();
  const codes = new Map<string, AuthorizationCode & { consumed: boolean }>();
  const tokens = new Map<string, IssuedTokens & { revoked: boolean }>();
  const store: OAuthStore = {
    async createClient(c) {
      clients.set(c.clientId, c);
    },
    async getClient(id) {
      return clients.get(id) ?? null;
    },
    async createCode(c) {
      codes.set(c.codeHash, { ...c, consumed: false });
    },
    async consumeCode(hash, now) {
      const c = codes.get(hash);
      if (!c || c.consumed || c.expiresAt <= now) return null;
      c.consumed = true;
      return c;
    },
    async createTokens(t) {
      tokens.set(t.id, { ...t, revoked: false });
    },
    async consumeRefreshToken(hash, now) {
      const t = [...tokens.values()].find((x) => x.refreshTokenHash === hash);
      if (!t || t.revoked || t.refreshExpiresAt <= now) return null;
      t.revoked = true;
      return t;
    },
    async resolveAccessToken(hash, now) {
      const t = [...tokens.values()].find((x) => x.accessTokenHash === hash);
      if (!t || t.revoked || t.accessExpiresAt <= now) return null;
      return { userId: t.userId, email: "rahul@example.com", displayName: null, orgId: t.orgId, scope: t.scope };
    },
  };
  return { store, clients, codes, tokens };
}

function deps(overrides: Partial<OAuthDeps> = {}) {
  const memory = memoryStore();
  let clock = new Date("2026-11-19T10:00:00Z");
  const value: OAuthDeps = {
    store: memory.store,
    now: () => clock,
    resolveSessionUser: async (token) => (token === "sps_ses_good" ? { userId: USER } : null),
    isMember: async (subject, org) => subject === USER_PUBLIC && org === ORG,
    ...overrides,
  };
  return { value, memory, advance: (ms: number) => (clock = new Date(clock.getTime() + ms)) };
}

const json = (body: unknown, headers: Record<string, string> = {}) => ({
  method: "POST",
  headers: { "content-type": "application/json", ...headers },
  body: JSON.stringify(body),
});
const form = (body: Record<string, string>) => ({
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams(body).toString(),
});

async function register(d: OAuthDeps): Promise<string> {
  const res = await handleOAuthRegister(
    new Request("https://x/v1/oauth/register", json({ client_name: "Claude", redirect_uris: [REDIRECT] })),
    env,
    "req",
    d,
  );
  expect(res.status).toBe(201);
  return ((await res.json()) as { client_id: string }).client_id;
}

async function authorize(d: OAuthDeps, clientId: string, extra: Record<string, unknown> = {}, session = "sps_ses_good") {
  return handleOAuthAuthorize(
    new Request(
      "https://x/v1/oauth/authorize",
      json(
        {
          response_type: "code",
          client_id: clientId,
          redirect_uri: REDIRECT,
          code_challenge: CHALLENGE,
          code_challenge_method: "S256",
          state: "st-1",
          resource: RESOURCE,
          org_id: ORG,
          ...extra,
        },
        { authorization: `Bearer ${session}` },
      ),
    ),
    env,
    "req",
    d,
  );
}

async function codeFrom(res: Response): Promise<string> {
  const { data } = (await res.json()) as { data: { redirectTo: string } };
  const url = new URL(data.redirectTo);
  expect(url.origin + url.pathname).toBe(REDIRECT);
  expect(url.searchParams.get("state")).toBe("st-1");
  return url.searchParams.get("code")!;
}

const exchange = (d: OAuthDeps, clientId: string, code: string, verifier = VERIFIER) =>
  handleOAuthToken(
    new Request(
      "https://x/v1/oauth/token",
      form({ grant_type: "authorization_code", client_id: clientId, code, code_verifier: verifier, redirect_uri: REDIRECT }),
    ),
    env,
    "req",
    d,
  );

describe("OAuth server for the MCP server", () => {
  it("runs the whole flow: register, approve, exchange, resolve, refresh", async () => {
    const { value } = deps();
    const clientId = await register(value);

    const info = await handleOAuthClientInfo(
      new Request(`https://x/v1/oauth/clients/${clientId}?redirect_uri=${encodeURIComponent(REDIRECT)}`),
      env,
      "req",
      clientId,
      value,
    );
    expect(((await info.json()) as { data: { client: { name: string } } }).data.client.name).toBe("Claude");

    const code = await codeFrom(await authorize(value, clientId));
    const tokenRes = await exchange(value, clientId, code);
    expect(tokenRes.status).toBe(200);
    expect(tokenRes.headers.get("cache-control")).toBe("no-store");
    const tokens = (await tokenRes.json()) as { access_token: string; refresh_token: string; token_type: string };
    expect(tokens.token_type).toBe("Bearer");
    expect(tokens.access_token.startsWith("sps_oat_")).toBe(true);

    const actor = await resolveOAuthAccessToken(tokens.access_token, value.store, value.now!());
    expect(actor).toMatchObject({ actorId: USER_PUBLIC, orgId: ORG, scope: "crm" });

    const refreshed = await handleOAuthToken(
      new Request("https://x/v1/oauth/token", form({ grant_type: "refresh_token", client_id: clientId, refresh_token: tokens.refresh_token })),
      env,
      "req",
      value,
    );
    expect(refreshed.status).toBe(200);
    // The old pair is revoked by the rotation.
    expect(await resolveOAuthAccessToken(tokens.access_token, value.store, value.now!())).toEqual({ error: true });
    const again = await handleOAuthToken(
      new Request("https://x/v1/oauth/token", form({ grant_type: "refresh_token", client_id: clientId, refresh_token: tokens.refresh_token })),
      env,
      "req",
      value,
    );
    expect(((await again.json()) as { error: string }).error).toBe("invalid_grant");
  });

  it("redeems a code once, and only with the right PKCE verifier", async () => {
    const { value } = deps();
    const clientId = await register(value);
    const wrong = await exchange(value, clientId, await codeFrom(await authorize(value, clientId)), "x".repeat(50));
    expect(((await wrong.json()) as { error: string }).error).toBe("invalid_grant");

    const code = await codeFrom(await authorize(value, clientId));
    expect((await exchange(value, clientId, code)).status).toBe(200);
    expect((await exchange(value, clientId, code)).status).toBe(400);
  });

  it("refuses an expired code", async () => {
    const { value, advance } = deps();
    const clientId = await register(value);
    const code = await codeFrom(await authorize(value, clientId));
    advance(11 * 60 * 1000);
    expect((await exchange(value, clientId, code)).status).toBe(400);
  });

  it("refuses a code presented by another client", async () => {
    const { value } = deps();
    const clientId = await register(value);
    const other = await register(value);
    const code = await codeFrom(await authorize(value, clientId));
    expect((await exchange(value, other, code)).status).toBe(400);
  });

  it("needs a BrokeCRM session, membership, PKCE and a registered redirect to approve", async () => {
    const { value } = deps();
    const clientId = await register(value);
    expect((await authorize(value, clientId, {}, "sps_ses_bad")).status).toBe(401);
    expect((await authorize(value, clientId, { org_id: OTHER_ORG, resource: undefined })).status).toBe(404);
    expect((await authorize(value, clientId, { code_challenge: "short" })).status).toBe(422);
    expect((await authorize(value, clientId, { redirect_uri: "https://evil.example/cb" })).status).toBe(404);
    expect((await authorize(value, "oac_unknown")).status).toBe(404);
  });

  it("will not grant another organization than the one the resource names", async () => {
    const { value } = deps({ isMember: async () => true });
    const clientId = await register(value);
    const res = await authorize(value, clientId, { org_id: OTHER_ORG });
    expect(res.status).toBe(422);
  });

  it("does not show an app for a redirect URI it never registered", async () => {
    const { value } = deps();
    const clientId = await register(value);
    const res = await handleOAuthClientInfo(
      new Request(`https://x/v1/oauth/clients/${clientId}?redirect_uri=${encodeURIComponent("https://evil.example/cb")}`),
      env,
      "req",
      clientId,
      value,
    );
    expect(res.status).toBe(422);
  });

  it("rejects unsafe registrations", async () => {
    const { value } = deps();
    for (const body of [
      { redirect_uris: ["http://evil.example/cb"] },
      { redirect_uris: ["javascript:alert(1)"] },
      { redirect_uris: [] },
      { redirect_uris: [REDIRECT], token_endpoint_auth_method: "client_secret_basic" },
    ]) {
      const res = await handleOAuthRegister(new Request("https://x/v1/oauth/register", json(body)), env, "req", value);
      expect(res.status).toBe(400);
    }
  });

  it("ignores tokens that are not OAuth access tokens", async () => {
    const { value } = deps();
    expect(await resolveOAuthAccessToken("sps_ses_abc.def", value.store, new Date())).toBeNull();
  });
});

describe("OAuth protocol helpers", () => {
  it("allows https and loopback redirects only", () => {
    expect(isAllowedRedirectUri(REDIRECT)).toBe(true);
    expect(isAllowedRedirectUri("http://localhost:6274/oauth/callback")).toBe(true);
    expect(isAllowedRedirectUri("http://127.0.0.1:33418/")).toBe(true);
    expect(isAllowedRedirectUri("http://example.com/cb")).toBe(false);
    expect(isAllowedRedirectUri("https://example.com/cb#frag")).toBe(false);
  });

  it("reads the organization from an MCP resource URL", () => {
    expect(orgFromResource(RESOURCE)).toBe(ORG);
    expect(orgFromResource("https://api.brokecrm.cloud/")).toBeNull();
  });

  it("verifies S256", async () => {
    expect(await verifyPkce(VERIFIER, CHALLENGE)).toBe(true);
    expect(await verifyPkce("short", CHALLENGE)).toBe(false);
  });
});
