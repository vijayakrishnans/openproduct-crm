// The HTTP client for the Lumen API (api-edge). The browser talks to nothing
// else: no database, no storage, no third party.
import { HttpError } from "ra-core";

const SESSION_KEY = "openproduct-crm.session";

export type Session = {
  token: string;
  expiresAt: string;
  email: string;
  /** Public id (org_…) of the organization the CRM is showing. */
  orgId?: string;
  orgSlug?: string;
  orgName?: string;
};

export type Organization = { id: string; name: string; slug: string };

/**
 * api-edge for each custom domain crm-web answers on. A custom hostname says
 * nothing about where the API is, so it is listed here; the hostnames are the
 * ones `CRM_WEB_CUSTOM_DOMAIN` in intent.yaml attaches, and api-edge allows
 * the same ones as CORS origins. Keep the three in step.
 */
const CUSTOM_DOMAIN_API_URLS: Record<string, string> = {
  "www.brokecrm.cloud": "https://api.brokecrm.cloud",
  "stage.brokecrm.cloud": "https://api-stage.brokecrm.cloud",
};

/**
 * The MCP server's own hostnames, the address people paste into an assistant.
 * `MCP_CUSTOM_DOMAIN` in intent.yaml attaches them to api-edge
 * (infra/terraform/cloudflare-domain).
 */
const CUSTOM_DOMAIN_MCP_HOSTS: Record<string, string> = {
  "www.brokecrm.cloud": "https://mcp.brokecrm.cloud",
  "stage.brokecrm.cloud": "https://mcp-stage.brokecrm.cloud",
};

/**
 * Where api-edge lives. On a deployed crm-web the Worker is named like
 * api-edge's with `crm-web` in its place, on the same workers.dev subdomain,
 * so the URL follows from the page's own host; on a custom domain it comes
 * from the table above. VITE_API_URL overrides both (local development).
 */
export function apiBaseUrl(): string {
  const explicit = import.meta.env.VITE_API_URL as string | undefined;
  if (explicit) return explicit.replace(/\/+$/, "");
  const { protocol, hostname } = window.location;
  if (hostname.includes("-crm-web-")) {
    return `${protocol}//${hostname.replace("-crm-web-", "-api-edge-")}`;
  }
  const custom = CUSTOM_DOMAIN_API_URLS[hostname];
  if (custom) return custom;
  return "http://localhost:8787";
}

function storage(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function getSession(): Session | null {
  const raw = storage()?.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    const session = JSON.parse(raw) as Session;
    if (!session.token || new Date(session.expiresAt).getTime() <= Date.now()) {
      clearSession();
      return null;
    }
    return session;
  } catch {
    clearSession();
    return null;
  }
}

export function setSession(session: Session): void {
  storage()?.setItem(SESSION_KEY, JSON.stringify(session));
}

export function clearSession(): void {
  storage()?.removeItem(SESSION_KEY);
}

type ApiOptions = {
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  /** Send no session even if there is one (the sign-in calls). */
  anonymous?: boolean;
  signal?: AbortSignal;
};

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Calls api-edge and unwraps its `{ data, meta }` envelope. Failures throw
 *  an HttpError carrying the status, so authProvider.checkError can end an
 *  expired session. */
export async function api<T = any>(
  method: string,
  path: string,
  options: ApiOptions = {},
): Promise<T> {
  const url = new URL(apiBaseUrl() + path);
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }

  const headers: Record<string, string> = {};
  const session = options.anonymous ? null : getSession();
  if (session) headers["authorization"] = `Bearer ${session.token}`;
  if (options.body !== undefined) headers["content-type"] = "application/json";
  if (WRITE_METHODS.has(method)) headers["idempotency-key"] = crypto.randomUUID();

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    });
  } catch (error) {
    if ((error as Error)?.name === "AbortError") throw error;
    throw new HttpError("Could not reach the server", 0);
  }

  let payload: any = null;
  try {
    payload = await response.json();
  } catch {
    // An empty or non-JSON body; the status decides below.
  }

  if (!response.ok) {
    const error = payload?.error ?? {};
    const fields = error.details?.fields as Record<string, string[]> | undefined;
    const fieldMessage = fields
      ? Object.entries(fields)
          .map(([field, messages]) => (field === "_" ? messages.join(", ") : `${field} ${messages.join(", ")}`))
          .join("; ")
      : "";
    const message = [error.message ?? response.statusText ?? "Request failed", fieldMessage]
      .filter(Boolean)
      .join(": ");
    throw new HttpError(message, response.status, payload);
  }

  return (payload?.data ?? payload) as T;
}

/** The base path of the current org's CRM routes. */
export function crmPath(): string {
  const orgId = getSession()?.orgId;
  if (!orgId) throw new HttpError("No organization selected", 401);
  return `/v1/organizations/${orgId}/crm`;
}

/**
 * The MCP server's address, or null when not signed in (the demo). It is the
 * same for everyone: the credential an assistant presents says which
 * organization it works in (api-edge's general MCP path).
 */
export function mcpUrl(): string | null {
  if (!getSession()?.orgId) return null;
  const host = CUSTOM_DOMAIN_MCP_HOSTS[window.location.hostname] ?? apiBaseUrl();
  return `${host}/mcp`;
}

export function orgPath(): string {
  const orgId = getSession()?.orgId;
  if (!orgId) throw new HttpError("No organization selected", 401);
  return `/v1/organizations/${orgId}`;
}
