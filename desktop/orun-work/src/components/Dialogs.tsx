import { useState } from "react";
import { Linkify } from "./Linkify";
import type { Effort } from "../lib/agent";
import type { Settings } from "../lib/settings";

export function SettingsDialog({ settings, onSave, onClose }: { settings: Settings; onSave: (s: Settings) => void; onClose: () => void }) {
  const [s, setS] = useState(settings);
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-label="Settings">
        <h3>Settings</h3>
        <div className="body">
          <div className="field">
            <label htmlFor="key">Anthropic API key</label>
            <input
              id="key"
              type="password"
              value={s.apiKey}
              placeholder="sk-ant-…  (or set ANTHROPIC_API_KEY before starting the app)"
              onChange={(e) => setS({ ...s, apiKey: e.target.value.trim() })}
            />
          </div>
          <p>Kept on this computer only, in the app's local storage. Used for the agent; nothing else is sent anywhere.</p>
          <div className="field">
            <label htmlFor="effort">Agent effort</label>
            <select id="effort" value={s.effort} onChange={(e) => setS({ ...s, effort: e.target.value as Effort })}>
              <option value="low">low — fastest, cheapest</option>
              <option value="medium">medium</option>
              <option value="high">high — recommended</option>
              <option value="xhigh">xhigh</option>
              <option value="max">max — slowest, most thorough</option>
            </select>
          </div>
          <label className="check">
            <input type="checkbox" checked={s.autoApproveReads} onChange={(e) => setS({ ...s, autoApproveReads: e.target.checked })} />
            Run read-only tools without asking
          </label>
          <label className="check">
            <input type="checkbox" checked={s.mcpReadOnly} onChange={(e) => setS({ ...s, mcpReadOnly: e.target.checked })} />
            Start the MCP server read-only (orun mcp serve --read-only)
          </label>
        </div>
        <div className="foot">
          <button className="icon-btn" onClick={onClose}>Cancel</button>
          <button className="icon-btn primary" onClick={() => onSave(s)}>Save</button>
        </div>
      </div>
    </div>
  );
}

export function ApprovalDialog({ tool, input, onAnswer }: { tool: string; input: unknown; onAnswer: (ok: boolean) => void }) {
  return (
    <div className="scrim">
      <div className="dialog" role="alertdialog" aria-label="Approve action">
        <h3>Allow the agent to run {tool}?</h3>
        <div className="body">
          <p>This may change something in Orunbase or your repository.</p>
          <pre className="block">{JSON.stringify(input, null, 2)}</pre>
        </div>
        <div className="foot">
          <button className="icon-btn" onClick={() => onAnswer(false)}>Decline</button>
          <button className="icon-btn primary" autoFocus onClick={() => onAnswer(true)}>Allow</button>
        </div>
      </div>
    </div>
  );
}

interface WelcomeProps {
  auth: "unknown" | "in" | "out" | "signing-in";
  authLines: string[];
  repoName: string | null;
  hasKey: boolean;
  onSignIn: () => void;
  onOpenRepo: () => void;
  onSaveKey: (key: string) => void;
  onClose: () => void;
}

/** First run: everything the app needs, from inside the app. */
export function WelcomeDialog({ auth, authLines, repoName, hasKey, onSignIn, onOpenRepo, onSaveKey, onClose }: WelcomeProps) {
  const [key, setKey] = useState("");
  const step = (done: boolean, n: number) => <span className={`step ${done ? "done" : ""}`}>{done ? "✓" : n}</span>;
  return (
    <div className="scrim">
      <div className="dialog wide" role="dialog" aria-label="Welcome">
        <h3>Welcome to Orun Work</h3>
        <div className="body">
          <p>orun comes with the app, so there is nothing else to install. Three steps, all optional:</p>

          <div className="welcome-step">
            {step(auth === "in", 1)}
            <div>
              <b>Sign in to Orunbase</b>
              <div className="muted">Opens your browser to approve this computer. Needed for workspaces, runs, secrets and the MCP tools.</div>
              {auth === "in" ? (
                <div className="ok">Signed in.</div>
              ) : (
                <button className="icon-btn primary" disabled={auth === "signing-in"} onClick={onSignIn}>
                  {auth === "signing-in" ? "Waiting for the browser…" : "Sign in"}
                </button>
              )}
              {auth === "signing-in" && authLines.length > 0 && (
                <pre className="block">{authLines.map((l, i) => <div key={i}><Linkify text={l} /></div>)}</pre>
              )}
            </div>
          </div>

          <div className="welcome-step">
            {step(!!repoName, 2)}
            <div>
              <b>Open a repository</b>
              <div className="muted">A folder with an intent.yaml, for the graph and for planning. Skip it to work with Orunbase only.</div>
              {repoName ? <div className="ok">{repoName}</div> : <button className="icon-btn" onClick={onOpenRepo}>Open folder…</button>}
            </div>
          </div>

          <div className="welcome-step">
            {step(hasKey, 3)}
            <div>
              <b>Turn on the agent</b>
              <div className="muted">
                The agent runs on Claude and needs your own Anthropic API key (console.anthropic.com → API keys).
                Everything else works without one.
              </div>
              {hasKey ? (
                <div className="ok">Key saved.</div>
              ) : (
                <div className="row">
                  <input type="password" placeholder="sk-ant-…" value={key} onChange={(e) => setKey(e.target.value.trim())} aria-label="Anthropic API key" />
                  <button className="icon-btn" disabled={!key} onClick={() => onSaveKey(key)}>Save</button>
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="foot">
          <button className="icon-btn primary" onClick={onClose}>{auth === "in" ? "Start" : "Skip for now"}</button>
        </div>
      </div>
    </div>
  );
}
