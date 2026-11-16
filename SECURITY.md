# Security policy

## Reporting a vulnerability

Please report security issues privately, not in a public issue or pull
request. Use GitHub's private vulnerability reporting:
**Security → Report a vulnerability** on this repository.

Include what you found, how to reproduce it, and what an attacker could do
with it. We aim to acknowledge a report within three working days and to
agree a disclosure date with you once a fix is ready.

## What counts

Anything that lets one organization read, change or delete another
organization's data is in scope and is treated as critical. So are
authentication bypasses, leaked credentials and injection in any API route,
the MCP server or inbound email handling.

Please do not test against other people's data, run denial-of-service tests,
or use social engineering. The public demo runs on fake data in your browser;
it has no server-side data to attack.

## Supported versions

Only the latest `main` is supported. Fixes land there and deploy to stage,
then prod.
