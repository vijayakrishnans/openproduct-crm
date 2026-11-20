## crm-web v0.11.0 - 2026-11-20

Fixes from Atomic CRM upstream (up to `832b07a`, its v2.0.0):

- A company website with a long domain ending (`.photography`, `.consulting`)
  is accepted. Endings were capped at five letters.
- A deal's contacts show as plain names in the contacts field, not the tall
  list entry with avatar and title.
- Importing a CSV with a company name containing a quote, backslash or comma
  finds the existing company instead of creating a duplicate. BrokeCRM's own
  API adapter also split such names on every comma; it now reads them whole.

And one BrokeCRM fix in the same area:

- The demo's dashboard shows its Welcome card. It checked a build flag that
  BrokeCRM's build never set.

## crm-web v0.10.1 - 2026-11-20

- On phones, the demo's "Want it for real?" card sits above the bottom menu
  instead of covering it, and is shorter.

## crm-web v0.10.0 - 2026-11-20

- Try the demo as your own CRM: the landing page's "Make it yours" form takes
  a name, a colour and a logo, and the demo opens wearing them. Nothing is
  uploaded. A link like `/?demo&name=Acme%20CRM&color=%23ff6600` does the
  same, so it can be sent to someone.
- The demo has a card for anyone who wants it for their team, with the two
  addresses to write to. The landing page has a Contact section, and its top
  links are now "Make it yours" and "Contact".
- The landing page's in-page links (Make it yours, Contact) scroll to their
  section. Following one used to start the app and show the sign-in form.

## crm-web v0.9.0 - 2026-11-19

- The sign-in page's left side is no longer empty: it says what BrokeCRM is
  (free, open source, hosted) and shows the deal board.

## crm-web v0.8.3 - 2026-11-19

- A deal without an amount opens, and says "No amount". Deals created through
  the MCP server or the API without one used to show "Something went wrong",
  and broke the dashboard's deal pipeline.

## crm-web v0.8.2 - 2026-11-19

- Switching organizations now switches the branding too. An organization that
  never set its own title or logos shows BrokeCRM's, not the previous one's.

## crm-web v0.8.1 - 2026-11-19

- The page that approves an MCP connection (/oauth/authorize) loads. It used to
  spin forever: its scripts were requested from /oauth/assets/.

## crm-web v0.8.0 - 2026-11-19

- Connect Claude, or another assistant that signs in, to your CRM: add the MCP
  server address as a custom connector and approve it with your BrokeCRM
  account. No API key needed.
- The MCP server has a brokecrm.cloud address: `api.brokecrm.cloud`.

## crm-web v0.7.0 - 2026-11-19

- Switch organizations from the header, or create another where your plan
  allows it.
- Invited people see their invitation after signing in with the invited email,
  and join with one click.
- The Users page lists pending invitations, and an admin can revoke them.

## crm-web v0.6.0 - 2026-11-18

- Terms of use and a privacy policy, linked from the landing page and the
  sign-in form.
- The landing page says plainly that all of BrokeCRM is open source under the
  Apache 2.0 licence, with a link to the licence.

## crm-web v0.5.1 - 2026-11-18

- `brokecrm.cloud` without `www` now takes you to `www.brokecrm.cloud`; it
  used to lead nowhere.

## crm-web v0.5.0 - 2026-11-18

- Sign in with Google or GitHub, beside the email code. A provider's button
  appears once it is set up for the site.

## crm-web v0.4.0 - 2026-11-18

- The product is now called BrokeCRM, on every screen, in the browser tab and
  in the emails it sends.
- A landing page greets visitors who are not signed in: what BrokeCRM is, that
  it is free, open source and hosted, where it comes from (Atomic CRM), and
  how to start. Signed-in users still land in the app.
- Search engines and link previews get a proper title, description and
  preview image.

## crm-web v0.3.3 - 2026-11-17

- Moving a deal again before its previous move was saved now works. The
  second move used the deal's old stage and position, so it was saved in the
  wrong place and the card jumped back.
- A drag is no longer cancelled when the board reloads in the middle of it.

## crm-web v0.3.2 - 2026-11-17

- The deal board is harder to break while dragging: it no longer depends on
  the stages and the deals arriving in a particular order, and a drop it
  cannot place is ignored instead of leaving a hole in a column.
- A deal dropped next to one whose stage was removed takes the column's
  stage, not the removed one.
- A move that cannot be saved says so and puts the card back.
- Opening "New Deal" from a deal's edit form no longer shows an "Element does
  not exist" error.

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
