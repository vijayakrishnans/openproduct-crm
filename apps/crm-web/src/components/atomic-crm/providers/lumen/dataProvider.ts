// React-admin data provider over api-edge's org-scoped CRM routes
// (/v1/organizations/:orgId/crm, served by crm-worker). It keeps the method
// set of the provider it replaces, so the components are unchanged.
import {
  withLifecycleCallbacks,
  type CreateParams,
  type DataProvider,
  type DeleteManyParams,
  type DeleteParams,
  type GetListParams,
  type GetManyParams,
  type GetManyReferenceParams,
  type GetOneParams,
  type Identifier,
  type ResourceCallbacks,
  type UpdateManyParams,
  type UpdateParams,
} from "ra-core";

import type {
  ContactNote,
  Deal,
  DealNote,
  RAFile,
  Sale,
  SalesFormData,
  SearchResourceName,
  SearchResult,
  SignUpData,
} from "../../types";
import type { ConfigurationContextValue } from "../../root/ConfigurationContext";
import { api, crmPath, orgPath } from "./client";
import { translateFilter } from "./filters";

const CONFIGURATION_KEY = "crm.configuration";
const MAX_PER_PAGE = 1000;

// Lists and single reads of these go through the summary views, which add the
// computed columns the UI shows (company_name, nb_tasks, nb_deals…).
const READ_ALIAS: Record<string, string> = {
  companies: "companies_summary",
  contacts: "contacts_summary",
};

type ListResponse = { items: any[]; total: number };

const toSale = (row: any): any => (row ? { ...row, user_id: row.subject_id } : row);

const fromServer = (resource: string, row: any): any => {
  if (resource === "sales") return toSale(row);
  if (resource === "activity_log") {
    // Rename snake_case view columns to camelCase to match the Activity type
    return {
      ...row,
      contactNote: row.contact_note ?? undefined,
      dealNote: row.deal_note ?? undefined,
      contact_note: undefined,
      deal_note: undefined,
    };
  }
  return row;
};

async function list(resource: string, params: Partial<GetListParams>): Promise<ListResponse> {
  const { page = 1, perPage = 25 } = params.pagination ?? {};
  const { field, order } = params.sort ?? {};
  const filter = translateFilter(params.filter);
  const data = await api<ListResponse>("GET", `${crmPath()}/${READ_ALIAS[resource] ?? resource}`, {
    query: {
      page,
      perPage: Math.min(perPage, MAX_PER_PAGE),
      sort: field,
      order,
      filter: Object.keys(filter).length > 0 ? JSON.stringify(filter) : undefined,
    },
    signal: params.signal,
  });
  return { items: data.items.map((row) => fromServer(resource, row)), total: data.total };
}

const convertFileToBase64 = (file: { rawFile: Blob }): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file.rawFile);
  });

/** Small images (avatars, logos, cropped in the browser) are stored inline
 *  until M4 moves files to R2. */
async function inlineImage<T extends { rawFile?: File; src?: string; title?: string } | undefined | null>(
  image: T,
): Promise<T | { src: string; title?: string }> {
  if (image && image.rawFile instanceof File) {
    return { src: await convertFileToBase64({ rawFile: image.rawFile }), title: image.title };
  }
  return image;
}

function rejectNewAttachments(note: ContactNote | DealNote) {
  const attachments = (note.attachments ?? []) as RAFile[];
  if (attachments.some((file) => file?.rawFile instanceof File)) {
    throw new Error("File attachments are not available yet");
  }
  return note;
}

const baseDataProvider = {
  async getList(resource: string, params: GetListParams) {
    const { items, total } = await list(resource, params);
    return { data: items, total };
  },

  async getOne(resource: string, params: GetOneParams) {
    const row = await api("GET", `${crmPath()}/${READ_ALIAS[resource] ?? resource}/${params.id}`, {
      signal: params.signal,
    });
    return { data: fromServer(resource, row) };
  },

  async getMany(resource: string, params: GetManyParams) {
    if (params.ids.length === 0) return { data: [] };
    const { items } = await list(resource, {
      filter: { "id@in": params.ids },
      pagination: { page: 1, perPage: MAX_PER_PAGE },
      sort: { field: "id", order: "ASC" },
      signal: params.signal,
    });
    return { data: items };
  },

  async getManyReference(resource: string, params: GetManyReferenceParams) {
    const { items, total } = await list(resource, {
      ...params,
      filter: { ...params.filter, [params.target]: params.id },
    });
    return { data: items, total };
  },

  async create(resource: string, params: CreateParams) {
    const row = await api("POST", `${crmPath()}/${resource}`, { body: params.data });
    return { data: fromServer(resource, row) };
  },

  async update(resource: string, params: UpdateParams) {
    const row = await api("PATCH", `${crmPath()}/${resource}/${params.id}`, { body: params.data });
    return { data: fromServer(resource, row) };
  },

  async updateMany(resource: string, params: UpdateManyParams) {
    await Promise.all(
      params.ids.map((id) => api("PATCH", `${crmPath()}/${resource}/${id}`, { body: params.data })),
    );
    return { data: params.ids };
  },

  async delete(resource: string, params: DeleteParams) {
    const row = await api("DELETE", `${crmPath()}/${resource}/${params.id}`);
    return { data: fromServer(resource, row) };
  },

  async deleteMany(resource: string, params: DeleteManyParams) {
    await Promise.all(params.ids.map((id) => api("DELETE", `${crmPath()}/${resource}/${id}`)));
    return { data: params.ids };
  },
} satisfies DataProvider;

type SettingRow = { id: string; key: string; value: unknown };

async function findConfigurationSetting(): Promise<SettingRow | undefined> {
  const { settings } = await api<{ settings: SettingRow[] }>("GET", `${orgPath()}/config/settings`);
  return settings.find((setting) => setting.key === CONFIGURATION_KEY);
}

function parseConfiguration(value: unknown): ConfigurationContextValue {
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as ConfigurationContextValue;
    } catch {
      return {} as ConfigurationContextValue;
    }
  }
  return ((value as ConfigurationContextValue) ?? {}) as ConfigurationContextValue;
}

const dataProviderWithCustomMethods = {
  ...baseDataProvider,

  // Accounts are Lumen identities: sign-up is the same email-code flow as
  // sign-in (see LumenLoginPage), so there is nothing to do here.
  async signUp(_data: SignUpData): Promise<{ id: string; email: string; password: string }> {
    throw new Error("Sign up with your email on the sign-in page");
  },

  async isInitialized() {
    return true;
  },

  /** Adding a colleague is an invitation to the organization; their CRM
   *  profile appears when they first sign in. */
  async salesCreate(body: SalesFormData): Promise<Sale> {
    await api("POST", `${orgPath()}/invitations`, {
      body: { email: body.email, role: body.administrator ? "admin" : "builder" },
    });
    return {
      id: `invitation:${body.email}`,
      first_name: body.first_name,
      last_name: body.last_name,
      email: body.email,
      administrator: body.administrator,
      disabled: false,
      user_id: "",
    } as Sale;
  },

  async salesUpdate(id: Identifier, data: Partial<Omit<SalesFormData, "password">>): Promise<Sale> {
    const { first_name, last_name, secondary_emails, disabled } = data;
    const avatar = await inlineImage(data.avatar as any);
    const row = await api("PATCH", `${crmPath()}/sales/${id}`, {
      body: { first_name, last_name, secondary_emails, disabled, avatar },
    });
    return toSale(row);
  },

  async updatePassword(_id: Identifier): Promise<boolean> {
    throw new Error("There is no password: you sign in with a code sent to your email");
  },

  async unarchiveDeal(deal: Deal) {
    // get all deals where stage is the same as the deal to unarchive
    const { data: deals } = await baseDataProvider.getList("deals", {
      filter: { stage: deal.stage },
      pagination: { page: 1, perPage: 1000 },
      sort: { field: "index", order: "ASC" },
    });

    // set index for each deal starting from 1, if the deal to unarchive is found, set its index to the last one
    const updatedDeals = (deals as Deal[]).map((d, index) => ({
      ...d,
      index: d.id === deal.id ? 0 : index + 1,
      archived_at: d.id === deal.id ? null : d.archived_at,
    }));

    return await Promise.all(
      updatedDeals.map((updatedDeal) =>
        baseDataProvider.update("deals", {
          id: updatedDeal.id,
          data: updatedDeal,
          previousData: deals.find((d: Deal) => d.id === updatedDeal.id),
        }),
      ),
    );
  },

  async globalSearch(
    query: string,
    resources: readonly SearchResourceName[],
    maxResults: number,
  ): Promise<SearchResult[]> {
    const { items } = await api<{ items: SearchResult[] }>("GET", `${crmPath()}/search`, {
      query: {
        q: query,
        resources: resources.length > 0 ? resources.join(",") : undefined,
        limit: Math.max(1, Math.min(maxResults, 200)),
      },
    });
    return items ?? [];
  },

  async mergeContacts(sourceId: Identifier, targetId: Identifier) {
    return api("POST", `${crmPath()}/contacts/merge`, {
      body: { loserId: sourceId, winnerId: targetId },
    });
  },

  async getConfiguration(): Promise<ConfigurationContextValue> {
    const setting = await findConfigurationSetting();
    return setting ? parseConfiguration(setting.value) : ({} as ConfigurationContextValue);
  },

  async updateConfiguration(config: ConfigurationContextValue): Promise<ConfigurationContextValue> {
    const next = {
      ...config,
      lightModeLogo: await configLogo(config.lightModeLogo),
      darkModeLogo: await configLogo(config.darkModeLogo),
    };
    const existing = await findConfigurationSetting();
    const { setting } = existing
      ? await api<{ setting: SettingRow }>("PATCH", `${orgPath()}/config/settings/${existing.id}`, {
          body: { value: next },
        })
      : await api<{ setting: SettingRow }>("POST", `${orgPath()}/config/settings`, {
          body: { key: CONFIGURATION_KEY, value: next },
        });
    return parseConfiguration(setting.value);
  },
} satisfies DataProvider;

async function configLogo(logo: any): Promise<string> {
  if (typeof logo === "string") return logo;
  if (logo?.rawFile instanceof File) return convertFileToBase64(logo);
  return logo?.src ?? "";
}

// The standard provider plus the CRM's own methods; the demo's fakerest
// provider implements the same set.
export type CrmDataProvider = DataProvider &
  Pick<
    typeof dataProviderWithCustomMethods,
    | "signUp"
    | "isInitialized"
    | "salesCreate"
    | "salesUpdate"
    | "updatePassword"
    | "unarchiveDeal"
    | "globalSearch"
    | "mergeContacts"
    | "getConfiguration"
    | "updateConfiguration"
  >;

const lifeCycleCallbacks: ResourceCallbacks[] = [
  {
    resource: "contact_notes",
    beforeSave: async (data: ContactNote) => rejectNewAttachments(data) as ContactNote,
  },
  {
    resource: "deal_notes",
    beforeSave: async (data: DealNote) => rejectNewAttachments(data) as DealNote,
  },
  {
    resource: "companies",
    beforeSave: async (data: any) => ({ ...data, logo: await inlineImage(data.logo) }),
  },
  {
    resource: "contacts",
    beforeSave: async (data: any) => ({ ...data, avatar: await inlineImage(data.avatar) }),
  },
  {
    resource: "sales",
    beforeSave: async (data: any) => ({ ...data, avatar: await inlineImage(data.avatar) }),
  },
];

export const getDataProvider = () =>
  withLifecycleCallbacks(dataProviderWithCustomMethods, lifeCycleCallbacks) as CrmDataProvider;
