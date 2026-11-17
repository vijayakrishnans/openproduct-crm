import { uuidFromPublicId, type Uuid } from "@saas/db/ids";

export function generateRequestId(): string {
  const buf = new Uint8Array(12);
  crypto.getRandomValues(buf);
  let hex = "";
  for (let i = 0; i < buf.length; i++) {
    hex += buf[i]!.toString(16).padStart(2, "0");
  }
  return `req_${hex}`;
}

export function parseOrgPublicId(publicId: string): Uuid | null {
  return uuidFromPublicId(publicId, "org");
}

/** CRM record ids are positive integers that fit a JS number. */
export function parseRecordId(raw: string): string | null {
  if (!/^[1-9]\d{0,15}$/.test(raw)) return null;
  return Number(raw) <= Number.MAX_SAFE_INTEGER ? raw : null;
}
