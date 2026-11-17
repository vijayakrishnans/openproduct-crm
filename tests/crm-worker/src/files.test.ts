// M4: note attachments in R2, and favicons for companies and contacts.
import { createHarness, orgPublicId, type Harness, type Member } from "./harness";

const ORG_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ORG_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const A = `/v1/organizations/${orgPublicId(ORG_A)}/crm`;
const B = `/v1/organizations/${orgPublicId(ORG_B)}/crm`;

const alice: Member = { subjectId: "usr_alice", email: "alice@a.test", roles: { [ORG_A]: "owner" } };
const viewer: Member = { subjectId: "usr_viewer", email: "vera@a.test", roles: { [ORG_A]: "viewer" } };
const bob: Member = { subjectId: "usr_bob", email: "bob@b.test", roles: { [ORG_B]: "owner" } };

const text = (bytes: Uint8Array | undefined) => new TextDecoder().decode(bytes);

describe("attachments", () => {
  let h: Harness;
  let contactId: number;

  const upload = async (name: string, content: string, type = "text/plain") => {
    const res = await h.upload(alice, `${A}/attachments?filename=${encodeURIComponent(name)}`, content, type);
    expect(res.status).toBe(201);
    return res.body.data as { path: string; title: string; type: string; size: number };
  };
  const url = (base: string, path: string) =>
    `${base}/attachments/${path.split("/").map(encodeURIComponent).join("/")}`;
  const stored = () => [...h.bucket.objects.keys()].sort();

  beforeAll(async () => {
    h = await createHarness([alice, viewer, bob]);
    const contact = await h.call(alice, "POST", `${A}/contacts`, { first_name: "Ada", last_name: "Lovelace" });
    contactId = contact.body.data.id;
  }, 120_000);

  afterAll(async () => {
    await h.close();
  });

  it("stores an upload under its organization and returns its relative path", async () => {
    const file = await upload("Quote 2026.pdf", "%PDF quote", "application/pdf");
    expect(file).toEqual({
      path: expect.stringMatching(/^[0-9a-f-]{36}\/Quote 2026\.pdf$/),
      title: "Quote 2026.pdf",
      type: "application/pdf",
      size: 10,
    });
    expect(stored()).toEqual([`${ORG_A}/${file.path}`]);
  });

  it("serves a file back as a download, to readers too", async () => {
    const file = await upload("notes.txt", "hello");
    const res = await h.download(viewer, url(A, file.path));
    expect(res.status).toBe(200);
    expect(text(res.bytes)).toBe("hello");
    expect(res.headers.get("content-type")).toBe("text/plain");
    expect(res.headers.get("content-disposition")).toBe("attachment; filename*=UTF-8''notes.txt");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("never serves uploaded HTML as a page", async () => {
    const file = await upload("evil.html", "<script>alert(1)</script>", "text/html");
    const res = await h.download(alice, url(A, file.path));
    expect(res.headers.get("content-disposition")).toMatch(/^attachment;/);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it.each([
    ["../../etc/passwd", "passwd"],
    ["a/b\\c.txt", "c.txt"],
    ['we"ird<name>.txt', "we_ird_name_.txt"],
    ["", "file"],
    ["..", "file"],
  ])("keeps only a safe base name of %j", async (name, expected) => {
    const file = await upload(name, "x");
    expect(file.title).toBe(expected);
    expect(file.path.split("/")).toHaveLength(2);
  });

  it("refuses an empty file, a file over 25 MB, and writes from a reader", async () => {
    expect((await h.upload(alice, `${A}/attachments?filename=a.txt`, "")).status).toBe(422);
    const big = new Uint8Array(25 * 1024 * 1024 + 1);
    const tooBig = await h.upload(alice, `${A}/attachments?filename=big.bin`, big);
    expect(tooBig.status).toBe(413);
    expect((await h.upload(viewer, `${A}/attachments?filename=a.txt`, "x")).status).toBe(403);
    expect((await h.upload(null, `${A}/attachments?filename=a.txt`, "x")).status).toBe(401);
  });

  it("answers 404 for a path that is unknown or malformed", async () => {
    expect((await h.download(alice, `${A}/attachments/11111111-1111-4111-8111-111111111111/none.txt`)).status).toBe(404);
    expect((await h.download(alice, `${A}/attachments/not-a-uuid/x.txt`)).status).toBe(404);
    expect((await h.download(alice, `${A}/attachments/only-one-part`)).status).toBe(404);
    expect((await h.download(alice, `${A}/attachments/a/b/c`)).status).toBe(404);
  });

  describe("another organization", () => {
    it("gets 404 on upload and download under org A", async () => {
      const file = await upload("secret.txt", "secret");
      expect((await h.upload(bob, `${A}/attachments?filename=x.txt`, "x")).status).toBe(404);
      expect((await h.download(bob, url(A, file.path))).status).toBe(404);
    });

    it("cannot read org A's file through its own organization, even with the exact path", async () => {
      const file = await upload("secret.txt", "secret");
      const res = await h.download(bob, url(B, file.path));
      expect(res.status).toBe(404);
      // nor by naming org A's prefix inside the path
      const smuggled = await h.download(bob, `${B}/attachments/${ORG_A}/${file.path}`);
      expect(smuggled.status).toBe(404);
    });

    it("can list org A's path on its own note, and still gets nothing of it", async () => {
      const file = await upload("secret.txt", "secret");
      const contact = await h.call(bob, "POST", `${B}/contacts`, { first_name: "Own" });
      const note = await h.call(bob, "POST", `${B}/contact_notes`, {
        contact_id: contact.body.data.id,
        text: "pointing at someone else's file",
        attachments: [{ path: file.path, title: "secret.txt" }],
      });
      // A path is relative to the note's own organization, so this names a
      // file of org B that does not exist…
      expect(note.status).toBe(201);
      expect((await h.download(bob, url(B, file.path))).status).toBe(404);
      // …and deleting the note removes nothing of org A.
      await h.call(bob, "DELETE", `${B}/contact_notes/${note.body.data.id}`);
      expect(text((await h.download(alice, url(A, file.path))).bytes)).toBe("secret");
    });
  });

  describe("on notes", () => {
    it("refuses attachments that are not uploads", async () => {
      for (const attachments of [
        [{ title: "x", path: "x/quote.pdf" }],
        [{ title: "x", src: "https://example.com/x.pdf" }],
        [{ title: "x", path: `${ORG_B}/11111111-1111-4111-8111-111111111111/x.txt` }],
        "nope",
        Array.from({ length: 51 }, () => ({ path: "11111111-1111-4111-8111-111111111111/x.txt" })),
      ]) {
        const res = await h.call(alice, "POST", `${A}/contact_notes`, { contact_id: contactId, text: "n", attachments });
        expect(res.status).toBe(422);
        expect(Object.keys(res.body.error.details.fields)).toEqual(["attachments"]);
      }
    });

    it("deletes a note's files with the note", async () => {
      const one = await upload("one.txt", "1");
      const two = await upload("two.txt", "2");
      const note = await h.call(alice, "POST", `${A}/contact_notes`, {
        contact_id: contactId,
        text: "two files",
        attachments: [one, two],
      });
      expect(stored()).toEqual(expect.arrayContaining([`${ORG_A}/${one.path}`, `${ORG_A}/${two.path}`]));

      expect((await h.call(alice, "DELETE", `${A}/contact_notes/${note.body.data.id}`)).status).toBe(200);
      expect(stored()).not.toContain(`${ORG_A}/${one.path}`);
      expect(stored()).not.toContain(`${ORG_A}/${two.path}`);
    });

    it("deletes the files an update drops, and keeps the others", async () => {
      const keep = await upload("keep.txt", "k");
      const drop = await upload("drop.txt", "d");
      const added = await upload("added.txt", "a");
      const note = await h.call(alice, "POST", `${A}/deal_notes`, {
        deal_id: (await h.call(alice, "POST", `${A}/deals`, { name: "D", stage: "lead" })).body.data.id,
        text: "n",
        attachments: [keep, drop],
      });

      const updated = await h.call(alice, "PATCH", `${A}/deal_notes/${note.body.data.id}`, { attachments: [keep, added] });
      expect(updated.status).toBe(200);
      expect(stored()).toContain(`${ORG_A}/${keep.path}`);
      expect(stored()).toContain(`${ORG_A}/${added.path}`);
      expect(stored()).not.toContain(`${ORG_A}/${drop.path}`);

      // an update that does not mention attachments touches no file
      await h.call(alice, "PATCH", `${A}/deal_notes/${note.body.data.id}`, { text: "edited" });
      expect(stored()).toContain(`${ORG_A}/${keep.path}`);
    });

    it("keeps the files when the request fails", async () => {
      const file = await upload("kept.txt", "k");
      const note = await h.call(alice, "POST", `${A}/contact_notes`, { contact_id: contactId, text: "n", attachments: [file] });
      const failed = await h.call(alice, "PATCH", `${A}/contact_notes/${note.body.data.id}`, {
        attachments: [],
        contact_id: 999999,
      });
      expect(failed.status).toBe(422);
      expect(stored()).toContain(`${ORG_A}/${file.path}`);
      expect((await h.call(viewer, "DELETE", `${A}/contact_notes/${note.body.data.id}`)).status).toBe(403);
      expect(stored()).toContain(`${ORG_A}/${file.path}`);
    });

    it("deletes the files of every note that goes with a contact, a deal or a company", async () => {
      const company = (await h.call(alice, "POST", `${A}/companies`, { name: "Gone Corp" })).body.data.id;
      const contact = (await h.call(alice, "POST", `${A}/contacts`, { first_name: "Gone", company_id: company })).body.data.id;
      const deal = (await h.call(alice, "POST", `${A}/deals`, { name: "Gone", stage: "lead", company_id: company })).body.data.id;
      const other = (await h.call(alice, "POST", `${A}/deals`, { name: "Solo", stage: "lead" })).body.data.id;

      const onContact = await upload("contact.txt", "c");
      const onDeal = await upload("deal.txt", "d");
      const onOther = await upload("other.txt", "o");
      const survivor = await upload("survivor.txt", "s");
      await h.call(alice, "POST", `${A}/contact_notes`, { contact_id: contact, text: "n", attachments: [onContact] });
      await h.call(alice, "POST", `${A}/deal_notes`, { deal_id: deal, text: "n", attachments: [onDeal] });
      await h.call(alice, "POST", `${A}/deal_notes`, { deal_id: other, text: "n", attachments: [onOther] });
      await h.call(alice, "POST", `${A}/contact_notes`, { contact_id: contactId, text: "n", attachments: [survivor] });

      expect((await h.call(alice, "DELETE", `${A}/deals/${other}`)).status).toBe(200);
      expect(stored()).not.toContain(`${ORG_A}/${onOther.path}`);

      expect((await h.call(alice, "DELETE", `${A}/companies/${company}`)).status).toBe(200);
      expect(stored()).not.toContain(`${ORG_A}/${onContact.path}`);
      expect(stored()).not.toContain(`${ORG_A}/${onDeal.path}`);
      expect(stored()).toContain(`${ORG_A}/${survivor.path}`);
    });
  });
});

describe("favicons", () => {
  let h: Harness;

  beforeAll(async () => {
    h = await createHarness([alice]);
    h.favicons.hosts.add("acme.test");
    h.favicons.hosts.add("gmail.com");
    h.favicons.hosts.add("blocked.test");
  }, 120_000);

  afterAll(async () => {
    await h.close();
  });

  beforeEach(() => {
    h.favicons.requests.length = 0;
  });

  it("gives a company without a logo its website's favicon", async () => {
    const res = await h.call(alice, "POST", `${A}/companies`, { name: "Acme", website: "https://www.Acme.test/about?x=1" });
    expect(res.body.data.logo).toEqual({ src: "https://acme.test/favicon.ico", title: "Company favicon" });
    expect(h.favicons.requests).toEqual(["https://acme.test/favicon.ico"]);
  });

  it("leaves the logo empty when the site has no favicon, and asks nobody else", async () => {
    const res = await h.call(alice, "POST", `${A}/companies`, { name: "Plain", website: "plain.test" });
    expect(res.status).toBe(201);
    expect(res.body.data.logo).toBeNull();
    expect(h.favicons.requests).toEqual(["https://plain.test/favicon.ico"]);
  });

  it("keeps a logo that was given, and makes no request", async () => {
    const res = await h.call(alice, "POST", `${A}/companies`, {
      name: "Own logo",
      website: "acme.test",
      logo: { src: "data:image/png;base64,AAAA", title: "mine" },
    });
    expect(res.body.data.logo.title).toBe("mine");
    expect(h.favicons.requests).toEqual([]);
  });

  it("makes no request without a website, or for one that is not a host name", async () => {
    await h.call(alice, "POST", `${A}/companies`, { name: "No site" });
    for (const website of ["localhost", "http://127.0.0.1/admin", "javascript:alert(1)", "not a url", "intranet"]) {
      const res = await h.call(alice, "POST", `${A}/companies`, { name: "Odd", website });
      expect(res.status).toBe(201);
    }
    expect(h.favicons.requests).toEqual([]);
  });

  it("fills the logo on an update that sets the website, only while there is none", async () => {
    const company = (await h.call(alice, "POST", `${A}/companies`, { name: "Later" })).body.data;
    const updated = await h.call(alice, "PATCH", `${A}/companies/${company.id}`, { website: "acme.test" });
    expect(updated.body.data.logo?.src).toBe("https://acme.test/favicon.ico");

    h.favicons.requests.length = 0;
    await h.call(alice, "PATCH", `${A}/companies/${company.id}`, { website: "acme.test" });
    expect(h.favicons.requests).toEqual([]);
  });

  it("gives a contact the favicon of their email's domain, skipping mail providers", async () => {
    const res = await h.call(alice, "POST", `${A}/contacts`, {
      first_name: "Wile",
      email_jsonb: [{ email: "wile@gmail.com" }, { email: "wile@acme.test" }],
    });
    expect(res.body.data.avatar).toEqual({ src: "https://acme.test/favicon.ico" });
    expect(h.favicons.requests).toEqual(["https://acme.test/favicon.ico"]);

    h.favicons.requests.length = 0;
    const webmail = await h.call(alice, "POST", `${A}/contacts`, { first_name: "G", email_jsonb: [{ email: "g@gmail.com" }] });
    expect(webmail.body.data.avatar).toBeNull();
    expect(h.favicons.requests).toEqual([]);
  });

  it("respects the organization's own excluded domains", async () => {
    await h.pg.query("INSERT INTO crm.favicons_excluded_domains (org_id, domain) VALUES ($1, 'Blocked.test')", [ORG_A]);
    const res = await h.call(alice, "POST", `${A}/contacts`, { first_name: "B", email_jsonb: [{ email: "b@blocked.test" }] });
    expect(res.body.data.avatar).toBeNull();
    expect(h.favicons.requests).toEqual([]);
  });
});
