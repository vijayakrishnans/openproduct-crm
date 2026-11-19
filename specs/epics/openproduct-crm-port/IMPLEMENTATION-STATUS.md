# Implementation status

As-built ≠ intent. This file records what actually shipped and where it
departs from [design.md](design.md).

| Milestone | State | PR |
|---|---|---|
| CRM0 the spec | done | #10 |
| CRM-A public listing | done | #13 |
| M0 import and attribution | done | #12, #14 (and #11, the multi-tenant profile) |
| M1 schema | done | #15 |
| M2 crm-worker and crm-facade | done | #16, #18 |
| M3 frontend swap | done | #19, #20 |
| M4 files and email | attachments and favicons done; inbound email not live (needs a domain) | #21, #23 |
| M5 MCP server | done | #24 |
| M6 product glue | done | #25 |
| M7 prod and docs | docs and smoke done; the prod smoke waits on a prod credential | #26 |
| After M7: settings page fix | done | #27 |
| After M7: deal board fixes and drag test | done; the crash the owner saw was not reproduced | #28, #29 |
| After M7: licence | Apache-2.0 with a `NOTICE` | #30, #31 |
| After M7: openproduct.live listing | published as `atomic-crm`; not indexed, repo facts not read yet | |
| After M7: custom domain `brokecrm.cloud` | done | #33 |
| After M7: prod sign-in by email | done; the owner signed in on prod, 2026-11-18 | #34 |
| After M7: BrokeCRM name, landing page, SEO | done | #35 |
| After M7: sign-in with Google and GitHub | done; the owner signed in on prod with both, 2026-11-19 | #36, #44, #45, #50 |
| After M7: invitation emails link to sign-in | done; not confirmed with a real email | #49 |
| After M7: bare domain redirects to `www` | done | #39 |
| After M7: deploy smokes fixed after the rename (prod was blocked from #36 to #40) | done | #40 |
| After M7: terms, privacy policy, licence statement | done as drafts; not reviewed by a lawyer | |

## Departures from design.md

- `pnpm-workspace.yaml` carries `packageExtensions` so the console and
  crm-web resolve their own React types and zod (M0).
- Contact emails are not unique per org (M1). Upstream keeps them in a JSON
  array and relies on merge to deduplicate; a uniqueness rule would break
  import. The per-org unique keys are the sales profile's subject and email
  and an excluded favicon domain.
- No import bookkeeping table yet (M1). Upstream's CSV import is a client
  flow with no table; bookkeeping lands with the bulk-insert route.
- `favicons_excluded_domains` is per org, not global (M1), like every other
  `crm` table. crm-worker seeds an org's defaults.
- Two triggers upstream does not have (M1): `contacts.tags` and
  `deals.contact_ids` may only hold ids of the row's own org, and deleting a
  contact removes it from its deals.
- `crm.sales.email` is `text`, not `citext` (M1).
- One generic route set serves every resource (M2): `/crm/:resource` and
  `/crm/:resource/:id`, driven by the table in
  `apps/crm-worker/src/resources.ts`, instead of a handler per resource.
- The dashboard route returns counts and deal totals per stage (M2); the
  charts upstream draws from full lists stay client-side until M3 decides
  what they need.
- No route yet for `favicons_excluded_domains` (M2); it lands with favicon
  fetch in M4.
- The browser calls api-edge directly rather than through routes on the
  crm-web Worker (M3); `crm-web` stays a static-assets Worker.
- The `ra-supabase-language-*` message packages remain as dependencies (M3):
  the shared UI kit reads a few of their translation keys. No Supabase client,
  key or URL is left.
- The e2e specs run desktop only, and against a stage API from a locally
  served app or a deployed one (M3). Upstream's `signup.spec` is replaced by
  `signIn.spec`: an instance is no longer a single team.
- Inviting a user from the CRM returns a placeholder row until they sign in
  (M3); upstream created the account at once.
- The attachment buckets are created by hand, not by Terraform or a deploy
  step (M4): the deploy token has no R2 permission.
- No signed upload or download URLs (M4): files go through crm-worker with
  the session. No public, unauthenticated file route exists.
- No Gravatar and no favicon.show (M4): only the domain's own favicon.
- Inbound email requires a DMARC pass (M4); upstream trusted its mail
  provider's webhook secret instead.
- No notification emails yet (M4): upstream sends none besides auth mail,
  which identity-worker already owns.
- MCP is served by crm-worker at `/crm/mcp`, not by a separate Worker (M5),
  and has thirteen task-shaped tools rather than one per table operation.
- Event names are `crm.`-prefixed (M6): `crm.contact.created`,
  `crm.deal.stage_changed`, `crm.deal.won`, `crm.note.created`.
- Plan gating is one limit, the number of contacts (M6), not a per-feature
  gate. Seats are metered, not limited: `limit.members` already limits them.
- Contacts created by inbound email are not counted against the limit and
  emit no event (M6).
- The prod smoke has not run (M7). Prod sign-in works since 2026-11-18; the
  smoke needs a prod credential the agent does not have. The same script
  passes on stage.
- The settings page never worked on the real CRM until #27: the upstream form
  edits a `configuration` record that only the demo's provider had.
- The deal board saves a move from the server's state, not the screen's
  (#29). Upstream reads the dragged card's own stage and index, which is
  wrong whenever a second move starts before the first is saved.
- The licence is Apache-2.0, not MIT as the brief said (#31, the owner's
  decision). Atomic CRM's code keeps its MIT notice.
- The product's name for people is BrokeCRM (#35); the design called it
  OpenProduct CRM. Only what people see changed.
- The site's root is a landing page for visitors with no session (#35); the
  design had the sign-in form there. It is static HTML in `index.html`, and
  the app does not start until the visitor follows a link into it.
- Sign-in offers Google and GitHub beside the email code (#36); the design
  had the email code only. OAuth client ids are read from Orunbase secrets,
  not committed as config.
