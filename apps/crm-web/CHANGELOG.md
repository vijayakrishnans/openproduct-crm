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
