// The CRM's resources: which relation each one reads, which columns exist and
// which a client may write. Every identifier that reaches SQL comes from this
// file, never from a request.

export type ColumnType =
  | "text"
  | "bigint"
  | "integer"
  | "boolean"
  | "timestamptz"
  | "date"
  | "json"
  | "bigint[]"
  | "text[]"
  | "jsonb[]";

export interface ResourceDef {
  /** Name in the URL: /crm/<name>. */
  name: string;
  /** Relation read by list and get. */
  relation: string;
  /** Table written by create, update and delete; absent for read-only resources. */
  table?: string;
  /** Table whose fts column answers the `q` filter. */
  searchTable?: string;
  /** Without a search index: columns the `q` filter matches by substring. */
  searchColumns?: readonly string[];
  columns: Record<string, ColumnType>;
  /** Columns a client may set. */
  writable: readonly string[];
  /** Columns a create must carry. */
  required: readonly string[];
  /** Set to now() on every update. */
  touchOnUpdate?: string;
  /** Type of the id column; activity_log ids are text. */
  idType: "bigint" | "text";
  defaultSort: { field: string; order: "ASC" | "DESC" };
  /** Which methods the router offers. */
  can: { get: boolean; create: boolean; update: boolean; delete: boolean };
}

const ALL = { get: true, create: true, update: true, delete: true } as const;
const READ_ONLY = { get: true, create: false, update: false, delete: false } as const;

const COMPANY_COLUMNS = {
  id: "bigint",
  created_at: "timestamptz",
  name: "text",
  sector: "text",
  size: "integer",
  linkedin_url: "text",
  website: "text",
  phone_number: "text",
  address: "text",
  zipcode: "text",
  city: "text",
  state_abbr: "text",
  sales_id: "bigint",
  context_links: "json",
  country: "text",
  description: "text",
  revenue: "text",
  tax_identifier: "text",
  logo: "json",
} as const satisfies Record<string, ColumnType>;

const CONTACT_COLUMNS = {
  id: "bigint",
  first_name: "text",
  last_name: "text",
  gender: "text",
  title: "text",
  background: "text",
  avatar: "json",
  first_seen: "timestamptz",
  last_seen: "timestamptz",
  has_newsletter: "boolean",
  status: "text",
  tags: "bigint[]",
  company_id: "bigint",
  sales_id: "bigint",
  linkedin_url: "text",
  email_jsonb: "json",
  phone_jsonb: "json",
} as const satisfies Record<string, ColumnType>;

function without(columns: Record<string, ColumnType>, ...names: string[]): string[] {
  return Object.keys(columns).filter((c) => !names.includes(c));
}

const DEFS: ResourceDef[] = [
  {
    name: "companies",
    relation: "crm.companies",
    table: "crm.companies",
    searchTable: "crm.companies",
    columns: COMPANY_COLUMNS,
    writable: without(COMPANY_COLUMNS, "id"),
    required: ["name"],
    idType: "bigint",
    defaultSort: { field: "name", order: "ASC" },
    can: ALL,
  },
  {
    name: "companies_summary",
    relation: "crm.companies_summary",
    searchTable: "crm.companies",
    columns: { ...COMPANY_COLUMNS, nb_deals: "bigint", nb_contacts: "bigint" },
    writable: [],
    required: [],
    idType: "bigint",
    defaultSort: { field: "name", order: "ASC" },
    can: READ_ONLY,
  },
  {
    name: "contacts",
    relation: "crm.contacts",
    table: "crm.contacts",
    searchTable: "crm.contacts",
    columns: CONTACT_COLUMNS,
    writable: without(CONTACT_COLUMNS, "id"),
    required: [],
    idType: "bigint",
    defaultSort: { field: "last_seen", order: "DESC" },
    can: ALL,
  },
  {
    name: "contacts_summary",
    relation: "crm.contacts_summary",
    searchTable: "crm.contacts",
    columns: {
      ...CONTACT_COLUMNS,
      email_fts: "text",
      phone_fts: "text",
      company_name: "text",
      nb_tasks: "bigint",
    },
    writable: [],
    required: [],
    idType: "bigint",
    defaultSort: { field: "last_seen", order: "DESC" },
    can: READ_ONLY,
  },
  {
    name: "contact_notes",
    relation: "crm.contact_notes",
    table: "crm.contact_notes",
    searchTable: "crm.contact_notes",
    columns: {
      id: "bigint",
      contact_id: "bigint",
      text: "text",
      date: "timestamptz",
      sales_id: "bigint",
      status: "text",
      attachments: "jsonb[]",
    },
    writable: ["contact_id", "text", "date", "sales_id", "status", "attachments"],
    required: ["contact_id"],
    idType: "bigint",
    defaultSort: { field: "date", order: "DESC" },
    can: ALL,
  },
  {
    name: "deals",
    relation: "crm.deals",
    table: "crm.deals",
    searchTable: "crm.deals",
    columns: {
      id: "bigint",
      name: "text",
      company_id: "bigint",
      contact_ids: "bigint[]",
      categories: "text[]",
      stage: "text",
      description: "text",
      amount: "bigint",
      created_at: "timestamptz",
      updated_at: "timestamptz",
      archived_at: "timestamptz",
      expected_closing_date: "date",
      sales_id: "bigint",
      index: "integer",
    },
    writable: [
      "name",
      "company_id",
      "contact_ids",
      "categories",
      "stage",
      "description",
      "amount",
      "created_at",
      "archived_at",
      "expected_closing_date",
      "sales_id",
      "index",
    ],
    required: ["name", "stage"],
    touchOnUpdate: "updated_at",
    idType: "bigint",
    defaultSort: { field: "index", order: "ASC" },
    can: ALL,
  },
  {
    name: "deal_notes",
    relation: "crm.deal_notes",
    table: "crm.deal_notes",
    searchTable: "crm.deal_notes",
    columns: {
      id: "bigint",
      deal_id: "bigint",
      type: "text",
      text: "text",
      date: "timestamptz",
      sales_id: "bigint",
      attachments: "jsonb[]",
    },
    writable: ["deal_id", "type", "text", "date", "sales_id", "attachments"],
    required: ["deal_id"],
    idType: "bigint",
    defaultSort: { field: "date", order: "DESC" },
    can: ALL,
  },
  {
    name: "tasks",
    relation: "crm.tasks",
    table: "crm.tasks",
    searchTable: "crm.tasks",
    columns: {
      id: "bigint",
      contact_id: "bigint",
      type: "text",
      text: "text",
      due_date: "timestamptz",
      done_date: "timestamptz",
      sales_id: "bigint",
      created_at: "timestamptz",
    },
    writable: ["contact_id", "type", "text", "due_date", "done_date", "sales_id"],
    required: ["contact_id"],
    idType: "bigint",
    defaultSort: { field: "due_date", order: "ASC" },
    can: ALL,
  },
  {
    name: "tags",
    relation: "crm.tags",
    table: "crm.tags",
    columns: { id: "bigint", name: "text", color: "text" },
    searchColumns: ["name"],
    writable: ["name", "color"],
    required: ["name", "color"],
    idType: "bigint",
    defaultSort: { field: "name", order: "ASC" },
    can: ALL,
  },
  {
    // A profile per org member. Rows are created by the worker from the
    // caller's identity (see ensureSalesProfile), never by a client.
    name: "sales",
    relation: "crm.sales",
    table: "crm.sales",
    columns: {
      id: "bigint",
      subject_id: "text",
      first_name: "text",
      last_name: "text",
      email: "text",
      administrator: "boolean",
      avatar: "json",
      disabled: "boolean",
      secondary_emails: "json",
    },
    searchColumns: ["first_name", "last_name", "email"],
    writable: ["first_name", "last_name", "avatar", "secondary_emails", "disabled"],
    required: [],
    idType: "bigint",
    defaultSort: { field: "last_name", order: "ASC" },
    can: { get: true, create: false, update: true, delete: false },
  },
  {
    name: "activity_log",
    relation: "crm.activity_log",
    columns: {
      id: "text",
      type: "text",
      date: "timestamptz",
      company_id: "bigint",
      sales_id: "bigint",
      company: "json",
      contact: "json",
      deal: "json",
      contact_note: "json",
      deal_note: "json",
    },
    writable: [],
    required: [],
    idType: "text",
    defaultSort: { field: "date", order: "DESC" },
    can: { get: false, create: false, update: false, delete: false },
  },
];

export const RESOURCES: ReadonlyMap<string, ResourceDef> = new Map(DEFS.map((d) => [d.name, d]));

/** Resources global search can be narrowed to. */
export const SEARCH_RESOURCES = [
  "companies",
  "contacts",
  "deals",
  "tasks",
  "contact_notes",
  "deal_notes",
] as const;
