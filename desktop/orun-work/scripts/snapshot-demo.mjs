// Builds src/lib/demo-repo.json, the browser demo's stand-in for a repository
// on disk: intent.yaml and every component.yaml of a real orun repo, reduced
// to the fields the editor reads. Usage: node scripts/snapshot-demo.mjs <repo>
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { parse, stringify } from "yaml";

const root = process.argv[2] ?? "../..";
const skip = new Set(["node_modules", ".git", "dist", ".turbo", ".orun"]);
const files = {};

function walk(dir, depth) {
  if (depth < 0) return;
  for (const name of readdirSync(dir)) {
    if (skip.has(name) || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, depth - 1);
    else if (name === "component.yaml") {
      const doc = parse(readFileSync(p, "utf8"));
      const spec = doc.spec ?? {};
      const keep = {
        apiVersion: doc.apiVersion,
        kind: doc.kind,
        metadata: { name: doc.metadata?.name, description: doc.metadata?.description },
        spec: {
          type: spec.type, lifecycle: spec.lifecycle, owner: spec.owner, domain: spec.domain, path: spec.path,
          dependsOn: (spec.dependsOn ?? []).map((d) => ({ component: d.component, ...(d.input ? { input: true } : {}), ...(d.mode ? { mode: d.mode } : {}) })),
          subscribe: { environments: (spec.subscribe?.environments ?? []).map((e) => ({ name: e.name, profile: e.profile })) },
        },
      };
      files[relative(root, p).replaceAll("\\", "/")] = stringify(keep);
    }
  }
}

const intent = parse(readFileSync(join(root, "intent.yaml"), "utf8"));
const roots = intent.discovery?.roots ?? ["apps/", "infra/", "packages/", "tests/"];
for (const r of roots) walk(join(root, r), 4);
files["intent.yaml"] = stringify({
  apiVersion: intent.apiVersion, kind: intent.kind, metadata: intent.metadata,
  execution: { state: { workspace: intent.execution?.state?.workspace } },
  discovery: intent.discovery,
  environments: Object.fromEntries(Object.entries(intent.environments ?? {}).map(([k, v]) => [k, { description: v.description, url: v.url, links: v.links }])),
});
writeFileSync("src/lib/demo-repo.json", JSON.stringify(files, null, 0) + "\n");
console.log(`${Object.keys(files).length} files`);
