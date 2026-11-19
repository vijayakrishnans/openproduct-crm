// React-admin auth provider over Lumen identity sessions. Sign-in is the
// email-code flow of identity-worker; the session token is sent as a bearer
// to api-edge. Who may do what is decided by the API (membership + policy);
// canAccess here only hides what the API would refuse anyway.
import type { AuthProvider } from "ra-core";

import { canAccess } from "../commons/canAccess";
import {
  api,
  apiBaseUrl,
  clearSession,
  crmPath,
  getSession,
  setSession,
  type Organization,
} from "./client";

const CURRENT_SALE_CACHE_KEY = "RaStore.auth.current_sale";
/** Where react-query's persister keeps its default cache. */
const QUERY_CACHE_KEY = "REACT_QUERY_OFFLINE_CACHE";
/** Where the CRM's store keeps the organization's branding and pipeline
 *  settings (ra-core's localStorageStore, app key "CRM"). */
const CONFIGURATION_CACHE_KEY = "RaStoreCRM.app.configuration";

type CurrentSale = {
  id: number;
  first_name: string;
  last_name: string;
  avatar?: { src?: string };
  administrator: boolean;
};

function cache(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

async function getSale(): Promise<CurrentSale | undefined> {
  const cached = cache()?.getItem(CURRENT_SALE_CACHE_KEY);
  if (cached) return JSON.parse(cached) as CurrentSale;
  if (!getSession()?.orgId) return undefined;
  const sale = await api<CurrentSale>("GET", `${crmPath()}/sales/me`);
  cache()?.setItem(CURRENT_SALE_CACHE_KEY, JSON.stringify(sale));
  return sale;
}

export function clearSaleCache(): void {
  cache()?.removeItem(CURRENT_SALE_CACHE_KEY);
}

// --- Sign-in steps, used by LumenLoginPage --------------------------------

export type LoginChallenge = {
  challengeId: string;
  /** Present only where identity runs with debug delivery (stage): the code
   *  is returned instead of emailed. */
  debugCode?: string;
  emailHint?: string;
};

export async function startLogin(email: string): Promise<LoginChallenge> {
  const data = await api<{
    challengeId: string;
    delivery?: { mode?: string; code?: string; emailHint?: string };
  }>("POST", "/v1/auth/login/start", { body: { email }, anonymous: true });
  return {
    challengeId: data.challengeId,
    debugCode: data.delivery?.code,
    emailHint: data.delivery?.emailHint,
  };
}

export async function completeLogin(challengeId: string, code: string): Promise<void> {
  const data = await api<{
    token: string;
    expiresAt: string;
    user: { email: string };
  }>("POST", "/v1/auth/login/complete", { body: { challengeId, code }, anonymous: true });
  clearSaleCache();
  setSession({ token: data.token, expiresAt: data.expiresAt, email: data.user.email });
}

// --- sign-in with Google, GitHub… -------------------------------------------
//
// The identity service does the OAuth dance. The browser is sent to
// `/v1/auth/oauth/<provider>/start?return_to=<this site>`, and comes back to
// `return_to` with the result in the URL fragment: `#token=…&expires_at=…`,
// or `#error=<code>`. A provider is offered only when the service lists it,
// which it does once its client id and secret are configured.

export type OAuthProvider = { id: string; displayName: string };

export async function listOAuthProviders(): Promise<OAuthProvider[]> {
  try {
    const data = await api<{ providers: OAuthProvider[] }>("GET", "/v1/auth/oauth/providers", {
      anonymous: true,
    });
    return data.providers ?? [];
  } catch {
    // Sign-in by email code still works; the buttons are an extra.
    return [];
  }
}

const OAUTH_RETURN_PARAM = "signin";
const OAUTH_ERROR_KEY = "openproduct-crm.oauth-error";

/** Where the browser goes to start a provider's sign-in. */
export function oauthStartUrl(providerId: string): string {
  const returnTo = `${window.location.origin}/?${OAUTH_RETURN_PARAM}=${encodeURIComponent(providerId)}`;
  return `${apiBaseUrl()}/v1/auth/oauth/${encodeURIComponent(providerId)}/start?return_to=${encodeURIComponent(returnTo)}`;
}

const OAUTH_ERRORS: Record<string, string> = {
  access_denied: "Sign-in was cancelled.",
  email_required:
    "That account has no email address. Add one with the provider, or sign in with an email code.",
  email_unverified:
    "That account's email is not verified. Verify it with the provider, or sign in with an email code.",
  provider_unavailable: "That sign-in method is not available right now.",
};

/**
 * Handles the return from a provider, before the app starts (the fragment
 * would otherwise be read as a route). Stores the session, or keeps the
 * reason it failed for the sign-in page, and puts the address back to the
 * sign-in route with nothing secret in it. No-op on any other visit.
 */
export async function consumeOAuthReturn(): Promise<void> {
  if (!new URLSearchParams(window.location.search).has(OAUTH_RETURN_PARAM)) return;
  const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const token = fragment.get("token");
  const expiresAt = fragment.get("expires_at");
  const error = fragment.get("error");
  // First of all: the token must not stay in the address bar or the history.
  window.history.replaceState(null, "", `${window.location.pathname}#/login`);

  if (token && expiresAt) {
    clearSaleCache();
    setSession({ token, expiresAt, email: "" });
    try {
      const data = await api<{ user?: { email?: string } }>("GET", "/v1/auth/session");
      setSession({ token, expiresAt, email: data.user?.email ?? "" });
    } catch {
      clearSession();
      window.sessionStorage.setItem(OAUTH_ERROR_KEY, "Sign-in did not complete. Please try again.");
    }
    return;
  }
  window.sessionStorage.setItem(
    OAUTH_ERROR_KEY,
    OAUTH_ERRORS[error ?? ""] ?? "Sign-in did not complete. Please try again.",
  );
}

/** The message left by a failed provider sign-in, once. */
export function takeOAuthError(): string | null {
  try {
    const message = window.sessionStorage.getItem(OAUTH_ERROR_KEY);
    if (message) window.sessionStorage.removeItem(OAUTH_ERROR_KEY);
    return message;
  } catch {
    return null;
  }
}

export async function listOrganizations(): Promise<Organization[]> {
  const data = await api<{ organizations: Organization[] }>("GET", "/v1/organizations");
  return data.organizations ?? [];
}

function slugify(name: string): string {
  const base = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  const suffix = Math.random().toString(36).slice(2, 7);
  return `${base || "crm"}-${suffix}`;
}

export async function createOrganization(name: string): Promise<Organization> {
  const data = await api<{ organization: Organization }>("POST", "/v1/organizations", {
    body: { name, slug: slugify(name) },
  });
  return data.organization;
}

export function selectOrganization(org: Organization): void {
  const session = getSession();
  if (!session) throw new Error("Not signed in");
  clearSaleCache();
  // Query results are saved to localStorage for offline use (see CRM.tsx), and
  // the store keeps the branding. Both belong to the organization they were
  // read from.
  try {
    window.localStorage.removeItem(QUERY_CACHE_KEY);
    window.localStorage.removeItem(CONFIGURATION_CACHE_KEY);
  } catch {
    // No storage, so nothing was saved.
  }
  setSession({ ...session, orgId: org.id, orgSlug: org.slug, orgName: org.name });
}

/** Moves the running app to another organization. A full reload, so that no
 *  screen or in-memory query keeps showing the previous one's records. The
 *  query string goes too: a leftover `?org=` would choose the old one again. */
export function openOrganization(org: Organization): void {
  selectOrganization(org);
  window.history.replaceState(null, "", `${window.location.pathname}#/`);
  window.location.reload();
}

// --- invitations addressed to the signed-in person -------------------------

export type PendingInvitation = {
  id: string;
  role: string;
  expiresAt: string;
  organization: Organization;
};

export async function listPendingInvitations(): Promise<PendingInvitation[]> {
  const data = await api<{ invitations: PendingInvitation[] }>("GET", "/v1/invitations");
  return data.invitations ?? [];
}

export async function acceptPendingInvitation(invitation: PendingInvitation): Promise<void> {
  await api("POST", `/v1/invitations/${encodeURIComponent(invitation.id)}/accept`);
}

// ---------------------------------------------------------------------------

export const getAuthProvider = (): AuthProvider => ({
  // The login page drives the steps above itself; by the time it calls
  // useLogin() the session and the organization are already chosen.
  login: async () => {
    const session = getSession();
    if (!session?.orgId) throw new Error("Sign in and choose an organization first");
  },

  logout: async () => {
    const session = getSession();
    clearSaleCache();
    if (session) {
      try {
        await api("POST", "/v1/auth/logout");
      } catch {
        // The session may already be gone; forgetting it locally is enough.
      }
    }
    clearSession();
  },

  checkAuth: async () => {
    let session = getSession();
    // A link from the console names the organization to open (?org=<slug>).
    // If the session is in another one, keep the sign-in and choose again.
    const wanted = new URLSearchParams(window.location.search).get("org");
    if (session?.orgId && wanted && wanted !== session.orgId && wanted !== session.orgSlug) {
      clearSaleCache();
      const { orgId: _orgId, orgSlug: _orgSlug, orgName: _orgName, ...signedIn } = session;
      setSession(signedIn);
      session = signedIn;
    }
    if (!session?.orgId) {
      throw { redirectTo: "/login", message: false };
    }
  },

  checkError: async (error) => {
    if (error?.status === 401) {
      clearSaleCache();
      clearSession();
      throw new Error("Your session has expired");
    }
  },

  getIdentity: async () => {
    const sale = await getSale();
    if (sale == null) throw new Error();
    return {
      id: sale.id,
      fullName: `${sale.first_name} ${sale.last_name}`.trim(),
      avatar: sale.avatar?.src,
    };
  },

  canAccess: async (params) => {
    const sale = await getSale();
    if (sale == null) return false;
    return canAccess(sale.administrator ? "admin" : "user", params);
  },
});
