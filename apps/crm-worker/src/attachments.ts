// Note attachments live in R2. A file's path, as notes store it and clients
// see it, is relative to its organization: "<uuid>/<file name>". The worker
// alone adds the organization prefix, so a path can never name another
// organization's object, whatever a client sends.
import type { SqlExecutor } from "@saas/db/hyperdrive";
import type { Uuid } from "@saas/db/ids";
import { errorResponse, notFound, successResponse, validationError } from "./http.js";

export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

const PATH_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[^/\\\u0000-\u001f]{1,200}$/;

export function isAttachmentPath(path: unknown): path is string {
  return typeof path === "string" && PATH_RE.test(path);
}

function objectKey(orgId: Uuid, path: string): string {
  return `${orgId}/${path}`;
}

/** A file name safe to keep in a key and a header: the base name, with
 *  anything unusual replaced. */
export function safeFileName(raw: string | null): string {
  const base = (raw ?? "").split(/[/\\]/).pop() ?? "";
  const cleaned = base
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f"<>|:*?]/g, "_")
    .trim()
    .slice(-200);
  return cleaned === "" || cleaned === "." || cleaned === ".." ? "file" : cleaned;
}

export async function handleUpload(
  request: Request,
  bucket: R2Bucket,
  orgId: Uuid,
  requestId: string,
): Promise<Response> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_ATTACHMENT_BYTES) {
    return errorResponse("payload_too_large", "The file is larger than 25 MB", 413, requestId);
  }
  const body = await request.arrayBuffer();
  if (body.byteLength === 0) return validationError(requestId, { body: ["the file is empty"] });
  if (body.byteLength > MAX_ATTACHMENT_BYTES) {
    return errorResponse("payload_too_large", "The file is larger than 25 MB", 413, requestId);
  }

  const name = safeFileName(new URL(request.url).searchParams.get("filename"));
  const type = (request.headers.get("content-type") ?? "application/octet-stream").slice(0, 200);
  const path = `${crypto.randomUUID()}/${name}`;

  await bucket.put(objectKey(orgId, path), body, { httpMetadata: { contentType: type } });

  return successResponse({ path, title: name, type, size: body.byteLength }, requestId, 201);
}

export async function handleDownload(
  bucket: R2Bucket,
  orgId: Uuid,
  path: string,
  requestId: string,
): Promise<Response> {
  if (!isAttachmentPath(path)) return notFound(requestId);
  const object = await bucket.get(objectKey(orgId, path));
  if (!object) return notFound(requestId);

  const name = path.slice(path.indexOf("/") + 1);
  // Uploaded content is never rendered by this origin: always a download,
  // never sniffed.
  return new Response(object.body, {
    status: 200,
    headers: {
      "content-type": object.httpMetadata?.contentType ?? "application/octet-stream",
      "content-length": String(object.size),
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
      "x-content-type-options": "nosniff",
      "cache-control": "private, max-age=300",
    },
  });
}

export async function deleteObjects(bucket: R2Bucket | undefined, orgId: Uuid, paths: string[]): Promise<void> {
  const keys = [...new Set(paths)].filter(isAttachmentPath).map((path) => objectKey(orgId, path));
  if (!bucket || keys.length === 0) return;
  // R2 deletes up to 1000 keys per call.
  for (let i = 0; i < keys.length; i += 1000) {
    await bucket.delete(keys.slice(i, i + 1000));
  }
}

/** The paths in an `attachments` value as a client sent it or a row holds it. */
export function pathsOf(attachments: unknown): string[] {
  if (!Array.isArray(attachments)) return [];
  return attachments
    .map((a) => (a && typeof a === "object" ? (a as Record<string, unknown>)["path"] : undefined))
    .filter(isAttachmentPath);
}

/** Checks the attachments of a note being saved; null when they are fine. */
export function attachmentsError(attachments: unknown): string | null {
  if (attachments === null || attachments === undefined) return null;
  if (!Array.isArray(attachments)) return "must be a list";
  if (attachments.length > 50) return "at most 50 files per note";
  for (const item of attachments) {
    const path = item && typeof item === "object" ? (item as Record<string, unknown>)["path"] : undefined;
    if (!isAttachmentPath(path)) return "every attachment needs the path its upload returned";
  }
  return null;
}

const NOTE_TABLES: Record<string, string> = {
  contact_notes: "crm.contact_notes",
  deal_notes: "crm.deal_notes",
};

export function isNoteResource(name: string): boolean {
  return name in NOTE_TABLES;
}

const PATHS_OF_NOTES = (table: string, where: string) =>
  `SELECT a ->> 'path' AS path FROM ${table} n, unnest(n.attachments) AS a
   WHERE n.org_id = $1::text::uuid AND ${where}`;

/** Every attachment path that deleting (or, for a note, replacing) this
 *  record would orphan: its own, or those of the notes that cascade with it. */
export async function attachmentPathsUnder(
  tx: SqlExecutor,
  orgId: Uuid,
  resource: string,
  id: string,
): Promise<string[]> {
  const queries: string[] = [];
  if (resource === "contact_notes" || resource === "deal_notes") {
    queries.push(PATHS_OF_NOTES(NOTE_TABLES[resource]!, "n.id = $2::text::bigint"));
  } else if (resource === "contacts") {
    queries.push(PATHS_OF_NOTES("crm.contact_notes", "n.contact_id = $2::text::bigint"));
  } else if (resource === "deals") {
    queries.push(PATHS_OF_NOTES("crm.deal_notes", "n.deal_id = $2::text::bigint"));
  } else if (resource === "companies") {
    queries.push(
      PATHS_OF_NOTES(
        "crm.contact_notes",
        "n.contact_id IN (SELECT c.id FROM crm.contacts c WHERE c.org_id = $1::text::uuid AND c.company_id = $2::text::bigint)",
      ),
      PATHS_OF_NOTES(
        "crm.deal_notes",
        "n.deal_id IN (SELECT d.id FROM crm.deals d WHERE d.org_id = $1::text::uuid AND d.company_id = $2::text::bigint)",
      ),
    );
  }
  const paths: string[] = [];
  for (const sql of queries) {
    const result = await tx.execute<{ path: string | null }>(sql, [orgId, id]);
    for (const row of result.rows) if (isAttachmentPath(row.path)) paths.push(row.path);
  }
  return paths;
}
