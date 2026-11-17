// Note attachments are stored by the API (R2 behind crm-worker) and served
// only to a signed-in member of the organization, so the browser cannot use a
// plain URL for them: it fetches the file with its session and shows it from
// memory.
import { HttpError } from "ra-core";

import { apiBaseUrl, crmPath, getSession } from "./client";

/** Marks an attachment whose `src` is a stored file rather than a URL. */
export const ATTACHMENT_SCHEME = "crm-attachment:";

export const isStoredAttachment = (src: string | undefined | null): src is string =>
  typeof src === "string" && src.startsWith(ATTACHMENT_SCHEME);

export type StoredAttachment = { path: string; title: string; type: string; size: number };

function authorization(): Record<string, string> {
  const session = getSession();
  if (!session) throw new HttpError("Not signed in", 401);
  return { authorization: `Bearer ${session.token}` };
}

function fileUrl(path: string): string {
  return `${apiBaseUrl()}${crmPath()}/attachments/${path.split("/").map(encodeURIComponent).join("/")}`;
}

export async function uploadAttachment(file: File): Promise<StoredAttachment> {
  const response = await fetch(
    `${apiBaseUrl()}${crmPath()}/attachments?filename=${encodeURIComponent(file.name)}`,
    {
      method: "POST",
      headers: { ...authorization(), "content-type": file.type || "application/octet-stream" },
      body: file,
    },
  );
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new HttpError(
      response.status === 413 ? "The file is larger than 25 MB" : (payload?.error?.message ?? "Failed to upload attachment"),
      response.status,
      payload,
    );
  }
  return payload.data as StoredAttachment;
}

/** Downloads a stored attachment (its `src`, with the scheme) into memory. */
export async function fetchAttachment(src: string): Promise<Blob> {
  const response = await fetch(fileUrl(src.slice(ATTACHMENT_SCHEME.length)), { headers: authorization() });
  if (!response.ok) throw new HttpError("Failed to load attachment", response.status);
  return response.blob();
}
