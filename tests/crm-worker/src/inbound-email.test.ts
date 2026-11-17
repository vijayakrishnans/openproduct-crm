// M4: inbound email → notes. Raw RFC 822 messages go through the same parser
// and the same crm_app transaction as on Workers, against PGlite.
import {
  companyNameOf,
  forwardedSender,
  handleInboundEmail,
  nameOf,
  orgOfAddress,
  passedDmarc,
} from "@crm-worker/inbound-email";
import { createHarness, executorFor, orgPublicId, type Harness, type Member } from "./harness";

const ORG_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ORG_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const A = `/v1/organizations/${orgPublicId(ORG_A)}/crm`;
const B = `/v1/organizations/${orgPublicId(ORG_B)}/crm`;
const INBOUND_A = `${orgPublicId(ORG_A)}@inbound.crm.test`;
const INBOUND_B = `${orgPublicId(ORG_B)}@inbound.crm.test`;

const alice: Member = { subjectId: "usr_alice", email: "alice@a.test", roles: { [ORG_A]: "owner" } };
const bob: Member = { subjectId: "usr_bob", email: "bob@b.test", roles: { [ORG_B]: "owner" } };

const DMARC_PASS = "mx.cloudflare.net; dkim=pass header.d=a.test; spf=pass; dmarc=pass header.from=a.test";

function rfc822({
  from,
  to,
  cc,
  subject,
  body,
  attachment,
}: {
  from: string;
  to: string;
  cc?: string;
  subject: string;
  body: string;
  attachment?: { name: string; type: string; content: string };
}): string {
  const headers = [`From: ${from}`, `To: ${to}`, ...(cc ? [`Cc: ${cc}`] : []), `Subject: ${subject}`, "MIME-Version: 1.0"];
  if (!attachment) {
    return [...headers, 'Content-Type: text/plain; charset="utf-8"', "", body].join("\r\n");
  }
  return [
    ...headers,
    'Content-Type: multipart/mixed; boundary="b1"',
    "",
    "--b1",
    'Content-Type: text/plain; charset="utf-8"',
    "",
    body,
    "--b1",
    `Content-Type: ${attachment.type}; name="${attachment.name}"`,
    `Content-Disposition: attachment; filename="${attachment.name}"`,
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(attachment.content).toString("base64"),
    "--b1--",
    "",
  ].join("\r\n");
}

describe("inbound email helpers", () => {
  it("reads the organization from the address", () => {
    expect(orgOfAddress(INBOUND_A)).toBe(ORG_A);
    expect(orgOfAddress(`Sales+${orgPublicId(ORG_A)}@inbound.crm.test`)).toBe(ORG_A);
    expect(orgOfAddress("hello@inbound.crm.test")).toBeNull();
    expect(orgOfAddress("org_123@inbound.crm.test")).toBeNull();
  });

  it("requires a recorded DMARC pass", () => {
    expect(passedDmarc(new Headers({ "authentication-results": DMARC_PASS }))).toBe(true);
    expect(passedDmarc(new Headers({ "authentication-results": "mx; spf=pass; dmarc=fail" }))).toBe(false);
    expect(passedDmarc(new Headers({ "authentication-results": "mx; spf=pass; dmarc=none" }))).toBe(false);
    expect(passedDmarc(new Headers({ "authentication-results": "mx; x-dmarc=passing" }))).toBe(false);
    expect(passedDmarc(new Headers())).toBe(false);
  });

  it("finds the original sender of a forward", () => {
    expect(
      forwardedSender("see below\n\n---------- Forwarded message ---------\nFrom: Jane Smith <Jane@Smith-Corp.test>\nDate: today\n\nHello"),
    ).toEqual({ email: "jane@smith-corp.test", name: "Jane Smith" });
    expect(forwardedSender("Begin forwarded message:\n\nFrom: jane@smith.test\n\nHi")).toBeNull();
    expect(forwardedSender("Begin forwarded message:\nFrom: jane@smith.test\n\nHi")).toEqual({ email: "jane@smith.test", name: "" });
    expect(forwardedSender("From: not@a-forward.test\n\nHi")).toBeNull();
  });

  it("derives names from an address", () => {
    expect(nameOf({ email: "jane.smith@x.test", name: "" })).toEqual({ firstName: "Jane", lastName: "Smith" });
    expect(nameOf({ email: "j@x.test", name: "Jane van Smith" })).toEqual({ firstName: "Jane", lastName: "Van Smith" });
    expect(nameOf({ email: "info@x.test", name: "" })).toEqual({ firstName: "", lastName: "Info" });
    expect(companyNameOf("smith-corp.test")).toBe("Smith Corp");
    expect(companyNameOf("mail.acme.co.uk")).toBe("Acme");
  });
});

describe("inbound email", () => {
  let h: Harness;

  const deliver = (raw: string, to: string, authentication = DMARC_PASS) =>
    handleInboundEmail(
      { from: "bounce@a.test", to, headers: new Headers({ "authentication-results": authentication }), raw },
      { db: executorFor(h.pg), bucket: h.bucket as unknown as R2Bucket },
    );
  const counts = async (org: string) => {
    const res = await h.pg.query<{ contacts: number; notes: number; companies: number }>(
      `SELECT (SELECT count(*)::int FROM crm.contacts WHERE org_id = $1) AS contacts,
              (SELECT count(*)::int FROM crm.contact_notes WHERE org_id = $1) AS notes,
              (SELECT count(*)::int FROM crm.companies WHERE org_id = $1) AS companies`,
      [org],
    );
    return res.rows[0]!;
  };

  beforeAll(async () => {
    h = await createHarness([alice, bob]);
    // Profiles exist once a member has used the CRM.
    await h.call(alice, "GET", `${A}/sales/me`);
    await h.call(bob, "GET", `${B}/sales/me`);
  }, 120_000);

  afterAll(async () => {
    await h.close();
  });

  it("adds a note to a known contact, written as the sender", async () => {
    const contact = await h.call(alice, "POST", `${A}/contacts`, {
      first_name: "Jane",
      last_name: "Smith",
      email_jsonb: [{ email: "jane@smith-corp.test" }],
    });
    const before = await counts(ORG_A);

    const outcome = await deliver(
      rfc822({
        from: "Alice <Alice@A.test>",
        to: "Jane Smith <jane@smith-corp.test>",
        cc: INBOUND_A,
        subject: "Renewal",
        body: "Hi Jane,\r\nhere is the offer.",
      }),
      INBOUND_A,
    );
    expect(outcome).toMatchObject({ status: "accepted", contactIds: [contact.body.data.id] });

    const after = await counts(ORG_A);
    expect(after).toEqual({ ...before, notes: before.notes + 1 });
    const notes = await h.call(alice, "GET", `${A}/contact_notes?filter=${encodeURIComponent(JSON.stringify({ contact_id: contact.body.data.id }))}`);
    expect(notes.body.data.items[0]).toMatchObject({ text: "Renewal\n\nHi Jane,\nhere is the offer." });
    const me = await h.call(alice, "GET", `${A}/sales/me`);
    expect(notes.body.data.items[0].sales_id).toBe(me.body.data.id);
  });

  it("creates the contact and its company when new, but no company for a mail provider", async () => {
    const outcome = await deliver(
      rfc822({
        from: "alice@a.test",
        to: "Grace Hopper <grace@navy-labs.test>, someone@gmail.com",
        cc: INBOUND_A,
        subject: "Intro",
        body: "Hello both",
      }),
      INBOUND_A,
    );
    expect(outcome.status).toBe("accepted");

    const contacts = await h.call(alice, "GET", `${A}/contacts_summary?sort=id&order=DESC&perPage=2`);
    const byName = Object.fromEntries(contacts.body.data.items.map((c: any) => [c.last_name, c]));
    expect(byName["Hopper"]).toMatchObject({ first_name: "Grace", company_name: "Navy Labs" });
    expect(byName["Hopper"].email_jsonb).toEqual([{ email: "grace@navy-labs.test", type: "Work" }]);
    expect(byName["Someone"]).toMatchObject({ company_id: null });

    // A second message reuses both
    const before = await counts(ORG_A);
    await deliver(rfc822({ from: "alice@a.test", to: "grace@navy-labs.test", cc: INBOUND_A, subject: "Again", body: "x" }), INBOUND_A);
    expect(await counts(ORG_A)).toEqual({ ...before, notes: before.notes + 1 });
  });

  it("attaches the message's files to the note, in the organization's bucket", async () => {
    const outcome = await deliver(
      rfc822({
        from: "alice@a.test",
        to: "grace@navy-labs.test",
        cc: INBOUND_A,
        subject: "Quote",
        body: "attached",
        attachment: { name: "quote.txt", type: "text/plain", content: "the quote" },
      }),
      INBOUND_A,
    );
    if (outcome.status !== "accepted") throw new Error("expected the message to be accepted");
    const note = await h.call(alice, "GET", `${A}/contact_notes/${outcome.noteIds[0]}`);
    const [file] = note.body.data.attachments;
    expect(file).toMatchObject({ title: "quote.txt", type: "text/plain", size: 9 });
    const download = await h.download(alice, `${A}/attachments/${file.path}`);
    expect(new TextDecoder().decode(download.bytes)).toBe("the quote");
    // and it goes away with the note
    await h.call(alice, "DELETE", `${A}/contact_notes/${outcome.noteIds[0]}`);
    expect((await h.download(alice, `${A}/attachments/${file.path}`)).status).toBe(404);
  });

  it("takes a forward to the inbound address as a note about its original sender", async () => {
    const outcome = await deliver(
      rfc822({
        from: "alice@a.test",
        to: INBOUND_A,
        subject: "Fwd: Pricing question",
        body: "FYI\r\n\r\n---------- Forwarded message ---------\r\nFrom: Linus Vale <linus@vale-works.test>\r\nSubject: Pricing question\r\n\r\nHow much?",
      }),
      INBOUND_A,
    );
    if (outcome.status !== "accepted") throw new Error("expected the message to be accepted");
    const note = await h.call(alice, "GET", `${A}/contact_notes/${outcome.noteIds[0]}`);
    expect(note.body.data.text.startsWith("Pricing question\n\n")).toBe(true);
    const contact = await h.call(alice, "GET", `${A}/contacts_summary/${outcome.contactIds[0]}`);
    expect(contact.body.data).toMatchObject({ first_name: "Linus", last_name: "Vale", company_name: "Vale Works" });
  });

  describe("refuses", () => {
    const message = (from: string, to = "jane@smith-corp.test") =>
      rfc822({ from, to, cc: INBOUND_A, subject: "s", body: "b" });

    it.each([
      ["a sender who is not a member", () => deliver(message("mallory@evil.test"), INBOUND_A), /not an active member/],
      ["a member of another organization", () => deliver(message("bob@b.test"), INBOUND_A), /not an active member/],
      ["a message that failed DMARC, even from a member", () => deliver(message("alice@a.test"), INBOUND_A, "mx; dmarc=fail"), /DMARC/],
      ["an address that is no organization", () => deliver(message("alice@a.test"), "sales@inbound.crm.test"), /Unknown address/],
      ["a message with nobody to attach it to", () => deliver(rfc822({ from: "alice@a.test", to: INBOUND_A, subject: "s", body: "b" }), INBOUND_A), /No contact/],
    ])("%s", async (_label, send, reason) => {
      const before = [await counts(ORG_A), await counts(ORG_B)];
      const files = h.bucket.objects.size;
      const outcome = await send();
      expect(outcome).toEqual({ status: "rejected", reason: expect.stringMatching(reason) });
      expect([await counts(ORG_A), await counts(ORG_B)]).toEqual(before);
      expect(h.bucket.objects.size).toBe(files);
    });

    it("a disabled member", async () => {
      const me = await h.call(alice, "GET", `${A}/sales/me`);
      await h.pg.query("UPDATE crm.sales SET disabled = true WHERE id = $1", [me.body.data.id]);
      const outcome = await deliver(message("alice@a.test"), INBOUND_A);
      expect(outcome).toMatchObject({ status: "rejected" });
      await h.pg.query("UPDATE crm.sales SET disabled = false WHERE id = $1", [me.body.data.id]);
    });
  });

  it("accepts a secondary email of one profile, and refuses one claimed by two", async () => {
    const me = await h.call(alice, "GET", `${A}/sales/me`);
    await h.call(alice, "PATCH", `${A}/sales/${me.body.data.id}`, { secondary_emails: ["Alice.Alt@a.test"] });
    const ok = await deliver(rfc822({ from: "alice.alt@a.test", to: "jane@smith-corp.test", cc: INBOUND_A, subject: "s", body: "b" }), INBOUND_A);
    expect(ok.status).toBe("accepted");

    await h.pg.query(
      `INSERT INTO crm.sales (org_id, subject_id, email, secondary_emails) VALUES ($1, 'usr_twin', 'twin@a.test', '["alice.alt@a.test"]')`,
      [ORG_A],
    );
    const ambiguous = await deliver(rfc822({ from: "alice.alt@a.test", to: "jane@smith-corp.test", cc: INBOUND_A, subject: "s", body: "b" }), INBOUND_A);
    expect(ambiguous).toMatchObject({ status: "rejected" });
  });

  it("writes only into the organization of the address", async () => {
    const before = await counts(ORG_A);
    const outcome = await deliver(
      rfc822({ from: "bob@b.test", to: "jane@smith-corp.test", cc: INBOUND_B, subject: "For B", body: "b" }),
      INBOUND_B,
    );
    expect(outcome).toMatchObject({ status: "accepted", orgId: ORG_B });
    expect(await counts(ORG_A)).toEqual(before);
    // org B got its own contact (named after the address), not org A's Jane Smith
    const contacts = await h.call(bob, "GET", `${B}/contacts`);
    expect(contacts.body.data.items.map((c: any) => c.last_name)).toEqual(["Jane"]);
    const inA = await h.call(alice, "GET", `${A}/contacts?filter=${encodeURIComponent(JSON.stringify({ q: "For B" }))}`);
    expect(inA.body.data.total).toBe(0);
  });
});
