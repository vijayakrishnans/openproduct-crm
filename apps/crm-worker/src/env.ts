// The per-request DB client is deliberate: cross-request socket reuse is
// forbidden on Workers, and Hyperdrive already pools the upstream connection.
export interface Env {
  PLATFORM_DB?: Hyperdrive;
  MEMBERSHIP_WORKER?: Fetcher;
  POLICY_WORKER?: Fetcher;
  ENVIRONMENT: string;
}
