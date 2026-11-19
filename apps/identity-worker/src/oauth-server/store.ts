import type { SqlExecutor } from "@saas/db/hyperdrive";

export interface OAuthClient {
  clientId: string;
  clientName: string;
  redirectUris: string[];
  createdAt: Date;
}

export interface AuthorizationCode {
  codeHash: string;
  clientId: string;
  userId: string;
  orgId: string;
  redirectUri: string;
  codeChallenge: string;
  scope: string;
  resource: string | null;
  expiresAt: Date;
}

export interface IssuedTokens {
  id: string;
  accessTokenHash: string;
  refreshTokenHash: string;
  clientId: string;
  userId: string;
  orgId: string;
  scope: string;
  accessExpiresAt: Date;
  refreshExpiresAt: Date;
}

export interface AccessGrant {
  userId: string;
  email: string;
  displayName: string | null;
  orgId: string;
  scope: string;
}

/** Storage for the OAuth server (tables of migration 210_identity_oauth_server). */
export interface OAuthStore {
  createClient(client: OAuthClient): Promise<void>;
  getClient(clientId: string): Promise<OAuthClient | null>;
  createCode(code: AuthorizationCode): Promise<void>;
  /** Marks the code used and returns it, once: null if unknown, used or expired. */
  consumeCode(codeHash: string, now: Date): Promise<AuthorizationCode | null>;
  createTokens(tokens: IssuedTokens): Promise<void>;
  /** Revokes the pair a refresh token belongs to and returns it, once. */
  consumeRefreshToken(refreshTokenHash: string, now: Date): Promise<IssuedTokens | null>;
  /** The live grant behind an access token, for an active user only. */
  resolveAccessToken(accessTokenHash: string, now: Date): Promise<AccessGrant | null>;
}

type Row = Record<string, unknown>;

const date = (v: unknown) => new Date(v as string);

function toCode(r: Row): AuthorizationCode {
  return {
    codeHash: r["code_hash"] as string,
    clientId: r["client_id"] as string,
    userId: r["user_id"] as string,
    orgId: r["org_id"] as string,
    redirectUri: r["redirect_uri"] as string,
    codeChallenge: r["code_challenge"] as string,
    scope: r["scope"] as string,
    resource: (r["resource"] as string | null) ?? null,
    expiresAt: date(r["expires_at"]),
  };
}

function toTokens(r: Row): IssuedTokens {
  return {
    id: r["id"] as string,
    accessTokenHash: r["access_token_hash"] as string,
    refreshTokenHash: r["refresh_token_hash"] as string,
    clientId: r["client_id"] as string,
    userId: r["user_id"] as string,
    orgId: r["org_id"] as string,
    scope: r["scope"] as string,
    accessExpiresAt: date(r["access_expires_at"]),
    refreshExpiresAt: date(r["refresh_expires_at"]),
  };
}

export function createOAuthStore(executor: SqlExecutor): OAuthStore {
  return {
    async createClient(c) {
      await executor.execute(
        `INSERT INTO identity.oauth_clients (client_id, client_name, redirect_uris, created_at)
         VALUES ($1, $2, $3::jsonb, $4)`,
        [c.clientId, c.clientName, JSON.stringify(c.redirectUris), c.createdAt.toISOString()],
      );
    },

    async getClient(clientId) {
      const result = await executor.execute<Row>(
        `SELECT client_id, client_name, redirect_uris, created_at
         FROM identity.oauth_clients WHERE client_id = $1`,
        [clientId],
      );
      const r = result.rows[0];
      if (!r) return null;
      const uris = typeof r["redirect_uris"] === "string" ? JSON.parse(r["redirect_uris"]) : r["redirect_uris"];
      return {
        clientId: r["client_id"] as string,
        clientName: r["client_name"] as string,
        redirectUris: Array.isArray(uris) ? (uris as string[]) : [],
        createdAt: date(r["created_at"]),
      };
    },

    async createCode(c) {
      await executor.execute(
        `INSERT INTO identity.oauth_authorization_codes
           (code_hash, client_id, user_id, org_id, redirect_uri, code_challenge, scope, resource, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          c.codeHash, c.clientId, c.userId, c.orgId, c.redirectUri,
          c.codeChallenge, c.scope, c.resource, c.expiresAt.toISOString(),
        ],
      );
    },

    async consumeCode(codeHash, now) {
      const result = await executor.execute<Row>(
        `UPDATE identity.oauth_authorization_codes SET consumed_at = $2
         WHERE code_hash = $1 AND consumed_at IS NULL AND expires_at > $2
         RETURNING code_hash, client_id, user_id, org_id, redirect_uri, code_challenge, scope, resource, expires_at`,
        [codeHash, now.toISOString()],
      );
      return result.rows[0] ? toCode(result.rows[0]) : null;
    },

    async createTokens(t) {
      await executor.execute(
        `INSERT INTO identity.oauth_tokens
           (id, access_token_hash, refresh_token_hash, client_id, user_id, org_id, scope,
            access_expires_at, refresh_expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          t.id, t.accessTokenHash, t.refreshTokenHash, t.clientId, t.userId, t.orgId, t.scope,
          t.accessExpiresAt.toISOString(), t.refreshExpiresAt.toISOString(),
        ],
      );
    },

    async consumeRefreshToken(refreshTokenHash, now) {
      const result = await executor.execute<Row>(
        `UPDATE identity.oauth_tokens SET revoked_at = $2
         WHERE refresh_token_hash = $1 AND revoked_at IS NULL AND refresh_expires_at > $2
         RETURNING id, access_token_hash, refresh_token_hash, client_id, user_id, org_id, scope,
                   access_expires_at, refresh_expires_at`,
        [refreshTokenHash, now.toISOString()],
      );
      return result.rows[0] ? toTokens(result.rows[0]) : null;
    },

    async resolveAccessToken(accessTokenHash, now) {
      const result = await executor.execute<Row>(
        `SELECT t.user_id, t.org_id, t.scope, u.email, u.display_name
         FROM identity.oauth_tokens t
         JOIN identity.users u ON u.id = t.user_id
         WHERE t.access_token_hash = $1 AND t.revoked_at IS NULL
           AND t.access_expires_at > $2 AND u.status = 'active'`,
        [accessTokenHash, now.toISOString()],
      );
      const r = result.rows[0];
      if (!r) return null;
      return {
        userId: r["user_id"] as string,
        email: r["email"] as string,
        displayName: (r["display_name"] as string | null) ?? null,
        orgId: r["org_id"] as string,
        scope: r["scope"] as string,
      };
    },
  };
}
