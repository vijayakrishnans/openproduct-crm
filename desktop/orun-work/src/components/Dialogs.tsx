import { useState } from "react";
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
