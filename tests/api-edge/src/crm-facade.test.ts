import { isCrmRoute, handleCrmRoute } from "@api-edge/crm-facade";
import { isOrgRoute } from "@api-edge/org-facade";
import { isProjectRoute } from "@api-edge/project-facade";

interface FetchCall {
  url: string;
  init: RequestInit;
}

function fakeFetcher(response: () => Response): { fetcher: Fetcher; calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  const fetcher = {
    fetch(input: string | Request | URL, init?: RequestInit): Promise<Response> {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      calls.push({ url, init: init ?? {} });
      return Promise.resolve(response());
    },
    connect() {
      throw new Error("not implemented");
    },
  } as unknown as Fetcher;
  return { fetcher, calls };
}

function identity(ok = true) {
  return fakeFetcher(() =>
    ok
      ? Response.json({
          data: {
            actor: { actorType: "user", actorId: "usr_abc123", email: "user@test.com" },
            user: { id: "usr_abc123", email: "user@test.com", displayName: "Test" },
          },
          meta: { requestId: "req_inner", cursor: null },
        })
      : Response.json({ error: { code: "unauthenticated" } }, { status: 401 }),
  );
}

function crm(status = 200) {
  return fakeFetcher(() =>
    Response.json({ data: { items: [], total: 0 }, meta: { requestId: "req_test", cursor: null } }, { status }),
  );
}

const PATH = "/v1/organizations/org_abc123/crm/contacts";

function request(method: string, path = PATH, extra: Record<string, string> = {}, body?: unknown): Request {
  const init: RequestInit = {
    method,
    headers: { authorization: "Bearer sps_ses_abc.secret", "content-type": "application/json", ...extra },
  };
  if (body !== undefined) init.body = JSON.stringify(body);
  return new Request(`https://api.example.com${path}`, init);
}

describe("api-edge crm facade", () => {
  describe("isCrmRoute", () => {
    it.each([
      "/v1/organizations/org_abc/crm",
      "/v1/organizations/org_abc/crm/contacts",
      "/v1/organizations/org_abc/crm/contacts/12",
      "/v1/organizations/org_abc/crm/contacts/merge",
      "/v1/organizations/org_abc/crm/search",
    ])("matches %s", (path) => {
      expect(isCrmRoute(path)).toBe(true);
    });

    it.each([
      "/v1/organizations/org_abc",
      "/v1/organizations/org_abc/crmx",
      "/v1/organizations/org_abc/projects",
      "/v1/crm/contacts",
      "/v1/organizations/crm",
      "/v1/organizations/a/b/crm/contacts",
    ])("does not match %s", (path) => {
      expect(isCrmRoute(path)).toBe(false);
    });

    it("is claimed by no other org-scoped facade", () => {
      expect(isOrgRoute(PATH)).toBe(false);
      expect(isProjectRoute(PATH)).toBe(false);
    });
  });

  it("forwards a read to CRM_WORKER with the resolved actor and the query string", async () => {
    const id = identity();
    const worker = crm();
    const response = await handleCrmRoute(
      request("GET", `${PATH}?page=2&filter=%7B%22q%22%3A%22x%22%7D`),
      { IDENTITY_WORKER: id.fetcher, CRM_WORKER: worker.fetcher, ENVIRONMENT: "test" },
      "req_test",
      PATH,
    );

    expect(response.status).toBe(200);
    expect(id.calls).toHaveLength(1);
    expect(worker.calls).toHaveLength(1);
    expect(worker.calls[0]!.url).toBe(`https://crm.internal${PATH}?page=2&filter=%7B%22q%22%3A%22x%22%7D`);
    const headers = new Headers(worker.calls[0]!.init.headers as HeadersInit);
    expect(headers.get("x-actor-subject-id")).toBe("usr_abc123");
    expect(headers.get("x-actor-subject-type")).toBe("user");
    expect(headers.get("x-actor-email")).toBe("user@test.com");
    expect(headers.get("x-request-id")).toBe("req_test");
    expect(headers.get("authorization")).toBeNull();
    expect(worker.calls[0]!.init.body).toBeUndefined();
  });

  it("never lets a client choose its own actor", async () => {
    const id = identity();
    const worker = crm();
    await handleCrmRoute(
      request("GET", PATH, {
        "x-actor-subject-id": "usr_victim",
        "x-actor-subject-type": "service_principal",
        "x-actor-email": "victim@test.com",
      }),
      { IDENTITY_WORKER: id.fetcher, CRM_WORKER: worker.fetcher, ENVIRONMENT: "test" },
      "req_test",
      PATH,
    );
    const headers = new Headers(worker.calls[0]!.init.headers as HeadersInit);
    expect(headers.get("x-actor-subject-id")).toBe("usr_abc123");
    expect(headers.get("x-actor-subject-type")).toBe("user");
    expect(headers.get("x-actor-email")).toBe("user@test.com");
  });

  it.each(["POST", "PUT", "PATCH"])("forwards the body of a %s", async (method) => {
    const id = identity();
    const worker = crm(201);
    const response = await handleCrmRoute(
      request(method, PATH, {}, { first_name: "Ada" }),
      { IDENTITY_WORKER: id.fetcher, CRM_WORKER: worker.fetcher, ENVIRONMENT: "test" },
      "req_test",
      PATH,
    );
    expect(response.status).toBe(201);
    expect(worker.calls[0]!.init.method).toBe(method);
    expect(worker.calls[0]!.init.body).toBeDefined();
  });

  it("forwards a DELETE without a body", async () => {
    const id = identity();
    const worker = crm();
    await handleCrmRoute(
      request("DELETE", `${PATH}/12`),
      { IDENTITY_WORKER: id.fetcher, CRM_WORKER: worker.fetcher, ENVIRONMENT: "test" },
      "req_test",
      `${PATH}/12`,
    );
    expect(worker.calls[0]!.init.method).toBe("DELETE");
    expect(worker.calls[0]!.init.body).toBeUndefined();
  });

  it("passes the worker's 404 through unchanged", async () => {
    const id = identity();
    const worker = crm(404);
    const response = await handleCrmRoute(
      request("GET"),
      { IDENTITY_WORKER: id.fetcher, CRM_WORKER: worker.fetcher, ENVIRONMENT: "test" },
      "req_test",
      PATH,
    );
    expect(response.status).toBe(404);
  });

  it("answers 401 without calling the worker when the session does not resolve", async () => {
    const id = identity(false);
    const worker = crm();
    const response = await handleCrmRoute(
      request("GET"),
      { IDENTITY_WORKER: id.fetcher, CRM_WORKER: worker.fetcher, ENVIRONMENT: "test" },
      "req_test",
      PATH,
    );
    expect(response.status).toBe(401);
    expect(worker.calls).toHaveLength(0);
  });

  it("answers 405 for a method the CRM does not use", async () => {
    const id = identity();
    const worker = crm();
    const response = await handleCrmRoute(
      request("OPTIONS"),
      { IDENTITY_WORKER: id.fetcher, CRM_WORKER: worker.fetcher, ENVIRONMENT: "test" },
      "req_test",
      PATH,
    );
    expect(response.status).toBe(405);
    expect(worker.calls).toHaveLength(0);
  });

  it("answers 503 when a binding is missing or the worker is unreachable", async () => {
    const id = identity();
    const noWorker = await handleCrmRoute(
      request("GET"),
      { IDENTITY_WORKER: id.fetcher, ENVIRONMENT: "test" },
      "req_test",
      PATH,
    );
    expect(noWorker.status).toBe(503);

    const noIdentity = await handleCrmRoute(request("GET"), { CRM_WORKER: crm().fetcher, ENVIRONMENT: "test" }, "req_test", PATH);
    expect(noIdentity.status).toBe(503);

    const throwing = {
      fetch: () => Promise.reject(new Error("network error")),
      connect() {
        throw new Error("not implemented");
      },
    } as unknown as Fetcher;
    const down = await handleCrmRoute(
      request("GET"),
      { IDENTITY_WORKER: id.fetcher, CRM_WORKER: throwing, ENVIRONMENT: "test" },
      "req_test",
      PATH,
    );
    expect(down.status).toBe(503);
  });
});
