// The Orun Work agent: a Claude tool loop whose tools are the orun MCP
// server's roster plus one local tool that runs the orun CLI. It runs on the
// user's machine because its tools do: `orun mcp serve` is a local stdio
// process holding the user's orun login.
import Anthropic from "@anthropic-ai/sdk";
import { isReadOnly, resultText, type McpClient, type McpTool } from "./mcp";
import { isReadOnlyCommand, runOrun } from "./orun";
import { nativeFetch } from "./platform";

export const MODEL = "claude-opus-5-5";

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export type AgentEvent =
  | { type: "text"; delta: string }
  | { type: "thinking"; delta: string }
  | { type: "tool_start"; id: string; name: string; input: unknown; readOnly: boolean }
  | { type: "tool_end"; id: string; output: string; isError: boolean }
  | { type: "fallback"; from: string; to: string }
  | { type: "usage"; input: number; output: number; cacheRead: number }
  | { type: "done"; stopReason: string | null };

export type Approver = (tool: string, input: unknown) => Promise<boolean>;

export interface AgentContext {
  apiKey: string;
  mcp: McpClient | null;
  mcpTools: McpTool[];
  repoRoot?: string;
  effort: Effort;
  autoApproveReads: boolean;
  approve: Approver;
  onEvent: (e: AgentEvent) => void;
  signal: AbortSignal;
}

// Frozen so the prompt cache prefix (tools -> system) stays byte-identical.
const SYSTEM = `You are Orun Work, an operator for Orunbase and orun repositories, running in a desktop editor on the user's machine.

What you work with:
- orun: a desired-state CLI. intent.yaml declares environments and discovery roots; every directory with a component.yaml is a component; \`orun plan\` compiles a deterministic plan and \`orun run\` executes it. Merging to the default branch is usually what deploys.
- Orunbase: the hosted control plane (workspaces ws_..., projects, environments, secrets by name, integrations, runs and logs, catalog, audit, usage, billing). You reach it through the orun MCP tools, which act as the signed-in user.
- The orun_cli tool runs an orun command in the open repository and returns its output.

How to work:
- Prefer MCP tools for Orunbase data; use orun_cli for repository-local work (validate, plan, describe, status) or when no MCP tool covers the job.
- Before a change (create, set, invite, run, apply, replay), say in one line what you are about to do and why. The editor asks the user to approve each change; if they decline, do not retry it another way.
- Never print a secret's value. Secrets are referred to by name only.
- A green run is not proof a deploy converged: check health URLs or the published state when that matters.
- Keep answers short and concrete: what you found, what you changed, what remains.`;

const CLI_TOOL: Anthropic.Beta.BetaTool = {
  name: "orun_cli",
  description:
    "Run the orun CLI in the open repository and return its combined output and exit code. " +
    "Pass arguments without the leading 'orun', one per array element, e.g. [\"plan\", \"--changed\", \"--intent\", \"intent.yaml\"]. " +
    "Read-only commands (validate, plan, status, describe, get, catalog, secrets list, workspace, ...) run directly; anything else needs the user's approval.",
  input_schema: {
    type: "object",
    properties: {
      args: { type: "array", items: { type: "string" }, description: "Arguments after 'orun'." },
    },
    required: ["args"],
  },
};

const NAME_OK = /^[a-zA-Z0-9_-]{1,128}$/;

function apiName(mcpName: string): string {
  return NAME_OK.test(mcpName) ? mcpName : mcpName.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 128);
}

export function buildTools(mcpTools: McpTool[]) {
  const byApiName = new Map<string, McpTool>();
  const tools: Anthropic.Beta.BetaTool[] = [];
  // Deterministic order keeps the cached prefix stable between turns.
  for (const t of [...mcpTools].sort((a, b) => a.name.localeCompare(b.name))) {
    const name = apiName(t.name);
    if (name === CLI_TOOL.name || byApiName.has(name)) continue;
    byApiName.set(name, t);
    const schema = t.inputSchema && typeof t.inputSchema === "object" ? t.inputSchema : {};
    tools.push({
      name,
      description: (t.description ?? t.title ?? t.name).slice(0, 4000),
      input_schema: { ...schema, type: "object" } as Anthropic.Beta.BetaTool.InputSchema,
    });
  }
  tools.push(CLI_TOOL);
  return { tools, byApiName };
}

async function runCliTool(args: string[], cwd: string | undefined, signal: AbortSignal) {
  const lines: string[] = [];
  const handle = runOrun(args, cwd, (line, stream) => lines.push(stream === "err" ? `[stderr] ${line}` : line));
  const onAbort = () => void handle.stop();
  signal.addEventListener("abort", onAbort, { once: true });
  const code = await handle.done;
  signal.removeEventListener("abort", onAbort);
  let out = lines.join("\n");
  if (out.length > 60_000) out = out.slice(0, 20_000) + "\n…[output trimmed]…\n" + out.slice(-38_000);
  return { text: `$ orun ${args.join(" ")}\nexit ${code}\n${out}`, isError: code !== 0 };
}

export function makeClient(apiKey: string) {
  return new Anthropic({
    apiKey,
    dangerouslyAllowBrowser: true, // a desktop app: the key is the user's own, kept on their machine
    fetch: nativeFetch as typeof fetch,
  });
}

/**
 * Runs one user turn to completion: streams Claude's reply, executes the tool
 * calls it makes, and loops until Claude ends the turn. `messages` is the
 * conversation and is appended to in place.
 */
export async function runTurn(messages: Anthropic.Beta.BetaMessageParam[], ctx: AgentContext) {
  const client = makeClient(ctx.apiKey);
  const { tools, byApiName } = buildTools(ctx.mcpTools);
  let connectionRetries = 0;

  while (!ctx.signal.aborted) {
    const stream = client.beta.messages.stream(
      {
        model: MODEL,
        max_tokens: 64000,
        thinking: { type: "adaptive", display: "summarized" },
        output_config: { effort: ctx.effort },
        // Opt-in server-side fallback: if Opus 5.5 declines, the API re-runs
        // the request on a fallback model chosen by refusal category.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        cache_control: { type: "ephemeral" },
        system: SYSTEM,
        tools,
        messages,
      },
      { signal: ctx.signal },
    );
    stream.on("text", (delta) => ctx.onEvent({ type: "text", delta }));
    stream.on("thinking", (delta) => ctx.onEvent({ type: "thinking", delta }));

    let message: Anthropic.Beta.BetaMessage;
    try {
      message = await stream.finalMessage();
      connectionRetries = 0;
    } catch (err) {
      if (ctx.signal.aborted) return;
      // API errors (auth, rate limit, bad request) surface to the user; a
      // dropped connection mid-stream is retried a couple of times.
      if (err instanceof Anthropic.APIError || connectionRetries++ >= 2) throw err;
      continue;
    }

    for (const block of message.content) {
      if (block.type === "fallback") {
        ctx.onEvent({ type: "fallback", from: block.from.model, to: block.to.model });
      }
    }
    ctx.onEvent({
      type: "usage",
      input: message.usage.input_tokens,
      output: message.usage.output_tokens,
      cacheRead: message.usage.cache_read_input_tokens ?? 0,
    });

    // Keep the full content (thinking and fallback blocks included).
    messages.push({ role: "assistant", content: message.content });

    if (message.stop_reason === "pause_turn") continue;
    const toolUses = message.content.filter(
      (b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use",
    );
    if (
      message.stop_reason !== "tool_use" ||
      toolUses.length === 0 // end_turn, refusal, max_tokens, stop_sequence
    ) {
      ctx.onEvent({ type: "done", stopReason: message.stop_reason });
      return;
    }

    // Every tool_use gets a result, all of them in one user message. They run
    // one at a time so approval prompts never stack up.
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const use of toolUses) {
      results.push(await (async (): Promise<Anthropic.Beta.BetaToolResultBlockParam> => {
        const input = (use.input ?? {}) as Record<string, unknown>;
        let readOnly: boolean;
        let run: () => Promise<{ text: string; isError: boolean }>;

        if (use.name === CLI_TOOL.name) {
          const args = input.args;
          if (!Array.isArray(args) || !args.every((a) => typeof a === "string")) {
            return { type: "tool_result", tool_use_id: use.id, is_error: true, content: "args must be an array of strings" };
          }
          readOnly = isReadOnlyCommand(args);
          run = () => runCliTool(args, ctx.repoRoot, ctx.signal);
        } else {
          const tool = byApiName.get(use.name);
          if (!tool || !ctx.mcp) {
            return { type: "tool_result", tool_use_id: use.id, is_error: true, content: `unknown tool ${use.name}` };
          }
          readOnly = isReadOnly(tool);
          run = async () => {
            const r = await ctx.mcp!.callTool(tool.name, input);
            return { text: resultText(r), isError: r.isError === true };
          };
        }

        ctx.onEvent({ type: "tool_start", id: use.id, name: use.name, input, readOnly });
        const allowed = readOnly && ctx.autoApproveReads ? true : await ctx.approve(use.name, input);
        if (!allowed) {
          const text = "The user declined this action. Do not retry it another way; ask what they want instead.";
          ctx.onEvent({ type: "tool_end", id: use.id, output: "declined", isError: true });
          return { type: "tool_result", tool_use_id: use.id, is_error: true, content: text };
        }
        try {
          const out = await run();
          ctx.onEvent({ type: "tool_end", id: use.id, output: out.text, isError: out.isError });
          return { type: "tool_result", tool_use_id: use.id, is_error: out.isError, content: out.text || "(no output)" };
        } catch (err) {
          const text = err instanceof Error ? err.message : String(err);
          ctx.onEvent({ type: "tool_end", id: use.id, output: text, isError: true });
          return { type: "tool_result", tool_use_id: use.id, is_error: true, content: text };
        }
      })());
    }
    messages.push({ role: "user", content: results });
  }
}

/** The first user message carries the editor's context ahead of the request. */
export function contextPreamble(repo: { root: string; name: string; workspace?: string; components: { name: string; type: string }[]; environments: { name: string }[] } | null) {
  if (!repo) return "No repository is open in the editor.";
  return [
    `Open repository: ${repo.name} at ${repo.root}`,
    repo.workspace ? `Orunbase workspace (intent.yaml): ${repo.workspace}` : "",
    `Environments: ${repo.environments.map((e) => e.name).join(", ") || "none"}`,
    `Components (${repo.components.length}): ${repo.components.map((c) => `${c.name} [${c.type}]`).join(", ")}`,
  ]
    .filter(Boolean)
    .join("\n");
}
