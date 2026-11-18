import { describe, expect, it } from "vitest";
import worker from "./index.js";

const env = {
  ASSETS: { fetch: async () => new Response("<html></html>", { headers: { "content-type": "text/html" } }) },
};
const get = (url) => worker.fetch(new Request(url), env);

describe("crm-web worker", () => {
  it("redirects the bare domain to www, keeping the path and query", async () => {
    const response = await get("https://brokecrm.cloud/?demo");
    expect(response.status).toBe(301);
    expect(response.headers.get("location")).toBe("https://www.brokecrm.cloud/?demo");
  });

  it("serves the public host as it is, indexable", async () => {
    const response = await get("https://www.brokecrm.cloud/");
    expect(response.status).toBe(200);
    expect(response.headers.get("x-robots-tag")).toBeNull();
  });

  it("marks every other host noindex", async () => {
    for (const host of ["stage.brokecrm.cloud", "openproduct-crm-crm-web-prod.vijayakrishnan12994.workers.dev"]) {
      const response = await get(`https://${host}/`);
      expect(response.status).toBe(200);
      expect(response.headers.get("x-robots-tag")).toBe("noindex");
      expect(await response.text()).toBe("<html></html>");
    }
  });
});
