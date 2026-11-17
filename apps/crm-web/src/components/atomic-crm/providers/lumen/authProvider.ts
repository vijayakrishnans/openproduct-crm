// React-admin auth provider over Lumen identity sessions. Sign-in is the
// email-code flow of identity-worker; the session token is sent as a bearer
// to api-edge. Who may do what is decided by the API (membership + policy);
// canAccess here only hides what the API would refuse anyway.
import type { AuthProvider } from "ra-core";

import { canAccess } from "../commons/canAccess";
import {
  api,
  clearSession,
  crmPath,
  getSession,
  setSession,
  type Organization,
} from "./client";

const CURRENT_SALE_CACHE_KEY = "RaStore.auth.current_sale";

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
  setSession({ ...session, orgId: org.id, orgSlug: org.slug, orgName: org.name });
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
