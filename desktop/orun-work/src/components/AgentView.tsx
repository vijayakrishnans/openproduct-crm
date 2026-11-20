import { useEffect, useRef, useState } from "react";

export type ChatItem =
  | { kind: "user"; text: string }
  | { kind: "text"; text: string }
  | { kind: "thinking"; text: string }
  | { kind: "tool"; id: string; name: string; input: unknown; readOnly: boolean; state: "run" | "ok" | "err"; output?: string }
  | { kind: "note"; text: string };

interface Props {
  items: ChatItem[];
  running: boolean;
  draft: string;
  setDraft: (s: string) => void;
  onSend: (text: string) => void;
  onStop: () => void;
  onNew: () => void;
  hasKey: boolean;
  onSettings: () => void;
  usage: { input: number; output: number; cacheRead: number };
}

const IDEAS = [
  "What is in this workspace? Summarise projects, environments and the latest runs.",
  "Did the last deploy to prod converge? Check runs and the health URLs.",
  "Plan the changed components and explain what would deploy.",
  "List the secret names in stage and tell me which runtime secrets look missing.",
];

export function AgentView({ items, running, draft, setDraft, onSend, onStop, onNew, hasKey, onSettings, usage }: Props) {
  const end = useRef<HTMLDivElement>(null);
  const [stick, setStick] = useState(true);
  useEffect(() => {
    if (stick) end.current?.scrollIntoView({ block: "end" });
  }, [items, stick]);

  const send = () => {
    const t = draft.trim();
    if (!t || running) return;
    onSend(t);
    setDraft("");
  };

  return (
    <div className="agent">
      <div
        className="transcript"
        onScroll={(e) => {
          const el = e.currentTarget;
          setStick(el.scrollHeight - el.scrollTop - el.clientHeight < 60);
        }}
      >
        {items.length === 0 && (
          <div className="starter">
            <img src="/orun-work.svg" alt="" />
            <h1>Ask Orun Work</h1>
            <div>
              The agent works through the orun MCP server and the orun CLI, as you. Anything that changes state asks
              you first.
            </div>
            {!hasKey && (
              <div style={{ marginTop: 12 }}>
                <button className="icon-btn primary" onClick={onSettings}>Add an Anthropic API key</button>
              </div>
            )}
            <div className="ideas">
              {IDEAS.map((i) => (
                <button key={i} onClick={() => setDraft(i)}>{i}</button>
              ))}
            </div>
          </div>
        )}
        {items.map((it, i) => {
          if (it.kind === "user")
            return (
              <div className="msg user" key={i}>
                <div className="who">You</div>
                <div className="bubble">{it.text}</div>
              </div>
            );
          if (it.kind === "text")
            return (
              <div className="msg assistant" key={i}>
                <div className="text">{it.text}</div>
              </div>
            );
          if (it.kind === "thinking")
            return (
              <div className="msg" key={i}>
                <details className="thinking">
                  <summary>Thinking</summary>
                  {it.text}
                </details>
              </div>
            );
          if (it.kind === "note")
            return (
              <div className="msg" key={i}>
                <div className="note">{it.text}</div>
              </div>
            );
          return (
            <div className="msg" key={i}>
              <details className="toolcard">
                <summary>
                  <span>⚙</span>
                  <b>{it.name}</b>
                  <span className={`badge ${it.readOnly ? "read" : "write"}`}>{it.readOnly ? "read" : "write"}</span>
                  <span className={`state ${it.state}`}>{it.state === "run" ? "running…" : it.state === "ok" ? "done" : "failed"}</span>
                </summary>
                <pre>{JSON.stringify(it.input, null, 2)}</pre>
                {it.output !== undefined && <pre>{it.output}</pre>}
              </details>
            </div>
          );
        })}
        <div ref={end} />
      </div>
      <div className="composer">
        <div className="composer-inner">
          <textarea
            value={draft}
            placeholder={hasKey ? "Ask about your workspace, or tell the agent what to do…" : "Add an API key in Settings to start"}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            rows={2}
          />
          {running ? (
            <button className="icon-btn stop" onClick={onStop}>■ Stop</button>
          ) : (
            <button className="icon-btn primary" onClick={send} disabled={!draft.trim() || !hasKey}>Send</button>
          )}
        </div>
        <div className="hint">
          <span>Enter to send · Shift+Enter for a new line</span>
          <span style={{ marginLeft: "auto" }}>
            tokens in {usage.input.toLocaleString()} · cached {usage.cacheRead.toLocaleString()} · out {usage.output.toLocaleString()}
          </span>
          <a href="#" onClick={(e) => (e.preventDefault(), onNew())}>New conversation</a>
        </div>
      </div>
    </div>
  );
}
