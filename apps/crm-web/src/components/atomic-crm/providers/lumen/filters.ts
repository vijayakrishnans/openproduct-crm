// The UI builds list filters in the shape the upstream Supabase provider
// took: PostgREST literals such as `"tags@cs": "{3}"` or `"id@in": "(1,2)"`.
// crm-worker takes plain JSON values, so they are translated here, in one
// place, and the components stay as they are.

// Items are separated by commas outside double quotes. A quoted item may hold
// commas, parentheses and braces, with `\"` for a quote and `\\` for a
// backslash, as PostgREST reads them (and as the CSV import writes them).
export function parseList(literal: string, open: string, close: string): string[] {
  let body = literal.trim();
  if (body.startsWith(open) && body.endsWith(close)) body = body.slice(1, -1);
  if (body.trim() === "") return [];
  const items: string[] = [];
  let current = "";
  let quoted = false; // the current item started with a quote
  let inQuotes = false;
  for (let i = 0; i < body.length; i++) {
    const char = body[i]!;
    if (inQuotes) {
      if (char === "\\" && i + 1 < body.length) {
        current += body[++i];
      } else if (char === '"') {
        inQuotes = false;
      } else {
        current += char;
      }
    } else if (char === '"' && current.trim() === "") {
      current = "";
      quoted = true;
      inQuotes = true;
    } else if (char === ",") {
      items.push(quoted ? current : current.trim());
      current = "";
      quoted = false;
    } else if (!quoted) {
      current += char;
    }
  }
  items.push(quoted ? current : current.trim());
  return items;
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
