-- 210_identity_oauth_server: OAuth 2.1 for the CRM's MCP server.
--
-- Context: identity
-- Lets an MCP client (Claude's connectors, for one) sign a person in with
-- the authorization-code flow and PKCE instead of a pasted API key. The
-- tokens act as that person, so removing them from an organization ends
-- the access at once, and each one is bound to one organization's CRM.
--
-- Clients register themselves (RFC 7591) and are public: no secret, PKCE
-- only. Codes and tokens are stored as SHA-256 hashes, never in clear.
-- Organization ids are kept in their public form (org_...) with no foreign
-- key: organizations belong to the membership context.
-- Idempotent: uses IF NOT EXISTS throughout.

CREATE TABLE IF NOT EXISTS identity.oauth_clients (
  client_id      TEXT        PRIMARY KEY,
  client_name    TEXT        NOT NULL,
  redirect_uris  JSONB       NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE identity.oauth_clients IS 'OAuth clients registered dynamically (RFC 7591); public clients that must use PKCE.';

CREATE TABLE IF NOT EXISTS identity.oauth_authorization_codes (
  code_hash       TEXT        PRIMARY KEY,
  client_id       TEXT        NOT NULL REFERENCES identity.oauth_clients(client_id),
  user_id         UUID        NOT NULL REFERENCES identity.users(id),
  org_id          TEXT        NOT NULL,
  redirect_uri    TEXT        NOT NULL,
  code_challenge  TEXT        NOT NULL,
  scope           TEXT        NOT NULL,
  resource        TEXT,
  expires_at      TIMESTAMPTZ NOT NULL,
  consumed_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE identity.oauth_authorization_codes IS 'Single-use authorization codes, valid for minutes, redeemed with the PKCE verifier.';

CREATE TABLE IF NOT EXISTS identity.oauth_tokens (
  id                  UUID        PRIMARY KEY,
  access_token_hash   TEXT        NOT NULL,
  refresh_token_hash  TEXT        NOT NULL,
  client_id           TEXT        NOT NULL REFERENCES identity.oauth_clients(client_id),
  user_id             UUID        NOT NULL REFERENCES identity.users(id),
  org_id              TEXT        NOT NULL,
  scope               TEXT        NOT NULL,
  access_expires_at   TIMESTAMPTZ NOT NULL,
  refresh_expires_at  TIMESTAMPTZ NOT NULL,
  revoked_at          TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS oauth_tokens_access_hash_idx
  ON identity.oauth_tokens (access_token_hash);
CREATE UNIQUE INDEX IF NOT EXISTS oauth_tokens_refresh_hash_idx
  ON identity.oauth_tokens (refresh_token_hash);
CREATE INDEX IF NOT EXISTS oauth_tokens_user_idx
  ON identity.oauth_tokens (user_id);

COMMENT ON TABLE identity.oauth_tokens IS 'Access and refresh tokens issued to OAuth clients; each acts as one user in one organization CRM. A refresh rotates the pair.';
