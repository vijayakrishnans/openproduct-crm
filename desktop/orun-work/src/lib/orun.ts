// Running orun CLI commands with their output streamed line by line.
import { spawnOrun, type Proc } from "./platform";

export interface RunHandle {
  done: Promise<number | null>;
  stop: () => Promise<void>;
}

export function runOrun(
  args: string[],
  cwd: string | undefined,
  onLine: (line: string, stream: "out" | "err") => void,
): RunHandle {
  let proc: Proc | null = null;
  let stopped = false;
  const done = new Promise<number | null>((resolve) => {
    spawnOrun(args, {
      cwd,
      onStdout: (l) => onLine(l, "out"),
      onStderr: (l) => onLine(l, "err"),
      onClose: resolve,
    })
      .then((p) => {
        proc = p;
        if (stopped) void p.kill();
      })
      .catch((err) => {
        onLine(`could not start orun: ${String(err)}`, "err");
        onLine("Install orun and make sure it is on PATH: https://orun.dev/docs/start/installation/", "err");
        resolve(-1);
      });
  });
  return {
    done,
    stop: async () => {
      stopped = true;
      await proc?.kill();
    },
  };
}

// Subcommands (first one or two words) that only read. Anything else is a
// change and goes through the approval prompt when the agent asks for it.
const READ_ONLY = [
  "version", "validate", "plan", "status", "logs", "describe", "get",
  "catalog", "objects", "debug", "intent", "component", "compositions",
  "workspace", "cloud check", "integrations list", "secrets list",
  "baseline list", "baseline check", "mcp tools", "mcp doctor", "auth status",
  "skills list", "task list", "spec list", "policy list",
];

export function isReadOnlyCommand(args: string[]): boolean {
  const words = args.filter((a) => !a.startsWith("-"));
  const one = words[0] ?? "";
  const two = words.slice(0, 2).join(" ");
  if (args.includes("--apply") || args.includes("--push-catalog")) return false;
  if (one === "workspace" && ["create", "delete", "use"].includes(words[1] ?? "")) return false;
  if (one === "component" && ["delete", "set"].includes(words[1] ?? "")) return false;
  return READ_ONLY.includes(two) || READ_ONLY.includes(one);
}

/** Split a command line the way a shell would, for the console prompt. */
export function splitArgs(line: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) out.push(m[1] ?? m[2] ?? m[3]);
  if (out[0] === "orun") out.shift();
  return out;
}
