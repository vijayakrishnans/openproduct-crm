import { describe, expect, it } from "vitest";
import { buildTools } from "../lib/agent";
import { DEMO_ROOT } from "../lib/demo";
import { isReadOnly, McpClient } from "../lib/mcp";
import { isReadOnlyCommand, splitArgs } from "../lib/orun";
import { loadRepo, parseComponent } from "../lib/repo";
import { layout } from "../components/GraphView";

describe("repo", () => {
  it("loads intent.yaml and every component of the snapshot", async () => {
    const repo = await loadRepo(DEMO_ROOT);
    expect(repo.name).toBe("openproduct-crm");
    expect(repo.workspace).toMatch(/^ws_/);
    expect(repo.environments.map((e) => e.name)).toEqual(["dev", "stage", "prod"]);
    expect(repo.components.length).toBeGreaterThan(40);
    const edge = repo.components.find((c) => c.name === "api-edge")!;
    expect(edge.root).toBe("apps");
    expect(edge.dependsOn.some((d) => d.component === "identity-worker")).toBe(true);
    expect(repo.errors).toEqual([]);
  });

  it("reads dependsOn flags", () => {
    const c = parseComponent(
      "metadata: {name: x}\nspec:\n  type: t\n  dependsOn:\n    - component: a\n      input: true\n    - component: b\n      mode: enforced\n",
      "/r/apps/x/component.yaml",
      "apps/x/component.yaml",
    );
    expect(c.dependsOn).toEqual([
      { component: "a", input: true, mode: undefined },
      { component: "b", input: false, mode: "enforced" },
    ]);
    expect(c.path).toBe("apps/x");
  });
});

describe("orun command classification", () => {
  it("lets reads through and stops changes", () => {
    expect(isReadOnlyCommand(["plan", "--changed"])).toBe(true);
    expect(isReadOnlyCommand(["secrets", "list", "--env", "stage"])).toBe(true);
    expect(isReadOnlyCommand(["workspace", "ws_1"])).toBe(true);
    expect(isReadOnlyCommand(["workspace", "create", "x"])).toBe(false);
    expect(isReadOnlyCommand(["secrets", "set", "K"])).toBe(false);
    expect(isReadOnlyCommand(["run", "--remote-state"])).toBe(false);
    expect(isReadOnlyCommand(["plan", "--push-catalog"])).toBe(false);
  });

  it("splits a console line like a shell", () => {
    expect(splitArgs(`orun plan --intent "my intent.yaml" -x`)).toEqual(["plan", "--intent", "my intent.yaml", "-x"]);
  });
});

describe("agent tools", () => {
  it("maps MCP tools to valid API names and adds orun_cli last", () => {
    const { tools, byApiName } = buildTools([
      { name: "runs.list", inputSchema: { type: "object", properties: {} }, annotations: { readOnlyHint: true } },
      { name: "a_tool", inputSchema: { properties: { x: { type: "string" } } } },
    ]);
    expect(tools.map((t) => t.name)).toEqual(["a_tool", "runs_list", "orun_cli"]);
    expect(byApiName.get("runs_list")?.name).toBe("runs.list");
    expect(tools[0].input_schema.type).toBe("object");
    expect(isReadOnly(byApiName.get("a_tool")!)).toBe(false);
  });
});

describe("graph layout", () => {
  it("puts every dependency left of its dependents and survives cycles", async () => {
    const repo = await loadRepo(DEMO_ROOT);
    const g = layout(repo, true, true);
    let backwards = 0;
    for (const e of g.edges) if (g.pos.get(e.from)!.x >= g.pos.get(e.to)!.x) backwards++;
    // Only edges inside the documented peer loop may point backwards.
    expect(backwards).toBeLessThanOrEqual(4);
    expect(g.pos.size).toBe(repo.components.length);
    const lean = layout(repo, false, false);
    expect(lean.comps.some((c) => c.root === "packages" || c.root === "tests")).toBe(false);
  });
});

describe("mcp client", () => {
  it("initializes and lists tools over newline-delimited JSON-RPC", async () => {
    const log: string[] = [];
    const client = new McpClient((e) => log.push(`${e.dir} ${e.text}`));
    await client.start(undefined, false);
    const tools = await client.listTools();
    expect(client.serverInfo.name).toContain("orun");
    expect(tools.length).toBeGreaterThan(0);
    const r = await client.callTool("connection_info", {});
    expect(r.content[0].text).toContain("demo");
    expect(log.some((l) => l.startsWith("out ") && l.includes('"notifications/initialized"'))).toBe(true);
    await client.stop();
  });
});
