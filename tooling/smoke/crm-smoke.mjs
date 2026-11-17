#!/usr/bin/env node
// The CRM's end-to-end smoke (zero-dependency): sign up → organization →
// contact → deal → note with an attachment → search, through the public API
// of one environment. It then checks that a second, unrelated account sees
// none of it, and removes what it created.
//
//   node tooling/smoke/crm-smoke.mjs --api https://<api-edge host>
//
// Signing in:
//   * Where identity returns sign-in codes inline (stage), the script signs up
//     a fresh throwaway address by itself.
//   * Anywhere else (prod), give it a credential of an existing organization:
//       CRM_SMOKE_TOKEN=<session token or API key> CRM_SMOKE_ORG=<org_…>
//     It then skips sign-up and organization creation, and the cross-account
//     check needs CRM_SMOKE_OTHER_TOKEN (optional).
//
// Exit code 0 only if every step passed. Nothing secret is printed.

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const API = (flag("--api") ?? process.env.CRM_SMOKE_API ?? "").replace(/\/+$/, "");
if (!API) {
  console.error("usage: crm-smoke.mjs --api https://<api-edge host>");
  process.exit(2);
}

const stamp = Date.now().toString(36);
let failed = 0;

async function call(method, path, { token, body, raw, type } = {}) {
  const headers = { "user-agent": "crm-smoke" };
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  if (raw !== undefined) headers["content-type"] = type ?? "application/octet-stream";
  const response = await fetch(API + path, {
    method,
    headers,
    body: raw !== undefined ? raw : body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // not JSON (a downloaded file)
  }
  return { status: response.status, data: json?.data ?? null, error: json?.error ?? null, text };
}

function check(name, ok, detail = "") {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed++;
  return ok;
}

async function signUp(email) {
  const start = await call("POST", "/v1/auth/login/start", { body: { email } });
  const code = start.data?.delivery?.code;
  if (!code) return null;
  const done = await call("POST", "/v1/auth/login/complete", { body: { challengeId: start.data.challengeId, code } });
  return done.data?.token ?? null;
}

async function workspace(label) {
  const token = await signUp(`crm-smoke-${label}-${stamp}@example.com`);
  if (!token) return null;
  const org = await call("POST", "/v1/organizations", {
    token,
    body: { name: `CRM smoke ${label} ${stamp}`, slug: `crm-smoke-${label}-${stamp}` },
  });
  return org.status === 201 ? { token, orgId: org.data.organization.id } : null;
}

const health = await call("GET", "/health");
check("api-edge is healthy", health.status === 200, `HTTP ${health.status}`);

let me;
let other = null;
if (process.env.CRM_SMOKE_TOKEN && process.env.CRM_SMOKE_ORG) {
  me = { token: process.env.CRM_SMOKE_TOKEN, orgId: process.env.CRM_SMOKE_ORG };
  check("credential given (sign-up and organization creation skipped)", true);
  if (process.env.CRM_SMOKE_OTHER_TOKEN) other = { token: process.env.CRM_SMOKE_OTHER_TOKEN, orgId: null };
} else {
  me = await workspace("a");
  if (!check("sign up and create an organization", me !== null, me ? me.orgId : "this API does not return sign-in codes; set CRM_SMOKE_TOKEN and CRM_SMOKE_ORG")) {
    process.exit(1);
  }
  other = await workspace("b");
}

const crm = `/v1/organizations/${me.orgId}/crm`;
const created = [];

const profile = await call("GET", `${crm}/sales/me`, { token: me.token });
check("CRM profile", profile.status === 200, `HTTP ${profile.status}`);

const company = await call("POST", `${crm}/companies`, { token: me.token, body: { name: `Smoke Corp ${stamp}` } });
check("create a company", company.status === 201, `HTTP ${company.status}`);
if (company.data) created.push(["companies", company.data.id]);

const word = `smoke${stamp}`;
const contact = await call("POST", `${crm}/contacts`, {
  token: me.token,
  body: {
    first_name: "Smoke",
    last_name: word,
    company_id: company.data?.id,
    email_jsonb: [{ email: `${word}@example.com`, type: "Work" }],
  },
});
check("create a contact", contact.status === 201, `HTTP ${contact.status}${contact.error ? ` ${contact.error.code}` : ""}`);
if (contact.data) created.push(["contacts", contact.data.id]);

const deal = await call("POST", `${crm}/deals`, {
  token: me.token,
  body: { name: `Smoke deal ${stamp}`, stage: "opportunity", company_id: company.data?.id, contact_ids: [contact.data?.id], amount: 100 },
});
check("create a deal", deal.status === 201, `HTTP ${deal.status}`);
if (deal.data) created.push(["deals", deal.data.id]);

const content = `smoke attachment ${stamp}`;
const upload = await call("POST", `${crm}/attachments?filename=smoke.txt`, { token: me.token, raw: content, type: "text/plain" });
check("upload a file", upload.status === 201, `HTTP ${upload.status}`);

const note = await call("POST", `${crm}/contact_notes`, {
  token: me.token,
  body: { contact_id: contact.data?.id, text: `Smoke note ${stamp}`, attachments: upload.data ? [upload.data] : [] },
});
check("add a note with the attachment", note.status === 201 && note.data?.attachments?.length === 1, `HTTP ${note.status}`);

const filePath = upload.data ? upload.data.path.split("/").map(encodeURIComponent).join("/") : "";
const download = await call("GET", `${crm}/attachments/${filePath}`, { token: me.token });
check("download the attachment, unchanged", download.status === 200 && download.text === content, `HTTP ${download.status}`);

const search = await call("GET", `${crm}/search?q=${word}`, { token: me.token });
const found = (search.data?.items ?? []).some((item) => item.resource === "contacts" && item.record_id === contact.data?.id);
check("search finds the contact", search.status === 200 && found, `HTTP ${search.status}`);

if (other) {
  const theirs = await call("GET", `${crm}/contacts/${contact.data?.id}`, { token: other.token });
  check("another account gets 404 for the contact", theirs.status === 404, `HTTP ${theirs.status}`);
  const theirFile = await call("GET", `${crm}/attachments/${filePath}`, { token: other.token });
  check("another account gets 404 for the file", theirFile.status === 404, `HTTP ${theirFile.status}`);
  if (other.orgId) {
    const viaOwn = await call("GET", `/v1/organizations/${other.orgId}/crm/search?q=${word}`, { token: other.token });
    check("another organization's search finds nothing", viaOwn.status === 200 && (viaOwn.data?.items ?? []).length === 0, `HTTP ${viaOwn.status}`);
  }
} else {
  console.log("skip another account's checks (no second credential)");
}

// Clean up: the company takes its contact, deal, notes and their files along.
for (const [resource, id] of created.filter(([resource]) => resource === "companies")) {
  const removed = await call("DELETE", `${crm}/${resource}/${id}`, { token: me.token });
  check(`clean up ${resource}/${id}`, removed.status === 200, `HTTP ${removed.status}`);
}
const after = await call("GET", `${crm}/attachments/${filePath}`, { token: me.token });
check("the file is gone with its note", after.status === 404, `HTTP ${after.status}`);

console.log(failed === 0 ? "\nCRM smoke passed" : `\nCRM smoke FAILED (${failed})`);
process.exit(failed === 0 ? 0 : 1);
