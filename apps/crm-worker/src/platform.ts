// Where the CRM meets the rest of the platform (M6): domain events that feed
// the audit log and outbound webhooks, seat metering, and the plan's contact
// limit. The CRM keeps no copy of any of it; it writes to the owning contexts
// the way every Lumen worker does, through their @saas/db repositories.
//
// crm_app (the role every CRM statement runs as) has no rights outside the
// crm schema. So this work is queued by the handlers and done at the end of
// the same transaction, after the role is reset: the event is committed with
// the record it describes, or neither is.
import type { CheckBillingEntitlementResponse } from "@saas/contracts/billing";
import { createEventsRepository } from "@saas/db/events";
import type { SqlExecutor } from "@saas/db/hyperdrive";
import { uuidToHex, type Uuid } from "@saas/db/ids";
import { createMeteringRepository } from "@saas/db/metering";

export const CRM_EVENT_TYPES = [
  "crm.contact.created",
  "crm.deal.stage_changed",
  "crm.deal.won",
  "crm.note.created",
] as const;

export type CrmEventType = (typeof CRM_EVENT_TYPES)[number];

export interface PendingEvent {
  type: CrmEventType;
  subjectKind: "contact" | "deal" | "note";
  subjectId: string;
  subjectName?: string;
  /** One line for the audit log. */
  description: string;
  /** What a webhook receiver gets. Ids only, no free text of the record. */
  payload: Record<string, unknown>;
}

export interface PlatformWork {
  events: PendingEvent[];
  /** Subjects whose CRM profile was created by this request. */
  newSeats: string[];
}

export const SEAT_METRIC = "crm_seats";
export const CONTACTS_LIMIT_KEY = "limit.crm_contacts";

export interface PlatformContext {
  orgId: Uuid;
  actor: { subjectId: string; subjectType: string };
  requestId: string;
}

/** Writes the queued events and seat records. Runs inside the request's
 *  transaction, after `RESET ROLE`. Throws on failure, which rolls back the
 *  CRM write too. */
export async function flushPlatformWork(tx: SqlExecutor, context: PlatformContext, work: PlatformWork): Promise<void> {
  if (work.events.length === 0 && work.newSeats.length === 0) return;
  await tx.execute("RESET ROLE");

  const now = new Date();
  const orgPublicId = `org_${uuidToHex(context.orgId)}`;

  if (work.events.length > 0) {
    const events = createEventsRepository(tx);
    for (const pending of work.events) {
      const result = await events.appendEventWithAudit({
        event: {
          id: crypto.randomUUID(),
          type: pending.type,
          version: 1,
          source: "crm-worker",
          occurredAt: now,
          actorType: context.actor.subjectType,
          actorId: context.actor.subjectId,
          orgId: context.orgId,
          subjectKind: pending.subjectKind,
          subjectId: pending.subjectId,
          ...(pending.subjectName ? { subjectName: pending.subjectName.slice(0, 200) } : {}),
          requestId: context.requestId,
          payload: { orgId: orgPublicId, ...pending.payload },
        },
        audit: { id: crypto.randomUUID(), category: "crm", description: pending.description.slice(0, 500) },
      });
      if (!result.ok) throw new Error("crm event append failed");
    }
  }

  if (work.newSeats.length > 0) {
    const metering = createMeteringRepository(tx);
    for (const subjectId of work.newSeats) {
      // One record per member, ever: the idempotency key makes a repeat a
      // conflict, which is fine. The sum of the metric is the seat count.
      const result = await metering.recordUsage({
        id: crypto.randomUUID(),
        orgId: context.orgId,
        metric: SEAT_METRIC,
        quantity: 1,
        idempotencyKey: `${SEAT_METRIC}:${subjectId}`,
        recordedAt: now,
        metadata: { source: "crm-worker" },
      });
      if (!result.ok && result.error.kind !== "conflict") throw new Error("crm seat record failed");
    }
  }
}

// --- plan gating ------------------------------------------------------------

export type ContactsGate =
  | { kind: "allow" }
  | { kind: "deny"; message: string }
  | { kind: "unavailable" };

/** Decides whether one more contact fits the plan. `limitValue: null` is
 *  unlimited; anything unexpected denies. */
export function decideContactsLimit(decision: CheckBillingEntitlementResponse, contacts: number): ContactsGate {
  if (!decision.allowed) {
    return { kind: "deny", message: "Contacts are not available on this organization's plan" };
  }
  if (decision.valueType !== "quantity") {
    return { kind: "deny", message: "Contacts are not permitted by this organization's plan" };
  }
  if (decision.limitValue === null) return { kind: "allow" };
  if (typeof decision.limitValue !== "number" || !Number.isFinite(decision.limitValue) || decision.limitValue < 0) {
    return { kind: "deny", message: "Contacts are not permitted by this organization's plan" };
  }
  return contacts >= decision.limitValue
    ? { kind: "deny", message: `Your plan's limit of ${decision.limitValue} contacts has been reached` }
    : { kind: "allow" };
}

/** Asks billing-worker, over its service binding, what the plan allows.
 *  Fails closed, like every caller of this seam: no answer is not a yes. */
export async function checkContactsLimit(
  billing: Fetcher,
  orgId: Uuid,
  contacts: number,
  requestId: string,
): Promise<ContactsGate> {
  try {
    const response = await billing.fetch("http://billing-worker/v1/internal/billing/entitlements/check", {
      method: "POST",
      headers: { "content-type": "application/json", "x-request-id": requestId, "x-internal-caller": "crm-worker" },
      body: JSON.stringify({ orgId: `org_${uuidToHex(orgId)}`, entitlementKey: CONTACTS_LIMIT_KEY }),
    });
    if (!response.ok) return { kind: "unavailable" };
    const parsed = (await response.json()) as { data?: CheckBillingEntitlementResponse };
    if (!parsed?.data || typeof parsed.data.allowed !== "boolean") return { kind: "unavailable" };
    return decideContactsLimit(parsed.data, contacts);
  } catch {
    return { kind: "unavailable" };
  }
}
