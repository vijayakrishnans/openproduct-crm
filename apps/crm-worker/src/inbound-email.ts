// Inbound email → notes (port of upstream's postmark function). An
// organization has one inbound address, `<its public id>@<the inbound
// domain>`. A member puts it in Cc: (or forwards a message to it); the worker
// adds the message as a note to each contact it was exchanged with, creating
// the contact, and its company, when new.
//
// Who may write into an organization this way: only someone whose From:
// address is the email (or a secondary email) of an active CRM profile of that
// organization, on a message that passed DMARC. Everything runs as crm_app
// with the organization set, like any request.
import type { SqlExecutor } from "@saas/db/hyperdrive";
import type { Uuid } from "@saas/db/ids";
import PostalMime from "postal-mime";
import { MAX_ATTACHMENT_BYTES, safeFileName } from "./attachments.js";
import { withOrg, type Db } from "./db.js";
import { DEFAULT_EXCLUDED_DOMAINS, hostOf } from "./favicons.js";
import { parseOrgPublicId } from "./ids.js";

const MAX_NOTE_CHARS = 20_000;
const MAX_CONTACTS = 20;
const MAX_ATTACHMENTS = 10;

export type InboundOutcome =
  | { status: "rejected"; reason: string }
  | { status: "accepted"; orgId: Uuid; noteIds: number[]; contactIds: number[] };

/** What the handler needs of Cloudflare's ForwardableEmailMessage. */
export interface InboundMessage {
  readonly from: string;
  readonly to: string;
  readonly headers: Headers;
  readonly raw: ReadableStream<Uint8Array> | ArrayBuffer | Uint8Array | string;
}

interface Party {
  email: string;
  name: string;
}

const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

function party(entry: { address?: string | undefined; name?: string | undefined } | undefined): Party | null {
  const email = (entry?.address ?? "").trim().toLowerCase();
  return EMAIL_RE.test(email) ? { email, name: (entry?.name ?? "").trim() } : null;
}

/** The organization an inbound address belongs to: its local part is the
 *  org's public id, optionally after a readable prefix and a "+". */
export function orgOfAddress(address: string): Uuid | null {
  const local = address.trim().toLowerCase().split("@")[0] ?? "";
  const tag = local.includes("+") ? local.slice(local.lastIndexOf("+") + 1) : local;
  return parseOrgPublicId(tag);
}

/** True when the receiving server recorded a DMARC pass for the message. */
export function passedDmarc(headers: Headers): boolean {
  const results = headers.get("authentication-results") ?? "";
  return /(^|[;\s])dmarc=pass\b/i.test(results);
}

// --- forwarded messages (port of forwardedParser.ts) -----------------------

const FORWARD_SEPARATORS = [
  /^-{5,}\s*Forwarded message\s*-{5,}/im,
  /^Begin forwarded message:/im,
  /^-{5,}\s*Original Message\s*-{5,}/im,
  /^-{5,}\s*Message transf[eé]r[eé]\s*-{5,}/im,
  /^-{5,}\s*Transf[eé]r[eé]\s*-{5,}/im,
  /^-{5,}\s*Weitergeleitete Nachricht\s*-{5,}/im,
];

/** In a forwarded message, the person it was originally from. */
export function forwardedSender(text: string): Party | null {
  const start = FORWARD_SEPARATORS.map((p) => text.search(p)).filter((i) => i >= 0).sort((a, b) => a - b)[0];
  if (start === undefined) return null;
  const header = text.slice(start).split(/\n\s*\n/)[0] ?? "";
  const line = header.split("\n").find((l) => /^\s*(From|De|Von)\s*:/i.test(l));
  if (!line) return null;
  const value = line.slice(line.indexOf(":") + 1).trim();
  const angled = value.match(/^(.*?)<([^<>\s]+@[^<>\s]+)>/);
  if (angled) return party({ address: angled[2], name: angled[1]!.replace(/["']/g, "").trim() });
  const bare = value.match(/[^\s<>"']+@[^\s<>"']+/);
  return bare ? party({ address: bare[0], name: "" }) : null;
}

export function stripForwardPrefix(subject: string): string {
  const stripped = subject.replace(/^(Fwd|FW|Tr|SV|VS|WG)\s*[:-]\s*/i, "").trim();
  return stripped.length > 0 ? stripped : subject;
}

// --- names (port of extractMailContactData.ts) ------------------------------

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function nameOf(p: Party): { firstName: string; lastName: string } {
  const full = p.name || p.email.split("@")[0]!.split(/[._]/).join(" ");
  const parts = full.split(/\s+/).filter(Boolean);
  if (parts.length < 2) return { firstName: "", lastName: capitalize(parts[0] ?? "") };
  return { firstName: capitalize(parts[0]!), lastName: parts.slice(1).map(capitalize).join(" ") };
}

export function companyNameOf(domain: string): string {
  const labels = domain.split(".");
  // "acme.co.uk" → "acme": the label before a two-part public suffix
  const secondLevel = labels.length >= 3 && labels.at(-2)!.length <= 3 && labels.at(-1)!.length === 2;
  const name = labels.at(secondLevel ? -3 : -2) ?? domain;
  return name
    .replace(/[-_]+/g, " ")
    .split(" ")
    .map(capitalize)
    .join(" ");
}

// --- database ---------------------------------------------------------------

interface Sale {
  id: number;
  subject_id: string;
}

/** The active profile this sender writes as: by primary email, else by a
 *  secondary email claimed by exactly one profile. */
async function findSale(tx: SqlExecutor, orgId: Uuid, email: string): Promise<Sale | null> {
  const primary = await tx.execute<{ id: number; subject_id: string }>(
    `SELECT s.id, s.subject_id FROM crm.sales s
     WHERE s.org_id = $1::text::uuid AND lower(s.email) = $2::text AND NOT s.disabled`,
    [orgId, email],
  );
  if (primary.rows[0]) return { id: Number(primary.rows[0].id), subject_id: primary.rows[0].subject_id };

  const secondary = await tx.execute<{ id: number; subject_id: string }>(
    `SELECT s.id, s.subject_id FROM crm.sales s
     WHERE s.org_id = $1::text::uuid AND NOT s.disabled
       AND EXISTS (SELECT FROM jsonb_array_elements_text(s.secondary_emails) e WHERE lower(e) = $2::text)
     ORDER BY s.id LIMIT 2`,
    [orgId, email],
  );
  // Claimed by two profiles: refuse rather than guess.
  if (secondary.rows.length !== 1) return null;
  return { id: Number(secondary.rows[0]!.id), subject_id: secondary.rows[0]!.subject_id };
}

async function findOrCreateCompany(tx: SqlExecutor, orgId: Uuid, saleId: number, domain: string): Promise<number | null> {
  // Mail providers are not companies.
  if (!hostOf(domain) || DEFAULT_EXCLUDED_DOMAINS.has(domain)) return null;
  const name = companyNameOf(domain);
  const existing = await tx.execute<{ id: number }>(
    `SELECT c.id FROM crm.companies c
     WHERE c.org_id = $1::text::uuid
       AND (lower(c.name) IN (lower($2::text), $3::text)
         OR regexp_replace(lower(coalesce(c.website, '')), '^https?://(www\\.)?|/.*$', '', 'g') = $3::text)
     ORDER BY c.id LIMIT 1`,
    [orgId, name, domain],
  );
  if (existing.rows[0]) return Number(existing.rows[0].id);
  const created = await tx.execute<{ id: number }>(
    `INSERT INTO crm.companies (org_id, name, website, sales_id)
     VALUES ($1::text::uuid, $2::text, $3::text, $4::text::bigint) RETURNING id`,
    [orgId, name, `https://${domain}`, String(saleId)],
  );
  return Number(created.rows[0]!.id);
}

async function findOrCreateContact(tx: SqlExecutor, orgId: Uuid, saleId: number, p: Party): Promise<number> {
  const existing = await tx.execute<{ id: number }>(
    `SELECT c.id FROM crm.contacts c
     WHERE c.org_id = $1::text::uuid AND c.email_jsonb @> jsonb_build_array(jsonb_build_object('email', $2::text))
     ORDER BY c.id LIMIT 1`,
    [orgId, p.email],
  );
  if (existing.rows[0]) return Number(existing.rows[0].id);

  const domain = p.email.split("@")[1]!;
  const companyId = await findOrCreateCompany(tx, orgId, saleId, domain);
  const { firstName, lastName } = nameOf(p);
  const created = await tx.execute<{ id: number }>(
    `INSERT INTO crm.contacts (org_id, first_name, last_name, email_jsonb, company_id, sales_id, first_seen, last_seen, tags)
     VALUES ($1::text::uuid, $2::text, $3::text, jsonb_build_array(jsonb_build_object('email', $4::text, 'type', 'Work')),
             $5::text::bigint, $6::text::bigint, now(), now(), '{}')
     RETURNING id`,
    [orgId, firstName, lastName, p.email, companyId === null ? null : String(companyId), String(saleId)],
  );
  return Number(created.rows[0]!.id);
}

// --- the handler ------------------------------------------------------------

export interface InboundDeps {
  db: Db;
  bucket: R2Bucket | undefined;
}

export async function handleInboundEmail(message: InboundMessage, deps: InboundDeps): Promise<InboundOutcome> {
  const orgId = orgOfAddress(message.to);
  if (!orgId) return { status: "rejected", reason: "Unknown address" };
  if (!passedDmarc(message.headers)) return { status: "rejected", reason: "The message did not pass DMARC" };

  const raw = message.raw instanceof ReadableStream ? await new Response(message.raw).arrayBuffer() : message.raw;
  const mail = await PostalMime.parse(raw);

  // The From: header is the identity DMARC vouches for.
  const sender = party(mail.from);
  if (!sender) return { status: "rejected", reason: "The message has no sender" };

  const text = (mail.text ?? "").trim();
  const inbound = message.to.trim().toLowerCase();
  const seen = new Set<string>([sender.email, inbound]);
  const contacts: Party[] = [];
  for (const entry of [...(mail.to ?? []), ...(mail.cc ?? [])]) {
    const p = party(entry);
    if (!p || seen.has(p.email) || orgOfAddress(p.email)) continue;
    seen.add(p.email);
    contacts.push(p);
  }
  // Sent to the inbound address alone: a forward, about its original sender.
  let subject = (mail.subject ?? "").trim();
  if (contacts.length === 0) {
    const original = forwardedSender(text);
    if (original && !seen.has(original.email)) {
      contacts.push(original);
      subject = stripForwardPrefix(subject);
    }
  }
  if (contacts.length === 0) return { status: "rejected", reason: "No contact to attach the message to" };

  const note = [subject, text].filter(Boolean).join("\n\n").slice(0, MAX_NOTE_CHARS);
  const files = (mail.attachments ?? [])
    .filter((a) => a.disposition !== "inline" && typeof a.content !== "string")
    .slice(0, MAX_ATTACHMENTS)
    .map((a) => ({ name: safeFileName(a.filename ?? null), type: a.mimeType || "application/octet-stream", body: a.content as ArrayBuffer }))
    .filter((f) => f.body.byteLength > 0 && f.body.byteLength <= MAX_ATTACHMENT_BYTES);

  const uploaded: string[] = [];
  try {
    return await withOrg(deps.db, { orgId, subjectId: "inbound-email" }, async (tx) => {
      const sale = await findSale(tx, orgId, sender.email);
      if (!sale) return { status: "rejected", reason: "The sender is not an active member of this organization" } as const;

      const noteIds: number[] = [];
      const contactIds: number[] = [];
      for (const p of contacts.slice(0, MAX_CONTACTS)) {
        const contactId = await findOrCreateContact(tx, orgId, sale.id, p);
        // Each note owns its copies, so deleting one note never takes a
        // file away from another.
        const attachments = [];
        if (deps.bucket) {
          for (const file of files) {
            const path = `${crypto.randomUUID()}/${file.name}`;
            await deps.bucket.put(`${orgId}/${path}`, file.body, { httpMetadata: { contentType: file.type } });
            uploaded.push(`${orgId}/${path}`);
            attachments.push({ path, title: file.name, type: file.type, size: file.body.byteLength });
          }
        }
        const created = await tx.execute<{ id: number }>(
          `INSERT INTO crm.contact_notes (org_id, contact_id, text, sales_id, attachments)
           VALUES ($1::text::uuid, $2::text::bigint, $3::text, $4::text::bigint,
                   ARRAY(SELECT jsonb_array_elements($5::text::jsonb)))
           RETURNING id`,
          [orgId, String(contactId), note, String(sale.id), JSON.stringify(attachments)],
        );
        noteIds.push(Number(created.rows[0]!.id));
        contactIds.push(contactId);
      }
      return { status: "accepted", orgId, noteIds, contactIds } as const;
    });
  } catch (err) {
    // The notes were rolled back: their files must not stay behind.
    if (deps.bucket && uploaded.length > 0) await deps.bucket.delete(uploaded).catch(() => undefined);
    throw err;
  }
}
