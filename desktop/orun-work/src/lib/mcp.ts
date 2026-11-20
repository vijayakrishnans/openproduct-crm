// A minimal MCP client for `orun mcp serve`: newline-delimited JSON-RPC 2.0
// over the child's stdin/stdout (the transport orun documents for `serve`).
import { spawnOrun, type Proc } from "./platform";

export interface McpTool {
  name: string;
  title?: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    title?: string;
  };
}

export interface McpContent {
  type: string;
  text?: string;
  [key: string]: unknown;
}

export interface McpCallResult {
  content: McpContent[];
  isError?: boolean;
  structuredContent?: unknown;
}

export type McpLogEntry = {
  at: number;
  dir: "out" | "in" | "err" | "info";
  text: string;
};

type Pending = {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
};

const PROTOCOL_VERSION = "2025-06-18";

export class McpClient {
  private proc: Proc | null = null;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private onLog: (entry: McpLogEntry) => void;
  serverInfo: { name?: string; version?: string } = {};
  instructions = "";
  closed = false;

  constructor(onLog: (entry: McpLogEntry) => void) {
    this.onLog = onLog;
  }

  private log(dir: McpLogEntry["dir"], text: string) {
    this.onLog({ at: Date.now(), dir, text });
  }

  async start(cwd: string | undefined, readOnly: boolean): Promise<void> {
    const args = ["mcp", "serve"];
    if (readOnly) args.push("--read-only");
    this.log("info", `$ orun ${args.join(" ")}${cwd ? `   (in ${cwd})` : ""}`);
    this.proc = await spawnOrun(args, {
      cwd,
      onStdout: (line) => this.handleLine(line),
      onStderr: (line) => line.trim() && this.log("err", line),
      onClose: (code) => {
        this.closed = true;
        this.log("info", `orun mcp serve exited (${code ?? "signal"})`);
        for (const p of this.pending.values()) p.reject(new Error("MCP server exited"));
        this.pending.clear();
      },
    });
    const init = (await this.request("initialize", {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "orun-work", version: "0.1.0" },
    })) as { serverInfo?: { name?: string; version?: string }; instructions?: string };
    this.serverInfo = init.serverInfo ?? {};
    this.instructions = init.instructions ?? "";
    await this.notify("notifications/initialized");
  }

  private handleLine(line: string) {
    const trimmed = line.trim();
    if (!trimmed) return;
    this.log("in", trimmed);
    let msg: { id?: number; result?: unknown; error?: { message: string; code?: number } };
    try {
      msg = JSON.parse(trimmed);
    } catch {
      return; // not JSON-RPC (a stray log line); already logged
    }
    if (typeof msg.id !== "number") return; // a notification from the server
    const waiting = this.pending.get(msg.id);
    if (!waiting) return;
    this.pending.delete(msg.id);
    if (msg.error) waiting.reject(new Error(`${msg.error.message} (${msg.error.code ?? "?"})`));
    else waiting.resolve(msg.result);
  }

  private async send(payload: object) {
    if (!this.proc || this.closed) throw new Error("MCP server is not running");
    const text = JSON.stringify(payload);
    this.log("out", text);
    await this.proc.write(text + "\n");
  }

  request(method: string, params?: object, timeoutMs = 120_000): Promise<unknown> {
    const id = this.nextId++;
    const promise = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`${method} timed out`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => (clearTimeout(timer), resolve(v)),
        reject: (e) => (clearTimeout(timer), reject(e)),
      });
    });
    this.send({ jsonrpc: "2.0", id, method, ...(params ? { params } : {}) }).catch((err) => {
      const waiting = this.pending.get(id);
      this.pending.delete(id);
      waiting?.reject(err as Error);
    });
    return promise;
  }

  notify(method: string, params?: object) {
    return this.send({ jsonrpc: "2.0", method, ...(params ? { params } : {}) });
  }

  async listTools(): Promise<McpTool[]> {
    const tools: McpTool[] = [];
    let cursor: string | undefined;
    do {
      const page = (await this.request("tools/list", cursor ? { cursor } : {})) as {
        tools: McpTool[];
        nextCursor?: string;
      };
      tools.push(...page.tools);
      cursor = page.nextCursor;
    } while (cursor);
    return tools;
  }

  callTool(name: string, args: Record<string, unknown>): Promise<McpCallResult> {
    return this.request("tools/call", { name, arguments: args }, 600_000) as Promise<McpCallResult>;
  }

  async stop() {
    await this.proc?.kill().catch(() => undefined);
    this.proc = null;
    this.closed = true;
  }
}

/** A tool may change something unless the server marks it read-only. */
export function isReadOnly(tool: McpTool): boolean {
  return tool.annotations?.readOnlyHint === true;
}

export function resultText(result: McpCallResult): string {
  const parts = result.content.map((c) =>
    c.type === "text" && typeof c.text === "string" ? c.text : JSON.stringify(c),
  );
  if (parts.length === 0 && result.structuredContent !== undefined) {
    parts.push(JSON.stringify(result.structuredContent, null, 2));
  }
  return parts.join("\n");
}
