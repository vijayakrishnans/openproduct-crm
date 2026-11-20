// One build serves both apps (see src/main.tsx): `?demo` is the in-browser
// demo on fake data. Upstream reads this from a build flag or config.js;
// BrokeCRM decides at runtime, from the address.
export const isDemo = (): boolean =>
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).has("demo");
