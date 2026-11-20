import type { Effort } from "./agent";

export interface Settings {
  apiKey: string;
  effort: Effort;
  autoApproveReads: boolean;
  mcpReadOnly: boolean;
  lastRepo: string;
}

const KEY = "orun-work.settings.v1";
const DEFAULTS: Settings = {
  apiKey: "",
  effort: "high",
  autoApproveReads: true,
  mcpReadOnly: false,
  lastRepo: "",
};

export function loadSettings(): Settings {
  try {
    return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<Settings>) };
  } catch {
    return DEFAULTS;
  }
}

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable: settings last for this session only */
  }
}
