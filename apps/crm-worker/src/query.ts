// Turns a list request (React-admin's shape: page, perPage, sort, order and a
// JSON filter) into SQL. Identifiers come from the resource definition; every
// value is a bound parameter. Parameter $1 is always the org.

import type { ColumnType, ResourceDef } from "./resources.js";

export const MAX_PER_PAGE = 1000;
const DEFAULT_PER_PAGE = 25;

export interface ListQuery {
  where: string;
  params: unknown[];
  orderBy: string;
  limit: number;
  offset: number;
  page: number;
  perPage: number;
}

export type ParseResult =
  | { ok: true; query: ListQuery }
  | { ok: false; fields: Record<string, string[]> };

const SCALAR_CAST: Partial<Record<ColumnType, string>> = {
  text: "text",
  bigint: "bigint",
  integer: "integer",
  boolean: "boolean",
  timestamptz: "timestamptz",
  date: "date",
};

const ARRAY_ELEMENT_CAST: Partial<Record<ColumnType, string>> = {
  "bigint[]": "bigint",
  "text[]": "text",
};

const COMPARISONS: Record<string, string> = {
  eq: "=",
  neq: "<>",
  gt: ">",
  gte: ">=",
  lt: "<",
  lte: "<=",
};

function isScalarValue(value: unknown): value is string | number | boolean {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function isScalarArray(value: unknown): value is (string | number | boolean)[] {
  return Array.isArray(value) && value.every(isScalarValue);
}

function positiveInt(raw: string | null, fallback: number): number | null {
  if (raw === null || raw === "") return fallback;
  if (!/^\d{1,7}$/.test(raw)) return null;
  const n = Number(raw);
  return n >= 1 ? n : null;
}

export function parseListQuery(def: ResourceDef, search: URLSearchParams, orgId: string): ParseResult {
  const fields: Record<string, string[]> = {};
  const params: unknown[] = [orgId];
  const clauses: string[] = ["t.org_id = $1::text::uuid"];
  const bind = (value: unknown): string => {
    params.push(value);
    return `$${params.length}`;
  };

  const page = positiveInt(search.get("page"), 1);
  const perPage = positiveInt(search.get("perPage"), DEFAULT_PER_PAGE);
  if (page === null) fields["page"] = ["must be a positive integer"];
  if (perPage === null || perPage > MAX_PER_PAGE) {
    fields["perPage"] = [`must be between 1 and ${MAX_PER_PAGE}`];
  }

  const sortField = search.get("sort") ?? def.defaultSort.field;
  const orderRaw = (search.get("order") ?? def.defaultSort.order).toUpperCase();
  const sortType = def.columns[sortField];
  if (!sortType || !(sortType in SCALAR_CAST)) fields["sort"] = ["is not a sortable field"];
  if (orderRaw !== "ASC" && orderRaw !== "DESC") fields["order"] = ["must be ASC or DESC"];

  let filter: Record<string, unknown> = {};
  const rawFilter = search.get("filter");
  if (rawFilter) {
    try {
      const parsed: unknown = JSON.parse(rawFilter);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("shape");
      filter = parsed as Record<string, unknown>;
    } catch {
      fields["filter"] = ["must be a JSON object"];
    }
  }

  for (const [key, value] of Object.entries(filter)) {
    const fail = (message: string) => {
      fields[`filter.${key}`] = [message];
    };

    if (key === "q") {
      if (typeof value !== "string") {
        fail("must be a string");
      } else if (!def.searchTable && !def.searchColumns) {
        fail("this resource cannot be searched");
      } else if (value.trim() === "") {
        // a blank search matches everything
      } else if (def.searchColumns) {
        // Small tables without a search index: every word must appear in one
        // of the columns.
        for (const word of value.trim().split(/\s+/).slice(0, 8)) {
          const p = bind(`%${word.replace(/[\\%_]/g, "\\$&")}%`);
          clauses.push(`(${def.searchColumns.map((c) => `t."${c}" ILIKE ${p}::text`).join(" OR ")})`);
        }
      } else {
        const p = bind(value);
        clauses.push(
          `t.id IN (SELECT s.id FROM ${def.searchTable} s WHERE s.org_id = $1::text::uuid AND s.fts @@ crm.search_query(${p}::text))`,
        );
      }
      continue;
    }

    const at = key.lastIndexOf("@");
    const column = at === -1 ? key : key.slice(0, at);
    const operator = at === -1 ? (Array.isArray(value) ? "in" : "eq") : key.slice(at + 1);
    const type = def.columns[column];
    if (!type) {
      fail("is not a field of this resource");
      continue;
    }
    const col = `t."${column}"`;
    const cast = SCALAR_CAST[type];

    if (operator === "is" || operator === "isnot") {
      if (value !== null) {
        fail("only null is supported");
        continue;
      }
      clauses.push(`${col} IS ${operator === "isnot" ? "NOT " : ""}NULL`);
      continue;
    }

    if (operator === "cs" || operator === "ov") {
      const element = ARRAY_ELEMENT_CAST[type];
      if (!element) {
        fail("is not an array field");
      } else if (!isScalarArray(value)) {
        fail("must be an array of values");
      } else {
        const p = bind(JSON.stringify(value));
        clauses.push(
          `${col} ${operator === "cs" ? "@>" : "&&"} ARRAY(SELECT e::${element} FROM jsonb_array_elements_text(${p}::text::jsonb) e)`,
        );
      }
      continue;
    }

    if (!cast) {
      fail("cannot be filtered");
      continue;
    }

    if (operator === "in") {
      if (!isScalarArray(value)) {
        fail("must be an array of values");
        continue;
      }
      const p = bind(JSON.stringify(value));
      clauses.push(`${col} IN (SELECT e::${cast} FROM jsonb_array_elements_text(${p}::text::jsonb) e)`);
      continue;
    }

    if (operator === "like" || operator === "ilike") {
      if (typeof value !== "string") {
        fail("must be a string");
        continue;
      }
      const p = bind(value);
      clauses.push(`${col}::text ${operator === "like" ? "LIKE" : "ILIKE"} ${p}::text`);
      continue;
    }

    const comparison = COMPARISONS[operator];
    if (!comparison) {
      fail("unknown operator");
      continue;
    }
    if (value === null && (operator === "eq" || operator === "neq")) {
      clauses.push(`${col} IS ${operator === "neq" ? "NOT " : ""}NULL`);
      continue;
    }
    if (!isScalarValue(value)) {
      fail("must be a string, number or boolean");
      continue;
    }
    const p = bind(String(value));
    clauses.push(`${col} ${comparison} ${p}::text::${cast}`);
  }

  if (Object.keys(fields).length > 0) return { ok: false, fields };

  const direction = orderRaw as "ASC" | "DESC";
  return {
    ok: true,
    query: {
      where: clauses.join(" AND "),
      params,
      orderBy: `t."${sortField}" ${direction} NULLS LAST, t.id ${direction}`,
      limit: perPage!,
      offset: (page! - 1) * perPage!,
      page: page!,
      perPage: perPage!,
    },
  };
}
