// The parts of OAuth 2.1 that need no storage: what a client may register,
// PKCE, the organization a resource names, and the token formats.
//
// Only public clients exist here (token_endpoint_auth_method "none"), so PKCE
// with S256 is mandatory on every authorization, as OAuth 2.1 requires.

export const SCOPE = "crm";
export const ACCESS_TOKEN_PREFIX = "sps_oat_";
export const REFRESH_TOKEN_PREFIX = "sps_ort_";
export const CODE_TTL_SECONDS = 10 * 60;
export const ACCESS_TTL_SECONDS = 60 * 60;
export const REFRESH_TTL_SECONDS = 30 * 24 * 60 * 60;

const MAX_REDIRECT_URIS = 10;
const MAX_URI_LENGTH = 2000;
const MAX_NAME_LENGTH = 100;
const ORG_IN_RESOURCE_RE = /\/v1\/organizations\/(org_[0-9a-f]{32})\/crm(?:\/mcp)?\/?$/;
const VERIFIER_RE = /^[A-Za-z0-9\-._~]{43,128}$/;
const CHALLENGE_RE = /^[A-Za-z0-9\-_]{43}$/;

/**
 * A redirect URI a client may register: https anywhere, or http on the
 * loopback interface for clients running on the user's machine (RFC 8252).
 * No fragments, no credentials in the URL.
 */
export function isAllowedRedirectUri(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_URI_LENGTH) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.hash || url.username || url.password) return false;
  if (url.protocol === "https:") return true;
  return url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
}

export type RegistrationInput = { clientName: string; redirectUris: string[] };

/** Validates an RFC 7591 registration request; returns the RFC error otherwise. */
export function parseRegistration(
  body: unknown,
): RegistrationInput | { error: "invalid_redirect_uri" | "invalid_client_metadata"; description: string } {
  if (!body || typeof body !== "object") {
    return { error: "invalid_client_metadata", description: "The body must be a JSON object" };
  }
  const b = body as Record<string, unknown>;
  const uris = b["redirect_uris"];
  if (!Array.isArray(uris) || uris.length === 0 || uris.length > MAX_REDIRECT_URIS) {
    return { error: "invalid_redirect_uri", description: `Give 1 to ${MAX_REDIRECT_URIS} redirect_uris` };
  }
  if (!uris.every(isAllowedRedirectUri)) {
    return {
      error: "invalid_redirect_uri",
      description: "Each redirect URI must be https, or http on localhost",
    };
  }
  const method = b["token_endpoint_auth_method"];
  if (method !== undefined && method !== "none") {
    return { error: "invalid_client_metadata", description: "Only public clients are supported (none)" };
  }
  const grants = b["grant_types"];
  if (
    grants !== undefined &&
    (!Array.isArray(grants) || !grants.every((g) => g === "authorization_code" || g === "refresh_token"))
  ) {
    return { error: "invalid_client_metadata", description: "Supported grant types: authorization_code, refresh_token" };
  }
  const responseTypes = b["response_types"];
  if (responseTypes !== undefined && (!Array.isArray(responseTypes) || !responseTypes.every((r) => r === "code"))) {
    return { error: "invalid_client_metadata", description: "Supported response type: code" };
  }
  const rawName = typeof b["client_name"] === "string" ? b["client_name"].trim() : "";
  const clientName = (rawName || "MCP client").slice(0, MAX_NAME_LENGTH);
  return { clientName, redirectUris: [...new Set(uris as string[])] };
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function isValidCodeChallenge(challenge: unknown): challenge is string {
  return typeof challenge === "string" && CHALLENGE_RE.test(challenge);
}

/** RFC 7636 S256: BASE64URL(SHA256(verifier)) must equal the challenge. */
export async function verifyPkce(verifier: unknown, challenge: string): Promise<boolean> {
  if (typeof verifier !== "string" || !VERIFIER_RE.test(verifier)) return false;
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  return timingSafeEqual(base64Url(digest), challenge);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** The organization an MCP resource URL names, if it names one. */
export function orgFromResource(resource: unknown): string | null {
  if (typeof resource !== "string") return null;
  try {
    return new URL(resource).pathname.match(ORG_IN_RESOURCE_RE)?.[1] ?? null;
  } catch {
    return null;
  }
}

export function randomSecret(bytes = 32): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export function newClientId(): string {
  return `oac_${randomSecret(16)}`;
}
