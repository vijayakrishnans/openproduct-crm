// The UI builds list filters in the shape the upstream Supabase provider
// took: PostgREST literals such as `"tags@cs": "{3}"` or `"id@in": "(1,2)"`.
// crm-worker takes plain JSON values, so they are translated here, in one
// place, and the components stay as they are.

function parseList(literal: string, open: string, close: string): string[] {
  let body = literal.trim();
  if (body.startsWith(open) && body.endsWith(close)) body = body.slice(1, -1);
  if (body.trim() === "") return [];
  return body.split(",").map((item) => {
    const trimmed = item.trim();
    return trimmed.startsWith('"') && trimmed.endsWith('"')
      ? trimmed.slice(1, -1).replace(/\\"/g, '"')
      : trimmed;
  });
}

function toArray(value: unknown, open: string, close: string): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") return parseList(value, open, close);
  return value === undefined || value === null ? [] : [value];
}

export function translateFilter(filter: Record<string, unknown> = {}): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(filter)) {
    if (value === undefined) continue;

    if (key === "q") {
      if (typeof value === "string" && value.trim() !== "") out["q"] = value;
      continue;
    }
    // The server searches every indexed field for `q`; the column-by-column
    // alternatives upstream sent are not needed.
    if (key === "@or") continue;

    const at = key.lastIndexOf("@");
    if (at === -1) {
      if (value === "" ) continue;
      out[key] = value;
      continue;
    }

    const field = key.slice(0, at);
    const operator = key.slice(at + 1);
    switch (operator) {
      case "in":
        out[`${field}@in`] = toArray(value, "(", ")");
        break;
      case "cs":
        out[`${field}@cs`] = toArray(value, "{", "}");
        break;
      case "ov":
        out[`${field}@ov`] = toArray(value, "{", "}");
        break;
      case "not.is":
        out[`${field}@isnot`] = null;
        break;
      case "is":
        out[`${field}@is`] = null;
        break;
      default:
        out[key] = value;
    }
  }
  return out;
}
