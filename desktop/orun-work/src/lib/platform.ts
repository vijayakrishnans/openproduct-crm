// The one place that knows whether we run inside the Tauri shell or a plain
// browser. Inside Tauri every call goes to a native plugin (process spawn,
// HTTP without CORS, the file system, the folder picker). In a browser — `npm
// run dev` without Tauri, or a screenshot — the demo backend answers instead,
// so the editor can be looked at without orun or a key.
import * as demo from "./demo";

export const isTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export interface SpawnOptions {
  cwd?: string;
  onStdout: (line: string) => void;
  onStderr: (line: string) => void;
  onClose: (code: number | null) => void;
}

export interface Proc {
  write(data: string): Promise<void>;
  kill(): Promise<void>;
}

/**
 * Spawn orun. The app ships its own orun (a Tauri sidecar, bundled in the
 * installer), so nothing has to be installed or on PATH. It is the only
 * program the capability file allows.
 */
export async function spawnOrun(args: string[], opts: SpawnOptions): Promise<Proc> {
  if (!isTauri) return demo.spawnOrun(args, opts);
  const { Command } = await import("@tauri-apps/plugin-shell");
  const command = Command.sidecar("binaries/orun", args, {
    ...(opts.cwd ? { cwd: opts.cwd } : {}),
    env: { ORUN_NO_COLOR: "1", NO_COLOR: "1" },
  });
  command.stdout.on("data", (line: string) => opts.onStdout(line.replace(/\r?\n$/, "")));
  command.stderr.on("data", (line: string) => opts.onStderr(line.replace(/\r?\n$/, "")));
  command.on("close", (payload: { code: number | null }) => opts.onClose(payload.code));
  command.on("error", (err: string) => {
    opts.onStderr(String(err));
    opts.onClose(-1);
  });
  const child = await command.spawn();
  return {
    write: (data) => child.write(data),
    kill: () => child.kill(),
  };
}

/** fetch that is not subject to the webview's CORS rules inside Tauri. */
export async function nativeFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  if (!isTauri) return fetch(input, init);
  const { fetch: tauriFetch } = await import("@tauri-apps/plugin-http");
  return tauriFetch(input, init);
}

export interface DirEntry {
  name: string;
  isDirectory: boolean;
}

export async function readDir(path: string): Promise<DirEntry[]> {
  if (!isTauri) return demo.readDir(path);
  const fs = await import("@tauri-apps/plugin-fs");
  const entries = await fs.readDir(path);
  return entries.map((e) => ({ name: e.name, isDirectory: e.isDirectory }));
}

export async function readTextFile(path: string): Promise<string> {
  if (!isTauri) return demo.readTextFile(path);
  const fs = await import("@tauri-apps/plugin-fs");
  return fs.readTextFile(path);
}

export async function exists(path: string): Promise<boolean> {
  if (!isTauri) return demo.exists(path);
  const fs = await import("@tauri-apps/plugin-fs");
  return fs.exists(path);
}

export async function pickFolder(): Promise<string | null> {
  if (!isTauri) return demo.DEMO_ROOT;
  const { open } = await import("@tauri-apps/plugin-dialog");
  const picked = await open({ directory: true, multiple: false, title: "Open an orun repository" });
  return typeof picked === "string" ? picked : null;
}

/** ANTHROPIC_API_KEY from the environment the app was started in, if any. */
export async function apiKeyFromEnv(): Promise<string | null> {
  if (!isTauri) return null;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<string | null>("anthropic_key_from_env");
}

export function joinPath(...parts: string[]): string {
  return parts
    .filter(Boolean)
    .map((p, i) => (i === 0 ? p.replace(/[\\/]+$/, "") : p.replace(/^[\\/]+|[\\/]+$/g, "")))
    .join("/");
}

/** Open a web address in the system browser. */
export async function openUrl(url: string): Promise<void> {
  if (!/^https?:\/\//.test(url)) return;
  if (!isTauri) {
    window.open(url, "_blank", "noopener");
    return;
  }
  const { open } = await import("@tauri-apps/plugin-shell");
  await open(url);
}
