// The per-request DB client is deliberate: cross-request socket reuse is
// forbidden on Workers, and Hyperdrive already pools the upstream connection.
export interface Env {
  PLATFORM_DB?: Hyperdrive;
  /** R2 bucket for note attachments. */
  ATTACHMENTS?: R2Bucket;
  MEMBERSHIP_WORKER?: Fetcher;
  POLICY_WORKER?: Fetcher;
  /** Answers what the organization's plan allows (the contact limit). */
  BILLING_WORKER?: Fetcher;
  ENVIRONMENT: string;
}
