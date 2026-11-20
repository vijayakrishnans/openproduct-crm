export type Selection =
  | { kind: "component"; name: string }
  | { kind: "environment"; name: string }
  | { kind: "tool"; name: string }
  | null;

export type Screen = "graph" | "agent" | "intent";

export interface LogLine {
  at: number;
  kind: "out" | "err" | "info" | "in";
  text: string;
}
