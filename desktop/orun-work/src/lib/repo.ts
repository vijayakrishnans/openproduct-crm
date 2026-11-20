// Reads an orun repository from disk: intent.yaml and every component.yaml
// under the intent's discovery roots.
import { parse } from "yaml";
import { exists, joinPath, readDir, readTextFile } from "./platform";

export interface Dependency {
  component: string;
  input?: boolean;
  mode?: string;
}

export interface Subscription {
  name: string;
  profile?: string;
}

export interface Component {
  name: string;
  description: string;
  type: string;
  lifecycle?: string;
  owner?: string;
  domain?: string;
  path: string;
  root: string;
  file: string;
  dependsOn: Dependency[];
  environments: Subscription[];
  parameters: Record<string, unknown>;
  text: string;
}

export interface Environment {
  name: string;
  description?: string;
  url?: string;
  links: { title: string; url: string }[];
}

export interface Repo {
  root: string;
  name: string;
  workspace?: string;
  intentText: string;
  environments: Environment[];
  components: Component[];
  errors: string[];
}

const SKIP = new Set(["node_modules", ".git", "dist", ".turbo", ".orun", ".wrangler", "target"]);

async function findComponentFiles(dir: string, depth: number, out: string[]) {
  if (depth < 0) return;
  let entries;
  try {
    entries = await readDir(dir);
  } catch {
    return;
  }
  if (entries.some((e) => !e.isDirectory && e.name === "component.yaml")) {
    out.push(joinPath(dir, "component.yaml"));
  }
  await Promise.all(
    entries
      .filter((e) => e.isDirectory && !SKIP.has(e.name) && !e.name.startsWith("."))
      .map((e) => findComponentFiles(joinPath(dir, e.name), depth - 1, out)),
  );
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

export function parseComponent(text: string, file: string, rel: string): Component {
  const doc = obj(parse(text));
  const meta = obj(doc.metadata);
  const spec = obj(doc.spec);
  const name = str(meta.name) ?? rel.split("/").slice(-2, -1)[0] ?? rel;
  return {
    name,
    description: str(meta.description) ?? "",
    type: str(spec.type) ?? "unknown",
    lifecycle: str(spec.lifecycle),
    owner: str(spec.owner),
    domain: str(spec.domain),
    path: str(spec.path) ?? rel.replace(/\/component\.yaml$/, ""),
    root: rel.split("/")[0] ?? "",
    file,
    dependsOn: arr(spec.dependsOn).map((d) => {
      const o = obj(d);
      return { component: str(o.component) ?? "?", input: o.input === true, mode: str(o.mode) };
    }),
    environments: arr(obj(spec.subscribe).environments).map((e) => {
      const o = obj(e);
      return { name: str(o.name) ?? "?", profile: str(o.profile) };
    }),
    parameters: obj(spec.parameters),
    text,
  };
}

export function parseIntent(text: string) {
  const doc = obj(parse(text));
  const state = obj(obj(doc.execution).state);
  const envs = obj(doc.environments);
  const roots = arr(obj(doc.discovery).roots).map(String);
  return {
    name: str(obj(doc.metadata).name) ?? "",
    workspace: str(state.workspace) ?? str(state.org),
    roots: roots.length ? roots : ["apps/", "infra/", "packages/", "tests/"],
    environments: Object.entries(envs).map(([name, v]) => {
      const o = obj(v);
      return {
        name,
        description: str(o.description),
        url: str(o.url),
        links: arr(o.links).map((l) => ({ title: str(obj(l).title) ?? "", url: str(obj(l).url) ?? "" })),
      };
    }),
  };
}

export async function loadRepo(root: string): Promise<Repo> {
  const errors: string[] = [];
  const intentPath = joinPath(root, "intent.yaml");
  if (!(await exists(intentPath))) {
    throw new Error(`No intent.yaml in ${root}. Open the root of an orun repository.`);
  }
  const intentText = await readTextFile(intentPath);
  const intent = parseIntent(intentText);
  const files: string[] = [];
  for (const r of intent.roots) await findComponentFiles(joinPath(root, r), 4, files);
  const components: Component[] = [];
  for (const file of files.sort()) {
    const rel = file.slice(root.replace(/[\\/]+$/, "").length + 1);
    try {
      components.push(parseComponent(await readTextFile(file), file, rel));
    } catch (err) {
      errors.push(`${rel}: ${String(err)}`);
    }
  }
  return {
    root,
    name: intent.name || root.split(/[\\/]/).pop() || root,
    workspace: intent.workspace,
    intentText,
    environments: intent.environments,
    components,
    errors,
  };
}
