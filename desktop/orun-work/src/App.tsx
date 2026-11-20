import Anthropic from "@anthropic-ai/sdk";
import { useCallback, useEffect, useRef, useState } from "react";
import { AgentView, type ChatItem } from "./components/AgentView";
import { ApprovalDialog, SettingsDialog, WelcomeDialog } from "./components/Dialogs";
import { Linkify } from "./components/Linkify";
import { GraphView } from "./components/GraphView";
import { Inspector } from "./components/Inspector";
import { SceneDock } from "./components/SceneDock";
import { contextPreamble, MODEL, runTurn } from "./lib/agent";
import { McpClient, resultText, type McpTool } from "./lib/mcp";
import { runOrun, splitArgs, type RunHandle } from "./lib/orun";
import { apiKeyFromEnv, isTauri, openUrl, pickFolder } from "./lib/platform";
import { loadRepo, type Repo } from "./lib/repo";
import { loadSettings, saveSettings, type Settings } from "./lib/settings";
import type { LogLine, Screen, Selection } from "./lib/types";

type McpState = "off" | "starting" | "on" | "error";

function Menu({ label, children }: { label: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);
  return (
    <div className={`menu ${open ? "open" : ""}`} ref={ref}>
      <button onClick={() => setOpen(!open)}>{label}</button>
      {open && (
        <div className="menu-list" onClick={() => setOpen(false)}>
          {children}
        </div>
      )}
    </div>
  );
}

export function App() {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [envKey, setEnvKey] = useState<string | null>(null);
  const [repo, setRepo] = useState<Repo | null>(null);
  const [selection, setSelection] = useState<Selection>(null);
  const [screen, setScreen] = useState<Screen>("graph");
  const [envName, setEnvName] = useState("stage");
  const [showSettings, setShowSettings] = useState(false);

  // bottom panel
  const [bottomTab, setBottomTab] = useState<"output" | "mcp" | "problems">("output");
  const [output, setOutput] = useState<LogLine[]>([]);
  const [mcpLog, setMcpLog] = useState<LogLine[]>([]);
  const [cmd, setCmd] = useState("");
  const [run, setRun] = useState<RunHandle | null>(null);

  // MCP
  const mcpRef = useRef<McpClient | null>(null);
  const [mcpState, setMcpState] = useState<McpState>("off");
  const [tools, setTools] = useState<McpTool[]>([]);
  const [serverName, setServerName] = useState("");

  // agent
  const [items, setItems] = useState<ChatItem[]>([]);
  const [draft, setDraft] = useState("");
  const [agentRunning, setAgentRunning] = useState(false);
  const [usage, setUsage] = useState({ input: 0, output: 0, cacheRead: 0 });
  const convo = useRef<Anthropic.Beta.BetaMessageParam[]>([]);
  const abort = useRef<AbortController | null>(null);
  const [approval, setApproval] = useState<{ tool: string; input: unknown; resolve: (ok: boolean) => void } | null>(null);

  const apiKey = settings.apiKey || envKey || "";

  const out = useCallback((text: string, kind: LogLine["kind"] = "out") => {
    setOutput((o) => [...o.slice(-4000), { at: Date.now(), kind, text }]);
  }, []);

  const openRepo = useCallback(
    async (path?: string) => {
      const root = path ?? (await pickFolder());
      if (!root) return;
      try {
        const r = await loadRepo(root);
        setRepo(r);
        setSelection(null);
        setEnvName(r.environments.find((e) => e.name === "stage")?.name ?? r.environments[0]?.name ?? "");
        setSettings((s) => {
          const next = { ...s, lastRepo: root };
          saveSettings(next);
          return next;
        });
        out(`opened ${r.name}: ${r.components.length} components, ${r.environments.length} environments`, "info");
        r.errors.forEach((e) => out(e, "err"));
      } catch (err) {
        out(String(err instanceof Error ? err.message : err), "err");
        setBottomTab("output");
      }
    },
    [out],
  );

  const connectMcp = useCallback(async () => {
    await mcpRef.current?.stop();
    const client = new McpClient((e) =>
      setMcpLog((l) => [...l.slice(-3000), { at: e.at, kind: e.dir === "out" ? "out" : e.dir === "in" ? "in" : e.dir === "err" ? "err" : "info", text: e.text }]),
    );
    mcpRef.current = client;
    setMcpState("starting");
    setTools([]);
    try {
      await client.start(repo?.root, settings.mcpReadOnly);
      const list = await client.listTools();
      setTools(list);
      setServerName([client.serverInfo.name, client.serverInfo.version].filter(Boolean).join(" "));
      setMcpState("on");
      out(`MCP connected: ${list.length} tools`, "info");
    } catch (err) {
      setMcpState("error");
      out(`MCP: ${err instanceof Error ? err.message : String(err)}`, "err");
      out("Run `mcp doctor` in the console below to see why.", "err");
      setBottomTab("mcp");
    }
  }, [repo?.root, settings.mcpReadOnly, out]);

  // Orunbase sign-in, through the bundled orun.
  const [auth, setAuth] = useState<"unknown" | "in" | "out" | "signing-in">("unknown");
  const [authLines, setAuthLines] = useState<string[]>([]);
  const authRun = useRef<RunHandle | null>(null);
  const checkAuth = useCallback(async () => {
    const code = await runOrun(["auth", "status", "--offline"], undefined, () => undefined).done;
    setAuth(code === 0 ? "in" : "out");
    return code === 0;
  }, []);

  // start-up: env key, sign-in state, last repo (or the demo); the MCP
  // server starts once that settles and restarts when the repository changes.
  const [booted, setBooted] = useState(false);
  useEffect(() => {
    void apiKeyFromEnv().then(setEnvKey).catch(() => undefined);
    void checkAuth();
    const last = loadSettings().lastRepo;
    void (last || !isTauri ? openRepo(isTauri ? last : undefined) : Promise.resolve()).finally(() => setBooted(true));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (booted) void connectMcp();
  }, [booted, repo?.root]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => void mcpRef.current?.stop(), []);

  const runCmd = useCallback(
    (args: string[]) => {
      if (run) return;
      setBottomTab("output");
      out(`$ orun ${args.join(" ")}`, "info");
      const h = runOrun(args, repo?.root, (line, stream) => out(line, stream));
      setRun(h);
      void h.done.then((code) => {
        out(`exit ${code ?? "(stopped)"}`, code === 0 ? "info" : "err");
        setRun(null);
      });
    },
    [run, repo?.root, out],
  );

  const signIn = useCallback(() => {
    if (authRun.current) return;
    setAuth("signing-in");
    setAuthLines([]);
    const args = ["auth", "login", ...(repo ? [] : ["--no-link"])];
    out(`$ orun ${args.join(" ")}`, "info");
    const h = runOrun(args, repo?.root, (line, stream) => {
      out(line, stream);
      if (line.trim()) setAuthLines((l) => [...l.slice(-30), line]);
    });
    authRun.current = h;
    void h.done.then(async (code) => {
      authRun.current = null;
      out(`exit ${code ?? "(stopped)"}`, code === 0 ? "info" : "err");
      if (await checkAuth()) void connectMcp();
    });
  }, [repo, out, checkAuth, connectMcp]);

  const signOut = useCallback(async () => {
    await runOrun(["auth", "logout"], undefined, (l, st) => out(l, st)).done;
    await checkAuth();
    void connectMcp();
  }, [out, checkAuth, connectMcp]);

  const callTool = useCallback(async (name: string, args: Record<string, unknown>) => {
    if (!mcpRef.current || mcpRef.current.closed) throw new Error("MCP is not connected");
    const r = await mcpRef.current.callTool(name, args);
    return (r.isError ? "error:\n" : "") + resultText(r);
  }, []);

  const send = useCallback(
    async (text: string) => {
      if (!apiKey) {
        setShowSettings(true);
        return;
      }
      setScreen("agent");
      setItems((it) => [...it, { kind: "user", text }]);
      const content = convo.current.length === 0 ? `<editor_context>\n${contextPreamble(repo)}\n</editor_context>\n\n${text}` : text;
      convo.current.push({ role: "user", content });
      const ac = new AbortController();
      abort.current = ac;
      setAgentRunning(true);

      // Streamed deltas append to the last item of the same kind.
      const append = (kind: "text" | "thinking", delta: string) =>
        setItems((it) => {
          const last = it[it.length - 1];
          if (last && last.kind === kind) return [...it.slice(0, -1), { ...last, text: last.text + delta }];
          return [...it, { kind, text: delta }];
        });

      try {
        await runTurn(convo.current, {
          apiKey,
          mcp: mcpState === "on" ? mcpRef.current : null,
          mcpTools: mcpState === "on" ? tools : [],
          repoRoot: repo?.root,
          effort: settings.effort,
          autoApproveReads: settings.autoApproveReads,
          signal: ac.signal,
          approve: (tool, input) => new Promise((resolve) => setApproval({ tool, input, resolve })),
          onEvent: (e) => {
            switch (e.type) {
              case "text":
              case "thinking":
                append(e.type, e.delta);
                break;
              case "tool_start":
                setItems((it) => [...it, { kind: "tool", id: e.id, name: e.name, input: e.input, readOnly: e.readOnly, state: "run" }]);
                break;
              case "tool_end":
                setItems((it) => it.map((x) => (x.kind === "tool" && x.id === e.id ? { ...x, state: e.isError ? "err" : "ok", output: e.output } : x)));
                break;
              case "fallback":
                setItems((it) => [...it, { kind: "note", text: `${e.from} declined; ${e.to} continued.` }]);
                break;
              case "usage":
                setUsage((u) => ({ input: u.input + e.input, output: u.output + e.output, cacheRead: u.cacheRead + e.cacheRead }));
                break;
              case "done":
                if (e.stopReason === "refusal") setItems((it) => [...it, { kind: "note", text: "The model declined this request." }]);
                if (e.stopReason === "max_tokens") setItems((it) => [...it, { kind: "note", text: "The reply hit the output limit and was cut off." }]);
                break;
            }
          },
        });
      } catch (err) {
        let msg = err instanceof Error ? err.message : String(err);
        if (err instanceof Anthropic.AuthenticationError) msg = "The API key was rejected. Check it in Settings.";
        else if (err instanceof Anthropic.RateLimitError) msg = "Rate limited by the API. Wait a moment and try again.";
        else if (err instanceof Anthropic.APIError) msg = `API error ${err.status}: ${err.message}`;
        setItems((it) => [...it, { kind: "note", text: msg }]);
        // Drop a dangling user turn so the next message starts cleanly.
        const lastMsg = convo.current[convo.current.length - 1];
        if (lastMsg?.role === "user" && typeof lastMsg.content === "string") convo.current.pop();
      } finally {
        setAgentRunning(false);
        abort.current = null;
      }
    },
    [apiKey, repo, mcpState, tools, settings.effort, settings.autoApproveReads],
  );

  const stopAgent = () => {
    abort.current?.abort();
    approval?.resolve(false);
    setApproval(null);
    // A stopped turn can leave tool_use blocks without results; start a fresh
    // conversation history from the next message rather than send an invalid one.
    const last = convo.current[convo.current.length - 1];
    if (last?.role === "assistant") convo.current = [];
    setItems((it) => [...it, { kind: "note", text: "Stopped." }]);
  };

  const ask = (prompt: string) => {
    setScreen("agent");
    setDraft(prompt);
  };

  const ws = repo?.workspace ? ["--org", repo.workspace] : [];
  const problems = [
    ...(repo?.errors ?? []),
    ...(mcpState === "error" ? ["The orun MCP server did not start. See the MCP tab."] : []),
    ...(!apiKey ? ["No Anthropic API key: the agent is unavailable until one is set in Settings."] : []),
  ];

  return (
    <div className="app">
      <header className="menubar">
        <div className="brand">
          <img src="/orun-work.svg" alt="" /> Orun Work
        </div>
        <Menu label="Repository">
          <button onClick={() => openRepo()}>Open…</button>
          <button disabled={!repo} onClick={() => repo && openRepo(repo.root)}>Reload</button>
          <hr />
          <button disabled={!!run || !repo} onClick={() => runCmd(["validate"])}>Validate</button>
          <button disabled={!!run || !repo} onClick={() => runCmd(["plan", "--changed", "--intent", "intent.yaml"])}>Plan changed</button>
          <button disabled={!!run || !repo} onClick={() => runCmd(["plan", "--intent", "intent.yaml"])}>Plan everything</button>
        </Menu>
        <Menu label="Orunbase">
          <button onClick={connectMcp}>{mcpState === "on" ? "Reconnect MCP server" : "Connect MCP server"}</button>
          {auth === "in" ? (
            <button onClick={signOut}>Sign out</button>
          ) : (
            <button disabled={auth === "signing-in"} onClick={signIn}>Sign in…</button>
          )}
          <button disabled={!!run} onClick={() => runCmd(["auth", "status"])}>Sign-in status</button>
          <hr />
          <button disabled={!!run} onClick={() => runCmd(["workspace", ...(repo?.workspace ? [repo.workspace] : [])])}>Workspace</button>
          <button disabled={!!run} onClick={() => runCmd(["integrations", "list", ...ws])}>Integrations</button>
          <button disabled={!!run} onClick={() => runCmd(["cloud", "check", ...ws])}>Readiness check</button>
          <button disabled={!!run} onClick={() => runCmd(["mcp", "doctor"])}>MCP doctor</button>
        </Menu>
        <Menu label="Help">
          <button onClick={() => void openUrl("https://orun.dev/docs/")}>orun docs</button>
          <button onClick={() => void openUrl("https://docs.orunbase.com")}>Orunbase docs</button>
          <button onClick={() => runCmd(["version"])} disabled={!!run}>orun version</button>
        </Menu>

        <nav className="screens" aria-label="Main screen">
          <button className={screen === "graph" ? "active" : ""} onClick={() => setScreen("graph")}>◇ Graph</button>
          <button className={screen === "agent" ? "active" : ""} onClick={() => setScreen("agent")}>✦ Agent</button>
          <button className={screen === "intent" ? "active" : ""} onClick={() => setScreen("intent")}>≡ Intent</button>
        </nav>

        <div className="runbar">
          <select value={envName} onChange={(e) => setEnvName(e.target.value)} aria-label="Environment" disabled={!repo}>
            {(repo?.environments ?? []).map((e) => (
              <option key={e.name} value={e.name}>{e.name}</option>
            ))}
          </select>
          <button className="icon-btn play" title="Plan changed components (orun plan --changed)" disabled={!repo || !!run} onClick={() => runCmd(["plan", "--changed", "--intent", "intent.yaml"])}>▶</button>
          <button className="icon-btn" title={`Secret names in ${envName}`} disabled={!repo || !!run} onClick={() => runCmd(["secrets", "list", ...ws, "--env", envName])}>🔑</button>
          <button className="icon-btn stop" title="Stop the running command" disabled={!run} onClick={() => run?.stop()}>■</button>
          <button className="icon-btn" title="Settings" onClick={() => setShowSettings(true)}>⚙</button>
        </div>
      </header>

      <SceneDock
        repo={repo}
        tools={tools}
        mcpState={mcpState}
        selection={selection}
        onSelect={setSelection}
        onOpenRepo={() => openRepo()}
        onConnect={connectMcp}
      />

      <main className="main">
        {!isTauri && <div className="demo-banner">Browser preview · demo data</div>}
        {screen === "graph" && <GraphView repo={repo} selection={selection} onSelect={setSelection} />}
        {screen === "agent" && (
          <AgentView
            items={items}
            running={agentRunning}
            draft={draft}
            setDraft={setDraft}
            onSend={send}
            onStop={stopAgent}
            onNew={() => {
              if (agentRunning) return;
              convo.current = [];
              setItems([]);
              setUsage({ input: 0, output: 0, cacheRead: 0 });
            }}
            hasKey={!!apiKey}
            onSettings={() => setShowSettings(true)}
            usage={usage}
          />
        )}
        {screen === "intent" && (
          <div className="intent">
            {repo ? <pre>{repo.intentText}</pre> : <div className="empty">No repository open.</div>}
          </div>
        )}
      </main>

      <Inspector
        repo={repo}
        tools={tools}
        selection={selection}
        busy={!!run}
        onSelect={setSelection}
        onRun={runCmd}
        onAsk={ask}
        onCallTool={callTool}
      />

      <section className="bottom">
        <div className="dock-tabs">
          <button className={bottomTab === "output" ? "active" : ""} onClick={() => setBottomTab("output")}>Output</button>
          <button className={bottomTab === "mcp" ? "active" : ""} onClick={() => setBottomTab("mcp")}>MCP</button>
          <button className={bottomTab === "problems" ? "active" : ""} onClick={() => setBottomTab("problems")}>
            Problems{problems.length ? ` (${problems.length})` : ""}
          </button>
          <span className="spacer" />
          <button onClick={() => (bottomTab === "mcp" ? setMcpLog([]) : setOutput([]))}>Clear</button>
        </div>
        <div className="log">
          {bottomTab === "problems" &&
            (problems.length ? problems.map((p, i) => <div key={i} className="err">• {p}</div>) : <div className="info">No problems.</div>)}
          {bottomTab !== "problems" &&
            (bottomTab === "output" ? output : mcpLog).map((l, i) => (
              <div key={i} className={l.kind}>
                <time>{new Date(l.at).toLocaleTimeString()}</time>
                <Linkify text={l.text} />
              </div>
            ))}
        </div>
        {bottomTab === "output" && (
          <form
            className="console"
            onSubmit={(e) => {
              e.preventDefault();
              const args = splitArgs(cmd);
              if (args.length && !run) {
                runCmd(args);
                setCmd("");
              }
            }}
          >
            <span>orun ▸</span>
            <input value={cmd} onChange={(e) => setCmd(e.target.value)} placeholder="plan --changed --intent intent.yaml" aria-label="orun command" />
          </form>
        )}
      </section>

      <footer className="statusbar">
        <span>
          <i className={`led ${mcpState === "on" ? "on" : mcpState === "starting" ? "busy" : mcpState === "error" ? "off" : ""}`} />
          MCP {mcpState === "on" ? `${serverName} · ${tools.length} tools` : mcpState}
        </span>
        <span>
          <i className={`led ${auth === "in" ? "on" : auth === "signing-in" ? "busy" : auth === "out" ? "off" : ""}`} />
          Orunbase {auth === "in" ? "signed in" : auth === "signing-in" ? "signing in…" : auth === "out" ? "" : "…"}
          {auth === "out" && <button className="linkish" onClick={signIn}>sign in</button>}
        </span>
        <span>{repo ? `${repo.name} · ${repo.workspace ?? "no workspace"}` : "no repository"}</span>
        {run && <span><i className="led busy" />running orun…</span>}
        <span className="right">
          <span>{MODEL} · effort {settings.effort}</span>
          <span>{apiKey ? (settings.apiKey ? "key: settings" : "key: environment") : "no API key"}</span>
        </span>
      </footer>

      {showSettings && (
        <SettingsDialog
          settings={settings}
          onClose={() => setShowSettings(false)}
          onSave={(s) => {
            setSettings(s);
            saveSettings(s);
            setShowSettings(false);
          }}
        />
      )}
      {(isTauri || location.search.includes("welcome")) && !settings.welcomed && (
        <WelcomeDialog
          auth={auth}
          authLines={authLines}
          repoName={repo?.name ?? null}
          hasKey={!!apiKey}
          onSignIn={signIn}
          onOpenRepo={() => openRepo()}
          onSaveKey={(apiKey) =>
            setSettings((s) => {
              const next = { ...s, apiKey };
              saveSettings(next);
              return next;
            })
          }
          onClose={() =>
            setSettings((s) => {
              const next = { ...s, welcomed: true };
              saveSettings(next);
              return next;
            })
          }
        />
      )}
      {approval && (
        <ApprovalDialog
          tool={approval.tool}
          input={approval.input}
          onAnswer={(ok) => {
            approval.resolve(ok);
            setApproval(null);
          }}
        />
      )}
    </div>
  );
}
