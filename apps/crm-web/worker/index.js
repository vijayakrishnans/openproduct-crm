// crm-web's Worker entrypoint. It runs in front of the static assets (the
// Vite build in dist/; `run_worker_first` in wrangler.jsonc) for two small
// jobs, then hands the request to them. The app calls api-edge from the
// browser, so nothing is proxied here.
//
//   1. The bare domain redirects to www: one address for people and for
//      search engines, and the only one the API's CORS and sign-in allow.
//   2. Every host but the public one tells crawlers not to index it (stage,
//      the workers.dev copies). The page says the same from a script, but a
//      header also reaches crawlers that do not run scripts.
//   3. The OAuth approval page (/oauth/authorize) may not be framed by another
//      site, so nobody can trick a click on its Allow button.

/** Hosts that only redirect, and where to. */
export const REDIRECT_HOSTS = { "brokecrm.cloud": "www.brokecrm.cloud" };

/** The one host search engines may index. */
export const PUBLIC_HOST = "www.brokecrm.cloud";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const target = REDIRECT_HOSTS[url.hostname];
    if (target) {
      url.hostname = target;
      url.protocol = "https:";
      return Response.redirect(url.toString(), 301);
    }

    const response = await env.ASSETS.fetch(request);
    const framed = url.pathname === "/oauth/authorize";
    if (url.hostname === PUBLIC_HOST && !framed) return response;
    const tagged = new Response(response.body, response);
    if (url.hostname !== PUBLIC_HOST || framed) tagged.headers.set("x-robots-tag", "noindex");
    if (framed) {
      tagged.headers.set("x-frame-options", "DENY");
      tagged.headers.set("content-security-policy", "frame-ancestors 'none'");
    }
    return tagged;
  },
};
