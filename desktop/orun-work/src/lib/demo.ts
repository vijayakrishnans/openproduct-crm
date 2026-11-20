// Browser-only stand-ins for the native layer (see platform.ts). Nothing here
// runs inside the Tauri app. The repository is a snapshot of a real orun repo
// (scripts/snapshot-demo.mjs); the MCP server and CLI are simulations,
// labelled as such in everything they print.
import files from "./demo-repo.json";
import type { DirEntry, Proc, SpawnOptions } from "./platform";

export const DEMO_ROOT = "demo:/openproduct-crm";
const FILES = files as Record<string, string>;

function rel(path: string) {
  return path.replace(DEMO_ROOT, "").replace(/^\/+/, "").replace(/\/+$/, "");
}

export async function readDir(path: string): Promise<DirEntry[]> {
  const prefix = rel(path) ? rel(path) + "/" : "";
  const seen = new Map<string, boolean>();
  for (const f of Object.keys(FILES)) {
    if (!f.startsWith(prefix)) continue;
    const rest = f.slice(prefix.length).split("/");
    seen.set(rest[0], seen.get(rest[0]) || rest.length > 1);
  }
  if (seen.size === 0) throw new Error(`not found: ${path}`);
  return [...seen].map(([name, isDirectory]) => ({ name, isDirectory }));
}

export async function readTextFile(path: string): Promise<string> {
  const text = FILES[rel(path)];
  if (text === undefined) throw new Error(`not found: ${path}`);
  return text;
}

export async function exists(path: string): Promise<boolean> {
  return FILES[rel(path)] !== undefined;
}

const DEMO_TOOLS = [
  { name: "connection_info", description: "Demo: report auth state, backend URL and mounted planes.", annotations: { readOnlyHint: true }, inputSchema: { type: "object", properties: {} } },
  { name: "catalog_list", description: "Demo: list catalog entities in the workspace.", annotations: { readOnlyHint: true }, inputSchema: { type: "object", properties: { kind: { type: "string" } } } },
  { name: "runs_list", description: "Demo: list recent runs.", annotations: { readOnlyHint: true }, inputSchema: { type: "object", properties: { limit: { type: "number" } } } },
  { name: "run_logs", description: "Demo: fetch a run's logs.", annotations: { readOnlyHint: true }, inputSchema: { type: "object", properties: { runId: { type: "string" } }, required: ["runId"] } },
  { name: "environment_create", description: "Demo: create an environment (write).", annotations: { readOnlyHint: false }, inputSchema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] } },
];

function demoMcp(opts: SpawnOptions): Proc {
  opts.onStderr("[demo] simulated orun mcp serve — not connected to Orunbase");
  return {
    async write(data) {
      for (const line of data.split("\n").filter(Boolean)) {
        const msg = JSON.parse(line) as { id?: number; method: string; params?: { name?: string } };
        if (msg.id === undefined) continue;
        let result: unknown;
        if (msg.method === "initialize") {
          result = { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "orun (demo)", version: "0.0.0-demo" } };
        } else if (msg.method === "tools/list") {
          result = { tools: DEMO_TOOLS };
        } else if (msg.method === "tools/call") {
          result = { content: [{ type: "text", text: `[demo] ${msg.params?.name} would run here. Install orun and sign in (orun auth login) for real data.` }] };
        } else {
          result = {};
        }
        setTimeout(() => opts.onStdout(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result })), 60);
      }
    },
    async kill() {
      opts.onClose(null);
    },
  };
}

function demoCli(args: string[], opts: SpawnOptions): Proc {
  const lines = [
    `[demo] orun ${args.join(" ")} — simulated output; the desktop app runs the real orun binary`,
  ];
  if (args[0] === "plan") {
    lines.push(
      "resolving compositions … stack-tectonic@0.23.0",
      "planning changed components against main",
      "  dev    api-edge          verify",
      "  stage  api-edge          verify → deploy",
      "  prod   api-edge          verify → deploy (after stage)",
      "plan: 3 jobs in 2 lanes · written to plan.json",
    );
  } else if (args[0] === "validate") {
    lines.push("intent.yaml ok", "48 components ok", "validate: no problems");
  } else {
    lines.push("ok");
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  let i = 0;
  const tick = () => {
    if (i < lines.length) {
      opts.onStdout(lines[i++]);
      timer = setTimeout(tick, 140);
    } else opts.onClose(0);
  };
  timer = setTimeout(tick, 100);
  return {
    async write() {},
    async kill() {
      clearTimeout(timer);
      opts.onClose(null);
    },
  };
}

export async function spawnOrun(args: string[], opts: SpawnOptions): Promise<Proc> {
  if (args[0] === "mcp" && args[1] === "serve") return demoMcp(opts);
  return demoCli(args, opts);
}
