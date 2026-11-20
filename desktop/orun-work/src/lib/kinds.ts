// Groups component types into a few families for colour and legend.
export type Family = "worker" | "web" | "terraform" | "migrate" | "package" | "test" | "other";

export function family(type: string, root = ""): Family {
  const t = type.toLowerCase();
  if (root.startsWith("tests") || t.includes("test") || t.includes("playwright")) return "test";
  if (t.includes("next") || t.includes("vite") || t.includes("static") || t.includes("web")) return "web";
  if (t.includes("worker")) return "worker";
  if (t.includes("terraform") || t.includes("domain")) return "terraform";
  if (t.includes("migrat")) return "migrate";
  if (root.startsWith("packages") || t.includes("package") || t.includes("library")) return "package";
  return "other";
}

export const FAMILY_LABEL: Record<Family, string> = {
  worker: "Worker",
  web: "Web app",
  terraform: "Infrastructure",
  migrate: "Migration",
  package: "Package",
  test: "Test suite",
  other: "Other",
};

export const familyColor = (f: Family) => `var(--t-${f})`;
