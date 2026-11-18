import type { Env } from "../env.js";
import type { MembershipRepository } from "@saas/db/membership";
import { createSqlExecutor } from "@saas/db/hyperdrive";
import { createMembershipRepository } from "@saas/db/membership";
import { errorResponse, successResponse } from "../http.js";
import { invitationPublicId, orgPublicId, parseInvitationPublicId } from "../ids.js";
import {
  completeInvitationAcceptance,
  type AcceptActorContext,
  type AcceptInvitationDeps,
} from "./accept-invitation.js";

// The invitee's side of an invitation. Production never hands out the raw
// invitation token, so the proof here is the session itself: identity only
// issues sessions for an email verified by a sign-in code or by the provider,
// and an invitation is visible and acceptable only to that address.

export interface MyInvitationsDeps {
  repo: Pick<MembershipRepository, "listPendingInvitationsForEmail" | "getInvitationAcceptTarget">;
  now?: () => Date;
  accept?: AcceptInvitationDeps;
}

function notAPerson(actor: AcceptActorContext): boolean {
  return actor.subjectType !== "user";
}

export async function handleListMyInvitations(
  env: Env,
  requestId: string,
  actor: AcceptActorContext,
  deps?: MyInvitationsDeps,
): Promise<Response> {
  if (notAPerson(actor)) return successResponse({ invitations: [] }, requestId, 200);
  if (!deps && !env.PLATFORM_DB) {
    return errorResponse("internal_error", "Database not configured", 503, requestId);
  }

  const executor = deps ? null : createSqlExecutor(env.PLATFORM_DB!);
  try {
    const repo = deps ? deps.repo : createMembershipRepository(executor!);
    const now = deps?.now ? deps.now() : new Date();
    const result = await repo.listPendingInvitationsForEmail(actor.email.toLowerCase(), actor.subjectId, now);
    if (!result.ok) {
      return errorResponse("internal_error", "An unexpected error occurred", 500, requestId);
    }
    const invitations = result.value.map(({ invitation, organization }) => ({
      id: invitationPublicId(invitation.id),
      role: invitation.role,
      expiresAt: invitation.expiresAt.toISOString(),
      createdAt: invitation.createdAt.toISOString(),
      organization: {
        id: orgPublicId(organization.id),
        name: organization.name,
        slug: organization.slug,
      },
    }));
    return successResponse({ invitations }, requestId, 200);
  } catch {
    return errorResponse("internal_error", "An unexpected error occurred", 500, requestId);
  } finally {
    if (executor) await executor.dispose();
  }
}

export async function handleAcceptMyInvitation(
  env: Env,
  requestId: string,
  actor: AcceptActorContext,
  invitationIdParam: string,
  deps?: MyInvitationsDeps,
): Promise<Response> {
  const invitationId = parseInvitationPublicId(invitationIdParam);
  if (!invitationId || notAPerson(actor)) {
    return errorResponse("not_found", "Invitation not found", 404, requestId);
  }
  if (!deps && !env.PLATFORM_DB) {
    return errorResponse("internal_error", "Database not configured", 503, requestId);
  }

  const executor = deps ? null : createSqlExecutor(env.PLATFORM_DB!);
  let target;
  try {
    const repo = deps ? deps.repo : createMembershipRepository(executor!);
    target = await repo.getInvitationAcceptTarget(invitationId, actor.email.toLowerCase());
  } catch {
    return errorResponse("internal_error", "An unexpected error occurred", 500, requestId);
  } finally {
    if (executor) await executor.dispose();
  }

  if (!target.ok) {
    // Someone else's invitation is indistinguishable from a missing one.
    return target.error.kind === "not_found"
      ? errorResponse("not_found", "Invitation not found", 404, requestId)
      : errorResponse("internal_error", "An unexpected error occurred", 500, requestId);
  }

  return completeInvitationAcceptance(
    env,
    requestId,
    actor,
    target.value.orgId,
    target.value.tokenHash,
    deps?.accept,
  );
}
