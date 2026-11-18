import type {
  AcceptInvitationInput,
  InvitationAcceptTarget,
  MembershipResult,
  PendingInvitation,
} from "@saas/db/membership";
import type { Env } from "@membership-worker/env";
import {
  handleAcceptMyInvitation,
  handleListMyInvitations,
  type MyInvitationsDeps,
} from "@membership-worker/handlers/my-invitations";
import { invitationPublicId, orgPublicId } from "@membership-worker/ids";

const ORG = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const INVITATION = "11111111-2222-4333-8444-555555555555";
const NOW = new Date("2026-11-18T10:00:00.000Z");
const env = {} as Env;
const person = { subjectId: "usr_1", subjectType: "user", email: "Invitee@Example.com" };

const invitation = {
  id: INVITATION,
  orgId: ORG,
  email: "invitee@example.com",
  emailLower: "invitee@example.com",
  role: "builder",
  status: "pending",
  invitedBy: "usr_admin",
  expiresAt: new Date("2026-11-25T10:00:00.000Z"),
  acceptedAt: null,
  revokedAt: null,
  createdAt: NOW,
};

function deps(opts: {
  pending?: MembershipResult<PendingInvitation[]>;
  target?: MembershipResult<InvitationAcceptTarget>;
} = {}) {
  const calls = {
    list: [] as unknown[][],
    target: [] as unknown[][],
    accepted: [] as AcceptInvitationInput[],
  };
  const value: MyInvitationsDeps = {
    now: () => NOW,
    repo: {
      async listPendingInvitationsForEmail(...args) {
        calls.list.push(args);
        return (
          opts.pending ?? {
            ok: true,
            value: [{ invitation, organization: { id: ORG, name: "Acme", slug: "acme" } }],
          }
        );
      },
      async getInvitationAcceptTarget(...args) {
        calls.target.push(args);
        return opts.target ?? { ok: true, value: { orgId: ORG as never, tokenHash: "stored-hash" } };
      },
    },
    accept: {
      now: () => NOW,
      repo: {
        async acceptInvitation(input) {
          calls.accepted.push(input);
          return {
            ok: true,
            value: {
              invitation: { ...invitation, status: "accepted", acceptedAt: NOW },
              member: {
                id: "66666666-7777-4888-8999-aaaaaaaaaaaa",
                orgId: ORG,
                subjectId: input.subjectId,
                subjectType: input.subjectType,
                status: "active",
                createdAt: NOW,
                updatedAt: NOW,
              },
              roleAssignment: {
                id: "ra_1",
                orgId: ORG,
                subjectId: input.subjectId,
                subjectType: input.subjectType,
                role: "builder",
                scopeKind: "organization",
                scopeRef: null,
                createdAt: NOW,
                revokedAt: null,
              },
            },
          };
        },
      },
    },
  };
  return { value, calls };
}

describe("the invitee's invitations", () => {
  it("lists invitations for the session's email, with public ids and no token", async () => {
    const { value, calls } = deps();
    const response = await handleListMyInvitations(env, "req", person, value);
    const body = (await response.json()) as { data: { invitations: Record<string, unknown>[] } };

    expect(response.status).toBe(200);
    expect(calls.list[0]).toEqual(["invitee@example.com", "usr_1", NOW]);
    expect(body.data.invitations).toEqual([
      {
        id: invitationPublicId(INVITATION),
        role: "builder",
        expiresAt: "2026-11-25T10:00:00.000Z",
        createdAt: NOW.toISOString(),
        organization: { id: orgPublicId(ORG), name: "Acme", slug: "acme" },
      },
    ]);
  });

  it("lists nothing for an API key", async () => {
    const { value, calls } = deps();
    const response = await handleListMyInvitations(
      env,
      "req",
      { ...person, subjectType: "service_principal" },
      value,
    );
    const body = (await response.json()) as { data: { invitations: unknown[] } };
    expect(body.data.invitations).toEqual([]);
    expect(calls.list).toHaveLength(0);
  });

  it("accepts an invitation addressed to the session's email", async () => {
    const { value, calls } = deps();
    const response = await handleAcceptMyInvitation(env, "req", person, invitationPublicId(INVITATION), value);

    expect(response.status).toBe(200);
    expect(calls.target[0]).toEqual([INVITATION, "invitee@example.com"]);
    expect(calls.accepted[0]).toMatchObject({
      tokenHash: "stored-hash",
      orgId: ORG,
      emailLower: "invitee@example.com",
      subjectId: "usr_1",
    });
  });

  it("answers 404 for an invitation addressed to someone else, and accepts nothing", async () => {
    const { value, calls } = deps({ target: { ok: false, error: { kind: "not_found" } } });
    const response = await handleAcceptMyInvitation(env, "req", person, invitationPublicId(INVITATION), value);
    expect(response.status).toBe(404);
    expect(calls.accepted).toHaveLength(0);
  });

  it("does not let an API key accept", async () => {
    const { value, calls } = deps();
    const response = await handleAcceptMyInvitation(
      env,
      "req",
      { ...person, subjectType: "service_principal" },
      invitationPublicId(INVITATION),
      value,
    );
    expect(response.status).toBe(404);
    expect(calls.target).toHaveLength(0);
  });

  it("answers 404 for a malformed id", async () => {
    const { value, calls } = deps();
    const response = await handleAcceptMyInvitation(env, "req", person, "nonsense", value);
    expect(response.status).toBe(404);
    expect(calls.target).toHaveLength(0);
  });
});
