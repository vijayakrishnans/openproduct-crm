import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { btree_gin } from "@electric-sql/pglite/contrib/btree_gin";
import { unaccent } from "@electric-sql/pglite/contrib/unaccent";
import { manifest, BOUNDED_CONTEXTS } from "@saas/db";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATION_PATH = resolve(
  __dirname,
  "../../..",
  "packages/db/src/migrations/200_crm_core/up.sql",
);
const sql = readFileSync(MIGRATION_PATH, "utf-8");

const ORG_A = "11111111-1111-4111-8111-111111111111";
const ORG_B = "22222222-2222-4222-8222-222222222222";

const TABLES = [
  "sales",
  "tags",
  "companies",
  "contacts",
  "contact_notes",
  "deals",
  "deal_notes",
  "tasks",
  "favicons_excluded_domains",
] as const;

const VIEWS = ["activity_log", "companies_summary", "contacts_summary"] as const;

describe("CRM migration (200_crm_core)", () => {
  describe("manifest", () => {
    it("registers 'crm' as a bounded context", () => {
      expect(BOUNDED_CONTEXTS).toContain("crm");
    });

    it("is the only crm migration and the manifest tail", () => {
      const ids = manifest.migrations.map((m) => m.id);
      expect(ids[ids.length - 1]).toBe("200_crm_core");
      expect(
        manifest.migrations.filter((m) => m.context === "crm").map((m) => m.id),
      ).toEqual(["200_crm_core"]);
    });
  });

  describe("static contract", () => {
    it("references no other bounded context's schema and nothing of Supabase's", () => {
      const code = sql.replace(/--.*$/gm, "");
      for (const ref of [
        "identity.",
        "membership.",
        "billing.",
        "events.",
        "config.",
        "auth.",
        "public.",
        "storage.",
        "net.",
        "http_get",
      ]) {
        expect(code).not.toContain(ref);
      }
    });

    it("defines no SECURITY DEFINER function", () => {
      expect(sql.replace(/--.*$/gm, "")).not.toMatch(/SECURITY\s+DEFINER/i);
    });

    it("grants nothing to Supabase's anon or authenticated roles", () => {
      expect(sql.replace(/--.*$/gm, "")).not.toMatch(
        /\bTO\s+(anon|authenticated|service_role|PUBLIC)\b/i,
      );
    });
  });

  // The SQL-level proof M1 is gated on: the migration runs on a real Postgres
  // (PGlite — Postgres compiled to WebAssembly) and org B cannot see, change
  // or reference org A's rows.
  describe("on Postgres", () => {
    let db: PGlite;

    /** Runs statements the way crm-worker does: as crm_app, inside one
     *  transaction, with the request's org and actor set locally. */
    async function asOrg<T>(
      orgId: string | null,
      fn: (q: <R>(text: string, params?: unknown[]) => Promise<R[]>) => Promise<T>,
      subjectId = "usr_test",
    ): Promise<T> {
      await db.exec("BEGIN; SET LOCAL ROLE crm_app;");
      try {
        if (orgId !== null) {
          await db.query(
            "SELECT set_config('app.org_id', $1, true), set_config('app.subject_id', $2, true)",
            [orgId, subjectId],
          );
        }
        const result = await fn(async (text, params) => {
          const res = await db.query(text, params);
          return res.rows as never[];
        });
        await db.exec("COMMIT");
        return result;
      } catch (err) {
        await db.exec("ROLLBACK");
        throw err;
      }
    }

    beforeAll(async () => {
      db = new PGlite({ extensions: { unaccent, btree_gin } });
      await db.exec(sql);

      await asOrg(
        ORG_A,
        async (q) => {
          await q("INSERT INTO crm.sales (subject_id, email) VALUES ('usr_a', 'Ada@a.test')");
          await q("INSERT INTO crm.tags (name, color) VALUES ('vip', '#f00')");
          await q("INSERT INTO crm.companies (name, website) VALUES ('Acme Hélène', 'acme.test')");
          await q(
            `INSERT INTO crm.contacts (first_name, last_name, company_id, tags, email_jsonb, last_seen)
             SELECT 'Thomas', 'Dupont', c.id, ARRAY[t.id],
                    '[{"email":"TD@Acme.test","type":"Work"}]'::jsonb, now() - interval '1 day'
             FROM crm.companies c, crm.tags t`,
          );
          await q(
            `INSERT INTO crm.contacts (first_name, last_name, email_jsonb, phone_jsonb)
             VALUES ('Tom', 'Dupond', '[{"email":"tom@a.test"}]', '[{"number":"555-0100"}]')`,
          );
          await q(
            `INSERT INTO crm.deals (name, stage, company_id, contact_ids)
             SELECT 'Big deal', 'opportunity', c.id, ARRAY(SELECT id FROM crm.contacts ORDER BY id)
             FROM crm.companies c`,
          );
          await q(
            `INSERT INTO crm.contact_notes (contact_id, text)
             SELECT min(id), 'called about helene' FROM crm.contacts`,
          );
          await q(
            `INSERT INTO crm.deal_notes (deal_id, text) SELECT id, 'sent the quote' FROM crm.deals`,
          );
          await q(
            `INSERT INTO crm.tasks (contact_id, text, type)
             SELECT id, 'follow up', 'call' FROM crm.contacts`,
          );
          await q("INSERT INTO crm.favicons_excluded_domains (domain) VALUES ('gmail.com')");
        },
        "usr_a",
      );
    }, 120_000);

    afterAll(async () => {
      await db.close();
    });

    it("applies a second time without error (the runner needs idempotent SQL)", async () => {
      await expect(db.exec(sql)).resolves.toBeDefined();
    });

    it("puts org_id UUID NOT NULL on every table", async () => {
      const res = await db.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.columns
         WHERE table_schema = 'crm' AND column_name = 'org_id'
           AND data_type = 'uuid' AND is_nullable = 'NO'
           AND table_name = ANY($1)`,
        [[...TABLES]],
      );
      expect(res.rows.map((r) => r.table_name).sort()).toEqual([...TABLES].sort());
    });

    it("enables and forces row-level security on every table", async () => {
      const res = await db.query<{ relname: string }>(
        `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'crm' AND c.relkind = 'r'
           AND NOT (c.relrowsecurity AND c.relforcerowsecurity)`,
      );
      expect(res.rows).toEqual([]);
    });

    it("leads every index with org_id, except the primary keys", async () => {
      const res = await db.query<{ indexname: string }>(
        `SELECT i.relname AS indexname
         FROM pg_index x
           JOIN pg_class i ON i.oid = x.indexrelid
           JOIN pg_class t ON t.oid = x.indrelid
           JOIN pg_namespace n ON n.oid = t.relnamespace
           LEFT JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = x.indkey[0]
         WHERE n.nspname = 'crm' AND NOT x.indisprimary
           AND a.attname IS DISTINCT FROM 'org_id'`,
      );
      expect(res.rows).toEqual([]);
    });

    it("makes every foreign key composite on org_id", async () => {
      const res = await db.query<{ conname: string }>(
        `SELECT con.conname
         FROM pg_constraint con
           JOIN pg_namespace n ON n.oid = con.connamespace
           JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = con.conkey[1]
         WHERE n.nspname = 'crm' AND con.contype = 'f' AND a.attname <> 'org_id'`,
      );
      expect(res.rows).toEqual([]);
    });

    it("runs every view with the caller's rights", async () => {
      const res = await db.query<{ relname: string }>(
        `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'crm' AND c.relkind = 'v'
           AND NOT coalesce(c.reloptions @> ARRAY['security_invoker=on'], false)`,
      );
      expect(res.rows).toEqual([]);
    });

    it("gives crm_app no way around the policies", async () => {
      const res = await db.query<{ rolbypassrls: boolean; rolsuper: boolean; rolcanlogin: boolean }>(
        "SELECT rolbypassrls, rolsuper, rolcanlogin FROM pg_roles WHERE rolname = 'crm_app'",
      );
      expect(res.rows).toEqual([{ rolbypassrls: false, rolsuper: false, rolcanlogin: false }]);
    });

    it("lets org A read what it wrote, with the ported defaults applied", async () => {
      await asOrg(ORG_A, async (q) => {
        const [counts] = await q<Record<string, number>>(
          `SELECT (SELECT count(*)::int FROM crm.contacts) AS contacts,
                  (SELECT count(*)::int FROM crm.activity_log) AS activity,
                  (SELECT count(*)::int FROM crm.companies_summary) AS companies,
                  (SELECT count(*)::int FROM crm.contacts_summary) AS summaries`,
        );
        expect(counts).toEqual({ contacts: 2, activity: 6, companies: 1, summaries: 2 });

        const [company] = await q<{ org_id: string; has_sales: boolean; nb_deals: number; nb_contacts: number }>(
          "SELECT org_id, sales_id IS NOT NULL AS has_sales, nb_deals, nb_contacts FROM crm.companies_summary",
        );
        expect(company).toEqual({ org_id: ORG_A, has_sales: true, nb_deals: 1, nb_contacts: 1 });

        const [contact] = await q<{ email: string }>(
          "SELECT email_jsonb -> 0 ->> 'email' AS email FROM crm.contacts ORDER BY id LIMIT 1",
        );
        expect(contact?.email).toBe("td@acme.test");
      });
    });

    it("searches org A's records by unaccented prefix", async () => {
      await asOrg(ORG_A, async (q) => {
        const rows = await q<{ resource: string; title: string }>(
          "SELECT resource, title FROM crm.global_search($1, 'hel')",
          [ORG_A],
        );
        expect(rows).toEqual([
          { resource: "companies", title: "Acme Hélène" },
          { resource: "contact_notes", title: "called about helene" },
        ]);
        const blank = await q("SELECT * FROM crm.global_search($1, '  ')", [ORG_A]);
        expect(blank).toEqual([]);
      });
    });

    describe("org B", () => {
      it.each([...TABLES, ...VIEWS])("sees no row of org A in crm.%s", async (relation) => {
        await asOrg(ORG_B, async (q) => {
          const [row] = await q<{ n: number }>(`SELECT count(*)::int AS n FROM crm.${relation}`);
          expect(row?.n).toBe(0);
        });
      });

      it("sees none even when a query names org A", async () => {
        await asOrg(ORG_B, async (q) => {
          const rows = await q("SELECT id FROM crm.contacts WHERE org_id = $1", [ORG_A]);
          expect(rows).toEqual([]);
        });
      });

      it("finds nothing through search, even when it passes org A's id", async () => {
        await asOrg(ORG_B, async (q) => {
          expect(await q("SELECT * FROM crm.global_search($1, 'hel')", [ORG_B])).toEqual([]);
          expect(await q("SELECT * FROM crm.global_search($1, 'hel')", [ORG_A])).toEqual([]);
        });
      });

      it("cannot update or delete org A's rows", async () => {
        await asOrg(ORG_B, async (q) => {
          for (const table of TABLES) {
            const deleted = await q(`DELETE FROM crm.${table} RETURNING id`);
            expect(deleted).toEqual([]);
          }
          const updated = await q("UPDATE crm.contacts SET first_name = 'x' RETURNING id");
          expect(updated).toEqual([]);
        });
        await asOrg(ORG_A, async (q) => {
          const [row] = await q<{ n: number }>(
            "SELECT count(*)::int AS n FROM crm.contacts WHERE first_name IN ('Thomas', 'Tom')",
          );
          expect(row?.n).toBe(2);
        });
      });

      it("cannot write a row into org A", async () => {
        await expect(
          asOrg(ORG_B, (q) =>
            q("INSERT INTO crm.tags (org_id, name, color) VALUES ($1, 'x', 'y')", [ORG_A]),
          ),
        ).rejects.toThrow(/row-level security/);
      });

      it("cannot move its own row into org A", async () => {
        await expect(
          asOrg(ORG_B, async (q) => {
            await q("INSERT INTO crm.tags (name, color) VALUES ('mine', '#000')");
            await q("UPDATE crm.tags SET org_id = $1", [ORG_A]);
          }),
        ).rejects.toThrow(/row-level security/);
      });

      it("cannot reference org A's company, contact, tag or sales profile", async () => {
        const ids = await asOrg(ORG_A, async (q) => {
          const [row] = await q<{ company: string; contact: string; tag: string; sales: string }>(
            `SELECT (SELECT min(id) FROM crm.companies) AS company,
                    (SELECT min(id) FROM crm.contacts) AS contact,
                    (SELECT min(id) FROM crm.tags) AS tag,
                    (SELECT min(id) FROM crm.sales) AS sales`,
          );
          return row!;
        });

        const attempts: [string, unknown[]][] = [
          ["INSERT INTO crm.contacts (first_name, company_id) VALUES ('b', $1)", [ids.company]],
          ["INSERT INTO crm.contacts (first_name, sales_id) VALUES ('b', $1)", [ids.sales]],
          ["INSERT INTO crm.contacts (first_name, tags) VALUES ('b', ARRAY[$1::bigint])", [ids.tag]],
          ["INSERT INTO crm.tasks (contact_id, text) VALUES ($1, 'b')", [ids.contact]],
          ["INSERT INTO crm.contact_notes (contact_id, text) VALUES ($1, 'b')", [ids.contact]],
          ["INSERT INTO crm.deals (name, stage, company_id) VALUES ('b', 'lead', $1)", [ids.company]],
          ["INSERT INTO crm.deals (name, stage, contact_ids) VALUES ('b', 'lead', ARRAY[$1::bigint])", [ids.contact]],
        ];
        for (const [text, params] of attempts) {
          await expect(asOrg(ORG_B, (q) => q(text, params))).rejects.toThrow(
            /foreign key|does not exist in this organization/,
          );
        }
      });

      it("cannot merge org A's contacts", async () => {
        const [loser, winner] = await asOrg(ORG_A, async (q) => {
          const rows = await q<{ id: string }>("SELECT id FROM crm.contacts ORDER BY id DESC");
          return rows.map((r) => r.id);
        });
        for (const org of [ORG_A, ORG_B]) {
          await expect(
            asOrg(ORG_B, (q) => q("SELECT crm.merge_contacts($1, $2, $3)", [org, loser, winner])),
          ).rejects.toThrow(/Contact not found/);
        }
      });
    });

    it("shows nothing and accepts nothing when no org is set", async () => {
      await asOrg(null, async (q) => {
        const [row] = await q<{ n: number }>("SELECT count(*)::int AS n FROM crm.contacts");
        expect(row?.n).toBe(0);
      });
      await expect(
        asOrg(null, (q) => q("INSERT INTO crm.tags (name, color) VALUES ('x', 'y')")),
      ).rejects.toThrow(/row-level security|null value/);
    });

    it("gives the same contact email to two orgs, each seeing only its own", async () => {
      await asOrg(ORG_B, async (q) => {
        await q(
          `INSERT INTO crm.contacts (first_name, email_jsonb)
           VALUES ('Bea', '[{"email":"td@acme.test"}]')`,
        );
        const rows = await q<{ first_name: string }>("SELECT first_name FROM crm.contacts");
        expect(rows).toEqual([{ first_name: "Bea" }]);
      });
    });

    it("merges two contacts of one org and cleans up after a deleted tag", async () => {
      await asOrg(ORG_A, async (q) => {
        const rows = await q<{ id: string }>("SELECT id FROM crm.contacts ORDER BY id");
        const [winner, loser] = rows.map((r) => r.id);
        await q("SELECT crm.merge_contacts($1, $2, $3)", [ORG_A, loser, winner]);

        const [merged] = await q<{ n: number; emails: number; tasks: number; contact_ids: string[] }>(
          `SELECT (SELECT count(*)::int FROM crm.contacts) AS n,
                  (SELECT jsonb_array_length(email_jsonb) FROM crm.contacts) AS emails,
                  (SELECT count(*)::int FROM crm.tasks WHERE contact_id = $1) AS tasks,
                  (SELECT contact_ids FROM crm.deals) AS contact_ids`,
          [winner],
        );
        expect(merged).toEqual({ n: 1, emails: 2, tasks: 2, contact_ids: [winner] });

        await q("DELETE FROM crm.tags");
        const [contact] = await q<{ tags: string[] }>("SELECT tags FROM crm.contacts");
        expect(contact?.tags).toEqual([]);
      });
    });
  });
});
