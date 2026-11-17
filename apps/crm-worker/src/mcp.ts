// A Model Context Protocol server for one organization's CRM, at
// POST /v1/organizations/:orgId/crm/mcp (Streamable HTTP, stateless, JSON
// responses). An assistant connects with a Lumen API key of that organization
// as its bearer token; the edge resolves it to a service principal and this
// worker authorizes it like any member.
//
// Every tool is typed and maps onto the same handlers as the REST routes, so
// a tool call passes the same four tenancy checks. There is no free-form SQL,
// and no tool deletes anything.
import {
  handleCreate,
  handleDashboard,
  handleGet,
  handleList,
  handleSearch,
  handleUpdate,
  type Ctx,
} from "./handlers.js";
import { RESOURCES, SEARCH_RESOURCES, type ResourceDef } from "./resources.js";

const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const SERVER_INFO = { name: "openproduct-crm", title: "OpenProduct CRM", version: "1.0.0" };

type Json = Record<string, unknown>;
type JsonSchema = Json;

interface ToolDef {
  name: string;
  title: string;
  description: string;
  /** Tools that change data need organization.crm.write. */
  writes: boolean;
  inputSchema: JsonSchema;
  run(ctx: Ctx, args: Json): Promise<Response>;
}

const LISTABLE = [
  "contacts",
  "companies",
  "deals",
  "tasks",
  "contact_notes",
  "deal_notes",
  "tags",
  "sales",
  "activity_log",
] as const;
const GETTABLE = ["contacts", "companies", "deals", "tasks", "contact_notes", "deal_notes", "tags", "sales"] as const;

// Contacts and companies are read through the summary views, which add the
// computed columns (company name, open task count, deal and contact counts).
const READ_ALIAS: Record<string, string> = { contacts: "contacts_summary", companies: "companies_summary" };

const def = (name: string): ResourceDef => RESOURCES.get(READ_ALIAS[name] ?? name)!;
const table = (name: string): ResourceDef => RESOURCES.get(name)!;

const id = { type: "integer", minimum: 1 } as const;
const text = { type: "string" } as const;
const dateTime = { type: "string", description: "ISO 8601 date and time" } as const;

function object(properties: Json, required: string[] = []): JsonSchema {
  return { type: "object", properties, required, additionalProperties: false };
}

const CONTACT_FIELDS = {
  first_name: text,
  last_name: text,
  title: text,
  company_id: id,
  background: text,
  gender: text,
  status: { type: "string", description: "A note status of the CRM, e.g. cold, warm, hot, in-contract" },
  linkedin_url: text,
  has_newsletter: { type: "boolean" },
  tags: { type: "array", items: id, description: "Ids of tags (see list with resource tags)" },
  email_jsonb: {
    type: "array",
    description: "Email addresses",
    items: object({ email: text, type: { type: "string", enum: ["Work", "Home", "Other"] } }, ["email"]),
  },
  phone_jsonb: {
    type: "array",
    description: "Phone numbers",
    items: object({ number: text, type: { type: "string", enum: ["Work", "Home", "Other"] } }, ["number"]),
  },
};

const COMPANY_FIELDS = {
  name: text,
  sector: text,
  size: { type: "integer", description: "Number of employees bucket: 1, 10, 50, 250 or 500" },
  website: text,
  linkedin_url: text,
  phone_number: text,
  address: text,
  zipcode: text,
  city: text,
  state_abbr: text,
  country: text,
  description: text,
  revenue: text,
  tax_identifier: text,
};

const DEAL_FIELDS = {
  name: text,
  company_id: id,
  contact_ids: { type: "array", items: id },
  categories: { type: "array", items: text },
  stage: { type: "string", description: "A deal stage of the CRM, e.g. opportunity, proposal-sent, won, lost" },
  description: text,
  amount: { type: "integer" },
  expected_closing_date: { type: "string", description: "YYYY-MM-DD" },
  archived_at: { type: ["string", "null"], description: "Set to archive the deal, null to unarchive" },
};

function query(args: Json, keys: string[]): URLSearchParams {
  const params = new URLSearchParams();
  for (const key of keys) {
    const value = args[key];
    if (value === undefined || value === null) continue;
    params.set(key, typeof value === "object" ? JSON.stringify(value) : String(value));
  }
  return params;
}

function without(args: Json, ...keys: string[]): Json {
  return Object.fromEntries(Object.entries(args).filter(([key]) => !keys.includes(key)));
}

export const TOOLS: ToolDef[] = [
  {
    name: "search",
    title: "Search the CRM",
    description:
      "Full-text search across companies, contacts, deals, open tasks and notes of this organization. Every word must match, as a prefix, ignoring accents. Returns up to `limit` results per resource.",
    writes: false,
    inputSchema: object(
      {
        query: text,
        resources: { type: "array", items: { type: "string", enum: [...SEARCH_RESOURCES] } },
        limit: { type: "integer", minimum: 1, maximum: 200 },
      },
      ["query"],
    ),
    run: (ctx, args) => {
      const params = query(args, ["limit"]);
      params.set("q", String(args["query"]));
      if (Array.isArray(args["resources"])) params.set("resources", args["resources"].join(","));
      return handleSearch(ctx, params);
    },
  },
  {
    name: "list",
    title: "List records",
    description:
      "List records of one resource, with pagination, sorting and filters. `filter` is an object: a field name means equals; `field@gte`, `@lte`, `@gt`, `@lt`, `@neq`, `@ilike` (SQL pattern), `@in` (array), `@is` / `@isnot` (null) and `@cs` (array contains, for contacts.tags and deals.contact_ids) are also accepted; `q` searches the resource's text.",
    writes: false,
    inputSchema: object(
      {
        resource: { type: "string", enum: [...LISTABLE] },
        filter: { type: "object" },
        sort: text,
        order: { type: "string", enum: ["ASC", "DESC"] },
        page: { type: "integer", minimum: 1 },
        perPage: { type: "integer", minimum: 1, maximum: 100 },
      },
      ["resource"],
    ),
    run: (ctx, args) => handleList(ctx, def(String(args["resource"])), query(args, ["filter", "sort", "order", "page", "perPage"])),
  },
  {
    name: "get",
    title: "Get one record",
    description: "Read one record by id.",
    writes: false,
    inputSchema: object({ resource: { type: "string", enum: [...GETTABLE] }, id }, ["resource", "id"]),
    run: (ctx, args) => handleGet(ctx, def(String(args["resource"])), String(args["id"])),
  },
  {
    name: "dashboard",
    title: "Summarize the CRM",
    description: "Counts of companies, contacts, notes and tasks (open, overdue), and open deals with totals per stage.",
    writes: false,
    inputSchema: object({}),
    run: (ctx) => handleDashboard(ctx),
  },
  {
    name: "create_contact",
    title: "Create a contact",
    description: "Create a contact. It is owned by the API key's profile unless the CRM assigns one.",
    writes: true,
    inputSchema: object(CONTACT_FIELDS),
    run: (ctx, args) => {
      const now = new Date().toISOString();
      return handleCreate(ctx, table("contacts"), { first_seen: now, last_seen: now, tags: [], ...args });
    },
  },
  {
    name: "update_contact",
    title: "Update a contact",
    description: "Change the given fields of a contact; fields left out are kept.",
    writes: true,
    inputSchema: object({ id, ...CONTACT_FIELDS }, ["id"]),
    run: (ctx, args) => handleUpdate(ctx, table("contacts"), String(args["id"]), without(args, "id")),
  },
  {
    name: "create_company",
    title: "Create a company",
    description: "Create a company.",
    writes: true,
    inputSchema: object(COMPANY_FIELDS, ["name"]),
    run: (ctx, args) => handleCreate(ctx, table("companies"), args),
  },
  {
    name: "update_company",
    title: "Update a company",
    description: "Change the given fields of a company; fields left out are kept.",
    writes: true,
    inputSchema: object({ id, ...COMPANY_FIELDS }, ["id"]),
    run: (ctx, args) => handleUpdate(ctx, table("companies"), String(args["id"]), without(args, "id")),
  },
  {
    name: "create_deal",
    title: "Create a deal",
    description: "Create a deal in a stage of the pipeline.",
    writes: true,
    inputSchema: object(DEAL_FIELDS, ["name", "stage"]),
    run: (ctx, args) => handleCreate(ctx, table("deals"), args),
  },
  {
    name: "update_deal",
    title: "Update a deal",
    description: "Change the given fields of a deal, for example its stage; fields left out are kept.",
    writes: true,
    inputSchema: object({ id, ...DEAL_FIELDS }, ["id"]),
    run: (ctx, args) => handleUpdate(ctx, table("deals"), String(args["id"]), without(args, "id")),
  },
  {
    name: "add_note",
    title: "Add a note",
    description: "Add a note to a contact or to a deal (give exactly one of contact_id and deal_id).",
    writes: true,
    inputSchema: object({ contact_id: id, deal_id: id, text, status: text, date: dateTime }, ["text"]),
    run: async (ctx, args) => {
      const onContact = args["contact_id"] !== undefined;
      if (onContact === (args["deal_id"] !== undefined)) {
        return Response.json(
          { error: { code: "validation_failed", message: "Give exactly one of contact_id and deal_id" } },
          { status: 422 },
        );
      }
      return onContact
        ? handleCreate(ctx, table("contact_notes"), without(args, "deal_id"))
        : handleCreate(ctx, table("deal_notes"), without(args, "contact_id", "status"));
    },
  },
  {
    name: "create_task",
    title: "Create a task",
    description: "Create a task on a contact.",
    writes: true,
    inputSchema: object({ contact_id: id, text, type: text, due_date: dateTime }, ["contact_id", "text"]),
    run: (ctx, args) => handleCreate(ctx, table("tasks"), args),
  },
  {
    name: "complete_task",
    title: "Complete or reopen a task",
    description: "Mark a task done (now), or reopen it with done false.",
    writes: true,
    inputSchema: object({ id, done: { type: "boolean" } }, ["id"]),
    run: (ctx, args) =>
      handleUpdate(ctx, table("tasks"), String(args["id"]), {
        done_date: args["done"] === false ? null : new Date().toISOString(),
      }),
  },
];

const TOOLS_BY_NAME = new Map(TOOLS.map((tool) => [tool.name, tool]));

// --- a small JSON Schema check: enough for the schemas above ----------------

function typeOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "number";
  return typeof value;
}

export function schemaError(schema: JsonSchema, value: unknown, path = "arguments"): string | null {
  const allowed = schema["type"] === undefined ? null : ([] as unknown[]).concat(schema["type"]);
  const actual = typeOf(value);
  if (allowed && !allowed.includes(actual) && !(actual === "integer" && allowed.includes("number"))) {
    return `${path} must be ${allowed.join(" or ")}`;
  }
  if (Array.isArray(schema["enum"]) && !schema["enum"].includes(value)) {
    return `${path} must be one of ${schema["enum"].join(", ")}`;
  }
  if (typeof value === "number") {
    if (typeof schema["minimum"] === "number" && value < schema["minimum"]) return `${path} must be at least ${schema["minimum"]}`;
    if (typeof schema["maximum"] === "number" && value > schema["maximum"]) return `${path} must be at most ${schema["maximum"]}`;
  }
  if (actual === "array" && schema["items"]) {
    for (const [i, item] of (value as unknown[]).entries()) {
      const problem = schemaError(schema["items"] as JsonSchema, item, `${path}[${i}]`);
      if (problem) return problem;
    }
  }
  if (actual === "object" && schema["properties"]) {
    const properties = schema["properties"] as Record<string, JsonSchema>;
    for (const key of (schema["required"] as string[] | undefined) ?? []) {
      if ((value as Json)[key] === undefined) return `${path}.${key} is required`;
    }
    for (const [key, item] of Object.entries(value as Json)) {
      if (!properties[key]) {
        if (schema["additionalProperties"] === false) return `${path}.${key} is not a known field`;
        continue;
      }
      const problem = schemaError(properties[key], item, `${path}.${key}`);
      if (problem) return problem;
    }
  }
  return null;
}

// --- JSON-RPC ---------------------------------------------------------------

export interface McpDeps {
  /** Runs `work` in the organization's transaction; a non-2xx rolls it back. */
  transact(work: (ctx: Ctx) => Promise<Response>): Promise<Response>;
  /** Whether the caller holds organization.crm.write. */
  canWrite(): Promise<boolean>;
}

const rpcResult = (rpcId: unknown, result: unknown) => Response.json({ jsonrpc: "2.0", id: rpcId, result });
const rpcError = (rpcId: unknown, code: number, message: string, status = 200) =>
  Response.json({ jsonrpc: "2.0", id: rpcId ?? null, error: { code, message } }, { status });

function toolResult(rpcId: unknown, payload: unknown, isError: boolean): Response {
  return rpcResult(rpcId, {
    content: [{ type: "text", text: JSON.stringify(payload) }],
    ...(isError ? {} : { structuredContent: payload }),
    isError,
  });
}

export async function handleMcp(request: Request, deps: McpDeps): Promise<Response> {
  let message: unknown;
  try {
    message = await request.json();
  } catch {
    return rpcError(null, -32700, "Parse error", 400);
  }
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    return rpcError(null, -32600, "Invalid Request: one JSON-RPC message per request", 400);
  }
  const { id: rpcId, method, params } = message as { id?: unknown; method?: unknown; params?: Json };
  if ((message as Json)["jsonrpc"] !== "2.0" || typeof method !== "string") {
    return rpcError(rpcId, -32600, "Invalid Request", 400);
  }

  // Notifications (no id) get no reply.
  if (rpcId === undefined) return new Response(null, { status: 202 });

  switch (method) {
    case "initialize": {
      const requested = typeof params?.["protocolVersion"] === "string" ? params["protocolVersion"] : "";
      return rpcResult(rpcId, {
        protocolVersion: PROTOCOL_VERSIONS.includes(requested) ? requested : PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions:
          "Tools read and write the CRM of one organization: the one this API key belongs to. Ids are integers. Use `search` to find records by words, `list` with a filter for exact conditions.",
      });
    }
    case "ping":
      return rpcResult(rpcId, {});
    case "tools/list":
      return rpcResult(rpcId, {
        tools: TOOLS.map(({ name, title, description, inputSchema, writes }) => ({
          name,
          title,
          description,
          inputSchema,
          annotations: { readOnlyHint: !writes, destructiveHint: false, openWorldHint: false },
        })),
      });
    case "tools/call": {
      const tool = typeof params?.["name"] === "string" ? TOOLS_BY_NAME.get(params["name"]) : undefined;
      if (!tool) return rpcError(rpcId, -32602, "Unknown tool");
      const args = (params?.["arguments"] ?? {}) as Json;
      const invalid = schemaError(tool.inputSchema, args);
      if (invalid) return toolResult(rpcId, { error: { code: "validation_failed", message: invalid } }, true);
      if (tool.writes && !(await deps.canWrite())) {
        return toolResult(rpcId, { error: { code: "forbidden", message: "This API key may only read the CRM" } }, true);
      }

      const response = await deps.transact((ctx) => tool.run(ctx, args));
      const body = (await response.json().catch(() => ({}))) as Json;
      return response.ok
        ? toolResult(rpcId, body["data"] ?? {}, false)
        : toolResult(rpcId, { error: body["error"] ?? { code: "error", message: "The request failed" } }, true);
    }
    default:
      return rpcError(rpcId, -32601, `Method not found: ${method}`);
  }
}
