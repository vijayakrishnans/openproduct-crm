// crm-web's Worker entrypoint. Static assets (the Vite build in dist/) are
// served by the ASSETS binding before this runs; anything that reaches the
// Worker falls through to the assets with the SPA fallback configured in
// wrangler.jsonc. M3 adds the session-aware routes here.
export default {
  async fetch(request, env) {
    return env.ASSETS.fetch(request);
  },
};
