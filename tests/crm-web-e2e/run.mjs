// Runs the browser suite. In CI the runner has no Chromium yet, so fetch the
// one this Playwright version expects first; locally it is already there.
import { spawnSync } from "node:child_process";

const run = (args) => spawnSync("pnpm", ["exec", "playwright", ...args], { stdio: "inherit" }).status ?? 1;

if (process.env.CI) {
  const installed = run(["install", "--with-deps", "chromium"]);
  if (installed !== 0) process.exit(installed);
}
process.exit(run(["test", ...process.argv.slice(2)]));
