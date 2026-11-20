import { useMemo, useState } from "react";
import type { McpTool } from "../lib/mcp";
import { isReadOnly } from "../lib/mcp";
import { family, familyColor } from "../lib/kinds";
import type { Repo } from "../lib/repo";
import type { Selection } from "../lib/types";

interface Props {
  repo: Repo | null;
  tools: McpTool[];
  mcpState: "off" | "starting" | "on" | "error";
  selection: Selection;
  onSelect: (s: Selection) => void;
  onOpenRepo: () => void;
  onConnect: () => void;
}

export function SceneDock({ repo, tools, mcpState, selection, onSelect, onOpenRepo, onConnect }: Props) {
  const [tab, setTab] = useState<"scene" | "tools">("scene");
  const [filter, setFilter] = useState("");
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  const q = filter.trim().toLowerCase();

  const groups = useMemo(() => {
    const out = new Map<string, Repo["components"]>();
    for (const c of repo?.components ?? []) {
      if (q && !c.name.toLowerCase().includes(q) && !c.type.toLowerCase().includes(q)) continue;
      const g = c.root || "other";
      out.set(g, [...(out.get(g) ?? []), c]);
    }
    return [...out].sort(([a], [b]) => a.localeCompare(b));
  }, [repo, q]);

  const shownTools = tools.filter((t) => !q || t.name.toLowerCase().includes(q) || (t.description ?? "").toLowerCase().includes(q));
  const toggle = (g: string) => setClosed((c) => ({ ...c, [g]: !c[g] }));
  const isSel = (kind: string, name: string) => selection?.kind === kind && selection.name === name;

  return (
    <aside className="dock dock-left">
      <div className="dock-tabs">
        <button className={tab === "scene" ? "active" : ""} onClick={() => setTab("scene")}>Scene</button>
        <button className={tab === "tools" ? "active" : ""} onClick={() => setTab("tools")}>
          MCP tools{tools.length ? ` (${tools.length})` : ""}
        </button>
      </div>
      <div className="dock-tools">
        <input placeholder="Filter" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter" />
      </div>
      <div className="dock-body">
        {tab === "scene" && !repo && (
          <div className="empty">
            No repository open.
            <br />
            <button className="icon-btn primary" onClick={onOpenRepo}>Open repository…</button>
          </div>
        )}
        {tab === "scene" && repo && (
          <div className="tree">
            <div className="tree-group" onClick={() => toggle("$env")}>
              <span className={`chev ${closed.$env ? "" : "open"}`}>▸</span> Environments
              <span className="badge" style={{ marginLeft: "auto" }}>{repo.environments.length}</span>
            </div>
            {!closed.$env &&
              repo.environments.map((e) => (
                <div
                  key={e.name}
                  className={`tree-item ${isSel("environment", e.name) ? "selected" : ""}`}
                  onClick={() => onSelect({ kind: "environment", name: e.name })}
                >
                  <span className="dot" style={{ background: "var(--ok)", borderRadius: "50%" }} />
                  {e.name}
                  <span className="sub">{e.url?.replace(/^https?:\/\//, "") ?? ""}</span>
                </div>
              ))}
            {groups.map(([g, comps]) => (
              <div key={g}>
                <div className="tree-group" onClick={() => toggle(g)}>
                  <span className={`chev ${closed[g] ? "" : "open"}`}>▸</span> {g}/
                  <span className="badge" style={{ marginLeft: "auto" }}>{comps.length}</span>
                </div>
                {!closed[g] &&
                  comps.map((c) => (
                    <div
                      key={c.name}
                      className={`tree-item ${isSel("component", c.name) ? "selected" : ""}`}
                      onClick={() => onSelect({ kind: "component", name: c.name })}
                      title={c.description}
                    >
                      <span className="dot" style={{ background: familyColor(family(c.type, c.root)) }} />
                      {c.name}
                      <span className="sub">{c.type}</span>
                    </div>
                  ))}
              </div>
            ))}
          </div>
        )}
        {tab === "tools" && tools.length === 0 && (
          <div className="empty">
            {mcpState === "starting" ? "Starting orun mcp serve…" : "The orun MCP server is not connected."}
            <br />
            {mcpState !== "starting" && (
              <button className="icon-btn primary" onClick={onConnect}>Connect</button>
            )}
          </div>
        )}
        {tab === "tools" && (
          <div className="tree">
            {shownTools.map((t) => (
              <div
                key={t.name}
                className={`tree-item ${isSel("tool", t.name) ? "selected" : ""}`}
                style={{ paddingLeft: 10 }}
                onClick={() => onSelect({ kind: "tool", name: t.name })}
                title={t.description}
              >
                {t.name}
                <span className={`badge ${isReadOnly(t) ? "read" : "write"}`} style={{ marginLeft: "auto" }}>
                  {isReadOnly(t) ? "read" : "write"}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}
