# Contributing

Thanks for helping. Issues and pull requests are welcome.

## Before you start

- Read [AGENTS.md](AGENTS.md): what to read first, how a change lands and
  what not to touch. It is written for coding agents and works for people too.
- For anything larger than a small fix, open an issue first so we can agree
  on the approach.

## Making a change

1. Fork the repository and branch from `main`.
2. Install and check everything: `pnpm install && pnpm typecheck && pnpm lint && pnpm test && pnpm build` (Node.js 20+, pnpm 10).
3. Add tests beside the code you change. Any route or query that touches CRM
   data must be scoped by the caller's organization, and needs a test that
   another organization gets `404`.
4. Open a pull request saying what changed, why, and how you tested it. CI
   must be green before it merges.

## Ground rules

- Never commit secrets, `.env` files or real customer data. Seed data is fake.
- Keep pull requests small and about one thing.
- By contributing you agree that your contribution is licensed under the
  [MIT License](LICENSE).
