import type { MembershipFact } from "@saas/contracts/policy";
import type { Uuid } from "@saas/db/ids";
import type { Env } from "./env.js";
import { fetchAuthorizationContext } from "./membership-client.js";
import { authorizeViaPolicy } from "./policy-client.js";

export interface Actor {
  subjectId: string;
  subjectType: string;
  email: string | null;
}

export type CrmAction = "organization.crm.read" | "organization.crm.write" | "organization.crm.manage";

export type Access =
  /** The actor has no role in this org: the org does not exist for them. */
  | { kind: "not_member" }
  /** A member, but their role does not allow the action. */
  | { kind: "denied" }
  | { kind: "allowed"; isAdmin: boolean };

const ADMIN_ROLES: ReadonlySet<string> = new Set(["owner", "admin"]);

function orgFacts(memberships: MembershipFact[], orgId: string): MembershipFact[] {
  return memberships.filter(
    (f) => f && f.kind === "role_assignment" && f.scope?.kind === "organization" && f.scope.orgId === orgId,
  );
}

export async function authorize(
  env: Env,
  actor: Actor,
  orgId: Uuid,
  action: CrmAction,
  requestId: string,
): Promise<Access> {
  if (!env.MEMBERSHIP_WORKER || !env.POLICY_WORKER) return { kind: "not_member" };

  const context = await fetchAuthorizationContext(
    env.MEMBERSHIP_WORKER,
    actor.subjectId,
    actor.subjectType,
    orgId,
    requestId,
  );
  if (!context.ok) return { kind: "not_member" };

  const facts = orgFacts(context.memberships, orgId);
  if (facts.length === 0) return { kind: "not_member" };

  const decision = await authorizeViaPolicy(
    env.POLICY_WORKER,
    actor.subjectId,
    actor.subjectType,
    action,
    { kind: "organization", id: orgId, orgId },
    context.memberships,
    requestId,
  );
  if (!decision.allow) return { kind: "denied" };

  return { kind: "allowed", isAdmin: facts.some((f) => ADMIN_ROLES.has(f.role)) };
}
