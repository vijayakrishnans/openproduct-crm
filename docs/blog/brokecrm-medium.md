# BrokeCRM: a free, open-source CRM your AI assistant can use

*Contacts, companies and a deals board, hosted for free, with an MCP server built in.*

Most CRMs cost money per seat before you have a single customer. The open-source ones are free, but they come with a server to run, patch and back up, and they usually assume one company per install.

BrokeCRM is a CRM for people who want neither bill nor server. It is free, it is open source under Apache 2.0, and it is already hosted at [brokecrm.cloud](https://www.brokecrm.cloud). You sign in with a code sent to your email and start adding contacts.

If you would rather look before you sign up, [the demo](https://www.brokecrm.cloud/?demo) runs entirely in your browser on fake data. Nothing you type there leaves the page.

*[Image: the deals board — upload `docs/screenshots/deals.png` here]*

## What you get

BrokeCRM covers what a small team does in a CRM every day:

- **Contacts and companies**, with tags, and avatars and logos filled in from each domain's own favicon.
- **Deals on a kanban board.** Drag a deal from one stage to the next.
- **Notes with file attachments** on contacts and deals, up to 25 MB a file.
- **Tasks**, so a follow-up does not depend on your memory.
- **Search** across everything.
- **CSV import and export.** Your data comes in from a spreadsheet and leaves the same way.
- **Merging** two records for the same person into one.

The free plan holds 500 contacts for each organization.

## Built for teams from the start

BrokeCRM is multi-tenant: one deployment serves many organizations. Each organization has its own members, roles and invitations, its own API keys and webhooks, and its own audit log.

Roles decide what a person or a key can do. A viewer reads, a builder also writes, and owners and admins manage.

## Your AI assistant gets a seat at the table

This is the part I am most pleased with. BrokeCRM has a [Model Context Protocol](https://modelcontextprotocol.io) server at one address:

```
https://mcp.brokecrm.cloud/mcp
```

Connect an MCP client such as Claude to it, sign in with OAuth or an organization API key, and the assistant can work in your CRM. You can ask it to "add the three people from this email thread as contacts at Acme, open a deal for the pilot, and remind me to follow up on Friday", and it does that.

The server has thirteen tools:

- **Four read:** `search`, `list`, `get` and `dashboard`.
- **Nine write:** create and update for contacts, companies and deals, plus `add_note`, `create_task` and `complete_task`.

Three decisions keep this safe:

1. **There is no free-form SQL.** Every tool has a closed schema that is checked before anything runs, and each one calls the same code as the matching REST route.
2. **No tool deletes or merges.** An assistant can add and change records. Removing them stays with a person.
3. **The key's role applies.** Give the assistant a viewer key and it can only read.

## How your data is kept apart

In a multi-tenant CRM, the question that matters is whether another organization can see your contacts. BrokeCRM checks every request four times:

1. **Membership.** You must hold a role in the organization you are asking about. If you do not, every address under it answers `404`.
2. **Policy.** Your role must allow the action: read, write or manage.
3. **An explicit filter.** Every database statement names the organization it is for.
4. **Row-level security.** Each request runs in its own Postgres transaction, as a database role that can see only that organization's rows. A query that forgot its filter would still return nothing from anyone else.

Another organization's record looks exactly like one that does not exist. A test suite runs this isolation matrix against a real Postgres on every change.

The same care applies to what leaves the CRM. Webhook events such as `crm.contact.created` and `crm.deal.won` carry ids, never names, emails or note text.

## What it runs on

There is no server behind BrokeCRM. It runs on Cloudflare Workers, with Postgres on Supabase reached through Hyperdrive, and files in R2.

One public Worker is the only entry point. Behind it, thirteen private Workers each own one job: identity, membership, policy, billing, webhooks, and so on. One of them is the CRM, and it is the only code that reads or writes CRM data.

The web app is based on [Atomic CRM](https://github.com/marmelab/atomic-crm) by Marmelab, which is MIT licensed. BrokeCRM is a separate product, and it owes that project a good deal.

## Host it yourself if you prefer

The hosted version and the source are the same code. To run your own, you need a Cloudflare account, a Supabase organization and an [Orun](https://github.com/sourceplane/orun) workspace. Fork the repository, point its configuration at your accounts, and merge to `main`. CI provisions the databases and deploys a staging environment, then production.

## What is not there yet

Two features are built but not switched on:

- **Sign-in with Google and GitHub.** For now, sign-in is by a code sent to your email.
- **Email to notes.** Forwarding an email to your organization's address will turn it into a note on the right contact. The code is deployed, but mail is not routed to it yet.

## Try it

- **Demo, no sign-up:** [brokecrm.cloud/?demo](https://www.brokecrm.cloud/?demo)
- **The real thing:** [brokecrm.cloud](https://www.brokecrm.cloud)
- **Source:** [github.com/vijayakrishnans/openproduct-crm](https://github.com/vijayakrishnans/openproduct-crm)

If something is broken or missing, open an issue. If BrokeCRM is useful to you, a star on GitHub helps other people find it.
