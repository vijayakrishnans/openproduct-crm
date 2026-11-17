import { createSqlExecutor } from "@saas/db/hyperdrive";
import type { Env } from "./env.js";
import { handleInboundEmail } from "./inbound-email.js";
import { route } from "./router.js";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return route(request, env);
  },

  // Email Routing delivers here once a domain's inbound address is routed to
  // this Worker (see docs/runbook.md). Until then nothing calls it.
  async email(message: ForwardableEmailMessage, env: Env): Promise<void> {
    if (!env.PLATFORM_DB) {
      message.setReject("Temporarily unavailable");
      return;
    }
    const db = createSqlExecutor(env.PLATFORM_DB);
    try {
      const outcome = await handleInboundEmail(message, { db, bucket: env.ATTACHMENTS });
      if (outcome.status === "rejected") message.setReject(outcome.reason);
    } catch {
      message.setReject("The message could not be processed");
    } finally {
      await db.dispose();
    }
  },
} satisfies ExportedHandler<Env>;
