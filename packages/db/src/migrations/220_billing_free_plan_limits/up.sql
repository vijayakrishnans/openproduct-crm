-- 220_billing_free_plan_limits: the free plan's higher limits, for the
-- organizations that already have their rows.
--
-- Context: billing
-- The free plan now grants 10,000 contacts and 25 seats per organization
-- (it granted 500 and 5). A plan's limits are copied into
-- billing.entitlements when the plan is assigned, so an organization that
-- existed before this change keeps the old numbers until its rows are
-- raised. This raises them.
--
-- Only plan-derived rows that still hold an old value are touched; an
-- override has a different source and is left as it is. Seats also rise
-- from 20, the Pro plan's old number, because no plan grants fewer seats
-- than free. Running it twice changes nothing.

UPDATE billing.entitlements
   SET limit_value = 10000, updated_at = now()
 WHERE entitlement_key = 'limit.crm_contacts'
   AND source = 'plan'
   AND limit_value = 500;

UPDATE billing.entitlements
   SET limit_value = 25, updated_at = now()
 WHERE entitlement_key = 'limit.members'
   AND source = 'plan'
   AND limit_value IN (5, 20);
