// A company without a logo gets its website's favicon, and a contact without
// an avatar the favicon of their email's domain. Upstream did this in Postgres
// with the http extension, and also asked Gravatar and favicon.show; here the
// worker asks only the domain itself, so no contact detail goes to a third
// party.
import type { SqlExecutor } from "@saas/db/hyperdrive";
import type { Uuid } from "@saas/db/ids";

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

const TIMEOUT_MS = 2500;

/** Webmail and ISP domains: their favicon says nothing about the contact.
 *  An organization adds its own in crm.favicons_excluded_domains. */
export const DEFAULT_EXCLUDED_DOMAINS: ReadonlySet<string> = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "yahoo.fr",
  "ymail.com",
  "hotmail.com",
  "hotmail.fr",
  "outlook.com",
  "live.com",
  "msn.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "pm.me",
  "gmx.com",
  "gmx.de",
  "gmx.net",
  "web.de",
  "mail.com",
  "yandex.com",
  "yandex.ru",
  "zoho.com",
  "fastmail.com",
  "hey.com",
  "orange.fr",
  "free.fr",
  "wanadoo.fr",
  "laposte.net",
  "comcast.net",
  "verizon.net",
  "att.net",
  "qq.com",
  "163.com",
  "example.com",
  "example.org",
  "example.net",
]);

const HOST_RE = /^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/** The host of a website or of an email address, lowercased, without www. */
export function hostOf(value: unknown): string | null {
  if (typeof value !== "string") return null;
  let host = value.trim().toLowerCase();
  if (host === "") return null;
  if (host.includes("@")) host = host.slice(host.lastIndexOf("@") + 1);
  host = host.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  host = host.split(/[/?#:]/)[0] ?? "";
  host = host.replace(/^www\./, "");
  return HOST_RE.test(host) ? host : null;
}

async function isExcluded(tx: SqlExecutor, orgId: Uuid, host: string): Promise<boolean> {
  if (DEFAULT_EXCLUDED_DOMAINS.has(host)) return true;
  const result = await tx.execute(
    "SELECT 1 AS hit FROM crm.favicons_excluded_domains f WHERE f.org_id = $1::text::uuid AND lower(f.domain) = $2::text LIMIT 1",
    [orgId, host],
  );
  return result.rows.length > 0;
}

/** The favicon URL of a host if the host serves one, else null. Never throws. */
export async function findFavicon(fetcher: Fetch, host: string): Promise<string | null> {
  const url = `https://${host}/favicon.ico`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetcher(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: { accept: "image/*" },
    });
    const type = response.headers.get("content-type") ?? "";
    await response.body?.cancel();
    return response.ok && /^image\//i.test(type) ? url : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export interface FaviconContext {
  tx: SqlExecutor;
  orgId: Uuid;
  fetcher: Fetch | undefined;
}

/** For a company being saved without a logo: one from its website, if any. */
export async function companyLogo(ctx: FaviconContext, website: unknown): Promise<{ src: string; title: string } | null> {
  const host = hostOf(website);
  if (!ctx.fetcher || !host || (await isExcluded(ctx.tx, ctx.orgId, host))) return null;
  const src = await findFavicon(ctx.fetcher, host);
  return src ? { src, title: "Company favicon" } : null;
}

/** For a contact being saved without an avatar: the favicon of the first
 *  email whose domain is not a mail provider. */
export async function contactAvatar(ctx: FaviconContext, emails: unknown): Promise<{ src: string } | null> {
  if (!ctx.fetcher || !Array.isArray(emails)) return null;
  const tried = new Set<string>();
  for (const item of emails.slice(0, 5)) {
    const host = hostOf(item && typeof item === "object" ? (item as Record<string, unknown>)["email"] : null);
    if (!host || tried.has(host)) continue;
    tried.add(host);
    if (await isExcluded(ctx.tx, ctx.orgId, host)) continue;
    const src = await findFavicon(ctx.fetcher, host);
    if (src) return { src };
  }
  return null;
}
