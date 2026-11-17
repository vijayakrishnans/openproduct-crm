## crm-web v0.3.1 - 2026-11-17

- Settings opens again. It showed "Not Found" on the real CRM (the demo was
  unaffected), so branding, deal stages, categories and task types could not
  be changed.
- Save on the settings page waits until the deals it checks stages against
  have loaded, instead of refusing with "The form is not valid".

## crm-web v0.3.0 - 2026-11-17

- Notes take file attachments again (up to 25 MB each). Files are stored by
  the API for your organization only, and are deleted with their note.
- A company without a logo gets its website's favicon, and a contact without
  an avatar the favicon of their email's domain.

## crm-web v0.2.0 - 2026-11-17

- The CRM now runs on the OpenProduct API: sign in with a code sent to your
  email, then pick or create an organization. Records belong to that
  organization and are visible to its members only.
- The in-browser demo is still there, with fake data and no account: open the
  app with `?demo`, or follow the link on the sign-in page.
- No Supabase in the browser any more: passwords, the password-reset pages
  and the OAuth consent page are gone with it.
- File attachments on notes are not available yet. Avatars and logos are
  stored inline for now.

## crm-web v0.1.0 - 2026-11-16

- First release of OpenProduct CRM's web app: the in-browser demo, ported from
  Atomic CRM (MIT) at commit `aeccb98`, running on generated, fake data.
- Renamed to OpenProduct CRM, with a new logo and icons. Telemetry is off.
