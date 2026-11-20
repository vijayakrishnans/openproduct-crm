import { useEffect, useState } from "react";
import { isReadOnly, type McpTool } from "../lib/mcp";
import { family, familyColor, FAMILY_LABEL } from "../lib/kinds";
import { openUrl } from "../lib/platform";
import type { Repo } from "../lib/repo";
import type { Selection } from "../lib/types";

interface Props {
  repo: Repo | null;
  tools: McpTool[];
  selection: Selection;
  busy: boolean;
  onSelect: (s: Selection) => void;
  onRun: (args: string[]) => void;
  onAsk: (prompt: string) => void;
  onCallTool: (name: string, args: Record<string, unknown>) => Promise<string>;
}

function Prop({ k, v }: { k: string; v?: string }) {
  if (!v) return null;
  return (
    <div className="prop">
      <span>{k}</span>
      <span>{v}</span>
    </div>
  );
}

function ToolInspector({ tool, onCallTool, onAsk }: { tool: McpTool; onCallTool: Props["onCallTool"]; onAsk: Props["onAsk"] }) {
  const [args, setArgs] = useState("{}");
  const [out, setOut] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  useEffect(() => {
    setArgs("{}");
    setOut(null);
  }, [tool.name]);

  const call = async () => {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(args || "{}");
    } catch (e) {
      setOut(`Arguments are not valid JSON: ${String(e)}`);
      return;
    }
    setRunning(true);
    try {
      setOut(await onCallTool(tool.name, parsed));
    } catch (e) {
      setOut(String(e));
    } finally {
      setRunning(false);
    }
  };

  return (
    <>
      <div className="inspector-head">
        <h2>
          {tool.name}
          <span className={`badge ${isReadOnly(tool) ? "read" : "write"}`}>{isReadOnly(tool) ? "read-only" : "may change state"}</span>
        </h2>
        {tool.description && <p>{tool.description}</p>}
      </div>
      <details className="section" open>
        <summary>Input schema</summary>
        <pre className="block">{JSON.stringify(tool.inputSchema, null, 2)}</pre>
      </details>
      <details className="section" open>
        <summary>Call</summary>
        <div className="field">
          <label htmlFor="tool-args">Arguments (JSON)</label>
          <textarea id="tool-args" value={args} onChange={(e) => setArgs(e.target.value)} spellCheck={false} />
        </div>
        <div className="actions">
          <button className="icon-btn play" disabled={running} onClick={call}>▶ Call tool</button>
          <button className="icon-btn" onClick={() => onAsk(`Use the ${tool.name} tool and explain what it returns.`)}>Ask agent</button>
        </div>
        {out !== null && <pre className="block">{out}</pre>}
      </details>
    </>
  );
}

export function Inspector({ repo, tools, selection, busy, onSelect, onRun, onAsk, onCallTool }: Props) {
  const body = (() => {
    if (!selection) {
      return <div className="empty">Select a component, an environment or an MCP tool to inspect it.</div>;
    }
    if (selection.kind === "tool") {
      const tool = tools.find((t) => t.name === selection.name);
      return tool ? <ToolInspector tool={tool} onCallTool={onCallTool} onAsk={onAsk} /> : null;
    }
    if (selection.kind === "environment") {
      const env = repo?.environments.find((e) => e.name === selection.name);
      if (!env || !repo) return null;
      const ws = repo.workspace ? ["--org", repo.workspace] : [];
      const deployed = repo.components.filter((c) => c.environments.some((s) => s.name === env.name));
      return (
        <>
          <div className="inspector-head">
            <h2>{env.name}</h2>
            {env.description && <p>{env.description}</p>}
          </div>
          <details className="section" open>
            <summary>Addresses</summary>
            {env.url && (
              <div className="prop"><span>url</span><a href={env.url} onClick={(e) => (e.preventDefault(), void openUrl(env.url!))}>{env.url}</a></div>
            )}
            {env.links.map((l) => (
              <div className="prop" key={l.url}><span>{l.title}</span><a href={l.url} onClick={(e) => (e.preventDefault(), void openUrl(l.url))}>{l.url}</a></div>
            ))}
            {!env.url && env.links.length === 0 && <div className="prop"><span>none</span><span>verify-only</span></div>}
          </details>
          <details className="section" open>
            <summary>Components subscribed ({deployed.length})</summary>
            <div className="chips">
              {deployed.map((c) => (
                <span key={c.name} className="chip" onClick={() => onSelect({ kind: "component", name: c.name })}>{c.name}</span>
              ))}
            </div>
          </details>
          <div className="actions">
            <button className="icon-btn" disabled={busy} onClick={() => onRun(["secrets", "list", ...ws, "--env", env.name])}>Secret names</button>
            <button className="icon-btn" disabled={busy} onClick={() => onRun(["status"])}>Status</button>
            <button className="icon-btn" onClick={() => onAsk(`Check the health of the ${env.name} environment: probe its addresses, list the latest runs and say whether it has converged.`)}>Ask agent to check</button>
          </div>
        </>
      );
    }
    const c = repo?.components.find((x) => x.name === selection.name);
    if (!c || !repo) return null;
    const fam = family(c.type, c.root);
    const dependents = repo.components.filter((x) => x.dependsOn.some((d) => d.component === c.name));
    return (
      <>
        <div className="inspector-head">
          <h2>
            <span className="dot" style={{ background: familyColor(fam) }} />
            {c.name}
          </h2>
          {c.description && <p>{c.description}</p>}
        </div>
        <details className="section" open>
          <summary>Component</summary>
          <Prop k="type" v={c.type} />
          <Prop k="family" v={FAMILY_LABEL[fam]} />
          <Prop k="path" v={c.path} />
          <Prop k="lifecycle" v={c.lifecycle} />
          <Prop k="owner" v={c.owner} />
          <Prop k="domain" v={c.domain} />
        </details>
        <details className="section" open>
          <summary>Environments</summary>
          <div className="chips">
            {c.environments.length === 0 && <span className="badge">none</span>}
            {c.environments.map((e) => (
              <span key={e.name} className="chip" onClick={() => onSelect({ kind: "environment", name: e.name })}>
                {e.name}{e.profile ? ` · ${e.profile}` : ""}
              </span>
            ))}
          </div>
        </details>
        <details className="section" open>
          <summary>Depends on ({c.dependsOn.length})</summary>
          <div className="chips">
            {c.dependsOn.map((d) => (
              <span
                key={d.component}
                className={`chip ${d.input ? "input" : ""}`}
                title={d.input ? "build input" : d.mode ? `mode: ${d.mode}` : "dependency"}
                onClick={() => onSelect({ kind: "component", name: d.component })}
              >
                {d.component}{d.mode === "enforced" ? " ⚑" : ""}
              </span>
            ))}
          </div>
        </details>
        <details className="section">
          <summary>Depended on by ({dependents.length})</summary>
          <div className="chips">
            {dependents.map((d) => (
              <span key={d.name} className="chip" onClick={() => onSelect({ kind: "component", name: d.name })}>{d.name}</span>
            ))}
          </div>
        </details>
        {Object.keys(c.parameters).length > 0 && (
          <details className="section">
            <summary>Parameters</summary>
            {Object.entries(c.parameters).map(([k, v]) => (
              <Prop key={k} k={k} v={typeof v === "string" ? v : JSON.stringify(v)} />
            ))}
          </details>
        )}
        <details className="section">
          <summary>component.yaml</summary>
          <pre className="block">{c.text}</pre>
        </details>
        <div className="actions">
          <button className="icon-btn play" disabled={busy} onClick={() => onRun(["plan", "--intent", "intent.yaml", "--component", c.name])}>▶ Plan</button>
          <button className="icon-btn" disabled={busy} onClick={() => onRun(["validate"])}>Validate</button>
          <button className="icon-btn" onClick={() => onAsk(`Tell me about the ${c.name} component: what it is, where it is deployed, its latest runs, and anything that looks wrong.`)}>Ask agent</button>
        </div>
      </>
    );
  })();

  return (
    <aside className="dock dock-right">
      <div className="dock-tabs">
        <button className="active">Inspector</button>
      </div>
      <div className="dock-body">{body}</div>
    </aside>
  );
}
