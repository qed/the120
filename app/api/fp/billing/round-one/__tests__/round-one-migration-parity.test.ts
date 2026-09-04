import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  lastCreateOrReplaceFunction,
  ROUND_ONE_BILLING_MIGRATION_SPEC,
  safelyResolveMigrationContract,
} from "@/app/lib/test-utils/migration-contract";
import {
  ROUND_ONE_ACCESS_CODE,
  ROUND_ONE_AMOUNT_CENTS,
  ROUND_ONE_CURRENCY,
  ROUND_ONE_FIRST_LOCKED_TASK_ID,
  ROUND_ONE_LAST_INCLUDED_TASK_ID,
  ROUND_ONE_PRODUCT_KEY,
} from "../round-one-rules";

const migrationsDir = path.resolve(process.cwd(), "supabase/migrations");
const migrationResolution = safelyResolveMigrationContract(
  migrationsDir,
  ROUND_ONE_BILLING_MIGRATION_SPEC
);
const allMigrationRaw = migrationResolution.ok ? migrationResolution.value.allRaw : "";
const deploymentRaw = migrationResolution.ok
  ? migrationResolution.value.deploymentRaw
  : "";
const upgradeRaw = migrationResolution.ok ? migrationResolution.value.upgradeRaw : "";
const sql = allMigrationRaw.replace(/--[^\n]*/g, "").toLowerCase();
const upgradeSql = upgradeRaw.replace(/--[^\n]*/g, "").toLowerCase();
const effectiveFunction = (name: string): string => migrationResolution.ok
  ? lastCreateOrReplaceFunction(deploymentRaw, `public.${name}`)
      .replace(/--[^\n]*/g, "")
      .toLowerCase()
  : "";
const beginOrderSql = effectiveFunction("fp_billing_begin_order");
const attachCheckoutSql = effectiveFunction("fp_billing_attach_checkout");
const applyEventSql = effectiveFunction("fp_billing_apply_stripe_event");
const staffAccessSql = effectiveFunction("fp_billing_set_round_one_access");
const completionGuardSql = effectiveFunction("fp_round_one_completion_guard");
const fillParentPhoneSql = effectiveFunction("fp_billing_fill_parent_phone");
const offerReadyNotificationSql = effectiveFunction("fp_round_one_offer_ready_notification");

describe("Round One migration manifest", () => {
  it("resolves one renamed foundation plus all ordered additive upgrades", () => {
    if (!migrationResolution.ok) throw migrationResolution.error;
    expect(migrationResolution.value.foundation).toMatch(
      /^\d{14}_fp_round_one_billing\.sql$/
    );
    expect(migrationResolution.value.orderedFiles).toEqual([
      migrationResolution.value.foundation,
      ...migrationResolution.value.upgrades,
    ]);
    expect(migrationResolution.value.deploymentFiles).toEqual(
      ROUND_ONE_BILLING_MIGRATION_SPEC.deploymentMode === "fresh-foundation"
        ? migrationResolution.value.orderedFiles
        : migrationResolution.value.upgrades
    );
  });

  it("requires both 036 review constraints and a disposable old-schema upgrade proof", () => {
    const runbook = readFileSync(
      path.resolve(process.cwd(), "docs/runbooks/2026-09-01-fp-round-one-billing.md"),
      "utf8"
    );
    expect(runbook).toContain("fp_billing_review_items_review_state_check");
    expect(runbook).toMatch(
      /drop constraint fp_billing_review_items_resolution_shape[\s\S]*?add constraint fp_billing_review_items_resolution_shape/
    );
    expect(runbook).toContain("review_state = 'superseded'");
    expect(runbook).toContain("036332a6b0abf11cbf7739e55863a2dfe8c7ea9f");
    expect(runbook).toContain("has no executable Postgres migration harness");
    expect(runbook).toMatch(/source-text parity is not a\s+substitute/);
    expect(runbook).toMatch(/must begin with an old fully refunded\s+order/);
  });

  it("keeps Price creation and migration behind the pending commercial decision", () => {
    const runbook = readFileSync(
      path.resolve(process.cwd(), "docs/runbooks/2026-09-01-fp-round-one-billing.md"),
      "utf8"
    );
    expect(runbook).toMatch(
      /Peter's\s+proposed USD \$250 \/ CAD \$350 Sell choice/
    );
    expect(runbook).toContain("USD $1,000 / CAD $1,400 later");
    expect(runbook).toMatch(
      /Do not create any Stripe Price[\s\S]*?apply any Round\s+One billing migration[\s\S]*?explicitly confirmed/
    );
    expect(runbook).toContain(
      "Do not execute this Price step while the commercial decision is pending."
    );
  });
});

describe.skipIf(
  !migrationResolution.ok || migrationResolution.value.upgrades.length === 0
)("Round One existing-install additive upgrade", () => {
  it("carries its critical DDL and legacy backfill without borrowing foundation text", () => {
    expect(upgradeSql).toMatch(
      /alter table public\.fp_billing_orders[\s\S]*?add column if not exists dispute_suspended_at timestamptz/
    );
    expect(upgradeSql).toMatch(
      /alter table public\.fp_billing_webhook_events[\s\S]*?add column if not exists checkout_cleanup_completed_at timestamptz/
    );
    expect(upgradeSql).toMatch(
      /drop constraint fp_billing_review_items_review_state_check[\s\S]*?add constraint fp_billing_review_items_review_state_check[\s\S]*?review_state[\s\S]*?'superseded'/
    );
    expect(upgradeSql).toMatch(
      /drop constraint fp_billing_review_items_resolution_shape[\s\S]*?add constraint fp_billing_review_items_resolution_shape[\s\S]*?review_state = 'superseded'[\s\S]*?resolved_at is not null[\s\S]*?resolved_by is null[\s\S]*?resolution_note is null/
    );

    const historicalHoldBackfill = upgradeSql.match(
      /with historical_holds as \(([\s\S]*?)\)\s*update public\.fp_billing_orders/
    )?.[1] ?? "";
    expect(historicalHoldBackfill).toContain("review_kind = 'stripe_dispute'");
    expect(historicalHoldBackfill).not.toContain("review_state");
    expect(upgradeSql).toMatch(
      /with held_products as \([\s\S]*?dispute_suspended_at is not null[\s\S]*?update public\.fp_billing_entitlements[\s\S]*?set status = 'suspended'[\s\S]*?e\.status = 'active'/
    );
  });

  it("ships every final state-machine function and its service-role grants", () => {
    for (const name of [
      "fp_billing_begin_order",
      "fp_billing_attach_checkout",
      "fp_billing_fill_parent_phone",
      "fp_billing_apply_stripe_event",
      "fp_billing_set_round_one_access",
      "fp_round_one_completion_guard",
      "fp_round_one_offer_ready_notification",
    ]) {
      expect(() => lastCreateOrReplaceFunction(upgradeRaw, `public.${name}`)).not.toThrow();
    }
    for (const name of [
      "fp_billing_begin_order",
      "fp_billing_attach_checkout",
      "fp_billing_fill_parent_phone",
      "fp_billing_apply_stripe_event",
      "fp_billing_set_round_one_access",
    ]) {
      expect(upgradeSql).toMatch(
        new RegExp(`grant execute on function public\\.${name}\\([\\s\\S]*?to service_role`)
      );
    }
    expect(upgradeSql).toMatch(
      /drop function(?: if exists)? public\.fp_billing_apply_stripe_event\(\s*text,\s*text,\s*text,\s*uuid,\s*text,\s*text,\s*uuid,\s*uuid,\s*text,\s*integer,\s*integer,\s*text\s*\)/
    );
  });
});

describe.skipIf(!migrationResolution.ok)("Round One migration parity", () => {
  it("pins the separate Sell product and task range to the server constants", () => {
    for (const value of [
      ROUND_ONE_PRODUCT_KEY,
      ROUND_ONE_ACCESS_CODE,
      ROUND_ONE_FIRST_LOCKED_TASK_ID,
      ROUND_ONE_LAST_INCLUDED_TASK_ID,
      ROUND_ONE_CURRENCY,
    ]) {
      expect(sql).toContain(`'${value.toLowerCase()}'`);
    }
    expect(sql).toMatch(new RegExp(`\\b${ROUND_ONE_AMOUNT_CENTS}\\b`));
    expect(sql).toContain("'sell'");
  });

  it("seeds the public storefront fail-off independently and disabled", () => {
    expect(sql).toContain(
      "storefront_checkout_enabled boolean not null default false"
    );
    expect(sql).toMatch(
      /insert into public\.fp_billing_products\s*\([\s\S]*?storefront_checkout_enabled[\s\S]*?completion_enforcement_enabled[\s\S]*?\)\s*values\s*\([\s\S]*?'round_one_sell'[\s\S]*?true,\s*false,\s*false\s*\)/
    );
  });

  it("models orders and entitlements separately from the legacy deposit lifecycle", () => {
    expect(sql).toContain("create table if not exists public.fp_billing_orders");
    expect(sql).toContain("create table if not exists public.fp_billing_entitlements");
    expect(sql).toContain("create table if not exists public.fp_billing_webhook_events");
    expect(sql).not.toContain("public.deposits");
    expect(sql).not.toContain("seats_claimed");
    expect(sql).not.toContain("provisioning_claim");
  });

  it("keeps the complete business-state vocabulary and only grants from server RPCs", () => {
    for (const state of [
      "pending",
      "paid",
      "cancelled",
      "failed",
      "refunded",
      "comped",
      "grandfathered",
    ]) {
      expect(sql).toContain(`'${state}'`);
    }
    expect(sql).toMatch(/revoke all on public\.fp_billing_orders from anon, authenticated/);
    expect(sql).toMatch(/revoke all on public\.fp_billing_entitlements from anon, authenticated/);
    expect(sql).toMatch(
      /grant execute on function public\.fp_billing_apply_stripe_event[\s\S]*?to service_role/
    );
    expect(sql).not.toMatch(
      /grant execute on function public\.fp_billing_apply_stripe_event[\s\S]*?to authenticated/
    );
    expect(sql).not.toMatch(/\bgrant select on public\.fp_billing_orders\b/);
    expect(sql).not.toMatch(/\bgrant select on public\.fp_billing_entitlements\b/);
  });

  it("makes parent ownership and webhook idempotency database invariants", () => {
    expect(sql).toMatch(
      /foreign key \(child_id, parent_id\)[\s\S]*?references public\.children \(id, parent_id\)/
    );
    expect(sql).toContain("stripe_event_id text primary key");
    expect(sql).toContain("pg_advisory_xact_lock(hashtextextended(p_event_id, 0))");
    expect(sql).toContain("concat_ws(':', p_child_id::text, p_product_key, p_product_version::text)");
    expect(sql).toContain("fp_billing_orders_one_pending_uq");
  });

  it("preserves the pending order until Stripe-aware checkout reconciliation", () => {
    expect(beginOrderSql).not.toContain("update public.fp_billing_orders");
    expect(beginOrderSql).not.toContain("interval '1 hour'");
    expect(beginOrderSql).toContain("exception when unique_violation");
    expect(beginOrderSql).toContain("and o.status = 'pending'");
  });

  it("serializes duplicate and out-of-order events before changing order state", () => {
    const eventLock = applyEventSql.indexOf(
      "pg_advisory_xact_lock(hashtextextended(p_event_id, 0))"
    );
    const replayRead = applyEventSql.indexOf(
      "select 1 from public.fp_billing_webhook_events w"
    );
    const childLock = applyEventSql.indexOf(
      "concat_ws(':', p_child_id::text, p_product_key, p_product_version::text)"
    );
    const orderMutation = applyEventSql.indexOf("if p_effect = 'pending' then");
    const eventStamp = applyEventSql.indexOf(
      "insert into public.fp_billing_webhook_events"
    );
    expect(eventLock).toBeGreaterThanOrEqual(0);
    expect(replayRead).toBeGreaterThan(eventLock);
    expect(childLock).toBeGreaterThan(replayRead);
    expect(orderMutation).toBeGreaterThan(childLock);
    expect(eventStamp).toBeGreaterThan(orderMutation);
  });

  it("keeps terminal and refund transitions monotonic", () => {
    expect(applyEventSql).toMatch(
      /if v_order\.status = 'refunded' or v_order\.refunded_at is not null then\s+v_outcome := 'refund_stands'/
    );
    for (const effect of ["cancelled", "failed"]) {
      expect(applyEventSql).toMatch(
        new RegExp(
          `elsif p_effect = '${effect}' then[\\s\\S]*?if v_order\\.status = 'pending' then[\\s\\S]*?v_outcome := '${effect}'[\\s\\S]*?else[\\s\\S]*?v_outcome := 'terminal_stands'`
        )
      );
    }
    expect(applyEventSql).toMatch(
      /elsif p_effect = 'refunded' then[\s\S]*?set status = 'refunded'[\s\S]*?o\.status = 'paid'[\s\S]*?source_order_id = v_replacement_order_id[\s\S]*?set status = 'revoked'/
    );
  });

  it("preserves partial-refund access and makes refund/dispute review durable", () => {
    expect(sql).toContain("create table if not exists public.fp_billing_review_items");
    expect(sql).toContain("unique (review_kind, stripe_object_id)");
    expect(sql).toMatch(/alter table public\.fp_billing_review_items enable row level security/);
    expect(sql).toMatch(
      /revoke all on public\.fp_billing_review_items from anon, authenticated/
    );
    expect(applyEventSql).toMatch(
      /elsif p_effect = 'partial_refund' then[\s\S]*?v_outcome := 'partial_refund_review'[\s\S]*?elsif p_effect in \('dispute_opened', 'dispute_closed'\)/
    );
    expect(applyEventSql).toMatch(
      /p_effect in \('dispute_opened', 'dispute_closed'\)[\s\S]*?set dispute_suspended_at = coalesce\(dispute_suspended_at, now\(\)\)[\s\S]*?set status = 'suspended'[\s\S]*?suspension_reason = 'stripe_dispute'/
    );
    expect(sql).toMatch(
      /insert into public\.fp_billing_review_items[\s\S]*?on conflict \(review_kind, stripe_object_id\) do update[\s\S]*?insert into public\.fp_billing_webhook_events/
    );
    expect(applyEventSql).toContain("p_effect = 'dispute_closed' then 'dispute_closed_review'");
    expect(applyEventSql).toMatch(
      /select min\(held\.dispute_suspended_at\)[\s\S]*?v_outcome := 'dispute_stands'/
    );
  });

  it("keeps a dispute product-wide across multiple orders, refund ordering, and review resolution", () => {
    const disputeBranch = applyEventSql.match(
      /elsif p_effect in \('dispute_opened', 'dispute_closed'\) then([\s\S]*?)elsif p_effect = 'refunded' then/
    )?.[1] ?? "";
    expect(disputeBranch.indexOf("set dispute_suspended_at")).toBeGreaterThanOrEqual(0);
    expect(disputeBranch.indexOf("set dispute_suspended_at")).toBeLessThan(
      disputeBranch.indexOf("if v_order.status = 'refunded'")
    );
    expect(applyEventSql).toMatch(
      /select min\(held\.dispute_suspended_at\)[\s\S]*?held\.child_id = v_order\.child_id[\s\S]*?held\.product_key = v_order\.product_key[\s\S]*?held\.product_version = v_order\.product_version/
    );
    expect(applyEventSql).not.toMatch(
      /select min\(held\.dispute_suspended_at\)[\s\S]{0,500}review_state = 'open'/
    );
  });

  it("suspends B-backed access for paid A, duplicate-paid B, refund A, then dispute A", () => {
    const disputeBranch = applyEventSql.match(
      /elsif p_effect in \('dispute_opened', 'dispute_closed'\) then([\s\S]*?)elsif p_effect = 'refunded' then/
    )?.[1] ?? "";
    const suspension = disputeBranch.indexOf(
      "update public.fp_billing_entitlements entitlement"
    );
    const refundedOrderOutcome = disputeBranch.indexOf(
      "if v_order.status = 'refunded' or v_order.refunded_at is not null"
    );

    // Refund A can re-anchor the active entitlement to paid sibling B. The
    // later dispute on refunded A must therefore suspend by product scope before
    // choosing refund_stands; it must not update only non-refunded orders.
    expect(applyEventSql).toMatch(
      /elsif p_effect = 'refunded' then[\s\S]*?source_order_id = v_replacement_order_id/
    );
    expect(suspension).toBeGreaterThanOrEqual(0);
    expect(refundedOrderOutcome).toBeGreaterThan(suspension);
    expect(disputeBranch).toMatch(
      /where entitlement\.child_id = v_order\.child_id[\s\S]*?entitlement\.product_key = v_order\.product_key[\s\S]*?entitlement\.product_version = v_order\.product_version[\s\S]*?entitlement\.status in \('active', 'suspended'\)/
    );

    // Both database-side consumers independently reject a held product even if
    // legacy or corrupted state were still to expose an active entitlement.
    for (const consumer of [completionGuardSql, offerReadyNotificationSql]) {
      expect(consumer).toMatch(
        /not exists \([\s\S]*?from public\.fp_billing_orders held[\s\S]*?held\.child_id[\s\S]*?held\.product_key[\s\S]*?held\.product_version[\s\S]*?held\.dispute_suspended_at is not null/
      );
    }
  });

  it("serializes begin and attach with the webhook lock and blocks a second payable URL", () => {
    const lockKey =
      "concat_ws(':', p_child_id::text, p_product_key, p_product_version::text)";
    expect(beginOrderSql).toContain(lockKey);
    expect(beginOrderSql).toMatch(
      /pg_advisory_xact_lock[\s\S]*?dispute_suspended_at is not null[\s\S]*?select 'access_suspended'/
    );
    expect(attachCheckoutSql).toMatch(
      /pg_advisory_xact_lock[\s\S]*?not exists \([\s\S]*?held\.dispute_suspended_at is not null/
    );
  });

  it("system-supersedes partial-refund work after full-refund finality without deleting audit", () => {
    expect(sql).toContain("review_state in ('open', 'resolved', 'superseded')");
    expect(applyEventSql).toMatch(
      /elsif p_effect = 'refunded' then[\s\S]*?update public\.fp_billing_review_items review[\s\S]*?set review_state = 'superseded'[\s\S]*?review\.review_kind = 'partial_refund'/
    );
    expect(applyEventSql).toMatch(
      /on conflict \(review_kind, stripe_object_id\) do update[\s\S]*?v_order\.status = 'refunded'[\s\S]*?then 'superseded'/
    );
    expect(applyEventSql).toContain("insert into public.fp_billing_webhook_events");
    expect(applyEventSql).not.toMatch(/delete from public\.fp_billing_review_items/);
  });

  it("keeps cumulative partial-refund amount and event provenance monotonic across a staff resolution", () => {
    expect(applyEventSql).toMatch(
      /elsif p_effect = 'partial_refund' then[\s\S]*?p_processor_amount <= v_review\.processor_amount[\s\S]*?v_outcome := 'partial_refund_stale'/
    );
    expect(applyEventSql).toMatch(
      /last_stripe_event_id = case[\s\S]*?excluded\.processor_amount <= fp_billing_review_items\.processor_amount[\s\S]*?then fp_billing_review_items\.last_stripe_event_id/
    );
    expect(applyEventSql).toMatch(
      /processor_amount = case[\s\S]*?greatest\([\s\S]*?coalesce\(fp_billing_review_items\.processor_amount, 0\),[\s\S]*?excluded\.processor_amount/
    );
    expect(applyEventSql).toMatch(
      /review_state = case[\s\S]*?excluded\.processor_amount <= fp_billing_review_items\.processor_amount[\s\S]*?then fp_billing_review_items\.review_state/
    );
    expect(applyEventSql).toMatch(
      /resolved_at = case[\s\S]*?excluded\.processor_amount <= fp_billing_review_items\.processor_amount[\s\S]*?then fp_billing_review_items\.resolved_at/
    );
  });

  it("models 5000, staff resolution, then delayed 2000 as a stale audit delivery", () => {
    expect(applyEventSql).toMatch(
      /p_processor_amount <= v_review\.processor_amount[\s\S]*?v_outcome := 'partial_refund_stale'/
    );
    expect(applyEventSql).toMatch(
      /excluded\.processor_amount <= fp_billing_review_items\.processor_amount[\s\S]*?then fp_billing_review_items\.review_state/
    );
    expect(applyEventSql).toMatch(
      /excluded\.processor_amount <= fp_billing_review_items\.processor_amount[\s\S]*?then fp_billing_review_items\.resolved_at/
    );
  });

  it("models 2000, staff resolution, then cumulative 5000 as new review work", () => {
    expect(applyEventSql).toMatch(
      /when p_effect = 'partial_refund'[\s\S]*?excluded\.processor_amount <= fp_billing_review_items\.processor_amount[\s\S]*?then fp_billing_review_items\.review_state[\s\S]*?else 'open'/
    );
    expect(applyEventSql).toMatch(
      /processor_amount = case[\s\S]*?greatest\([\s\S]*?excluded\.processor_amount/
    );
    expect(applyEventSql).toMatch(
      /resolved_at = case[\s\S]*?excluded\.processor_amount <= fp_billing_review_items\.processor_amount[\s\S]*?then fp_billing_review_items\.resolved_at[\s\S]*?else null/
    );
  });

  it("keeps full-refund finality ahead of stale or larger partial snapshots in either delivery order", () => {
    const lastEventCase = applyEventSql.match(
      /last_stripe_event_id = case([\s\S]*?)end,\s*processor_status/
    )?.[1] ?? "";
    const amountCase = applyEventSql.match(
      /processor_amount = case([\s\S]*?)end,\s*processor_currency/
    )?.[1] ?? "";
    const eventFullFinality = lastEventCase.indexOf("v_order.status = 'refunded'");
    const staleEvent = lastEventCase.indexOf(
      "excluded.processor_amount <= fp_billing_review_items.processor_amount"
    );
    expect(eventFullFinality).toBeGreaterThanOrEqual(0);
    expect(staleEvent).toBeGreaterThan(eventFullFinality);
    const amountFullFinality = amountCase.indexOf("v_order.status = 'refunded'");
    const greatestAmount = amountCase.indexOf("greatest(");
    expect(amountFullFinality).toBeGreaterThanOrEqual(0);
    expect(greatestAmount).toBeGreaterThan(amountFullFinality);
    expect(applyEventSql).toMatch(
      /v_order\.status = 'refunded'[\s\S]*?then fp_billing_review_items\.processor_amount[\s\S]*?greatest/
    );
  });

  it("persists a replay-safe dispute cleanup completion stamp", () => {
    expect(sql).toContain("checkout_cleanup_completed_at timestamptz");
    expect(allMigrationRaw).toContain("original ledger provenance");
  });

  it("does not let the emergency access seam clear a dispute suspension", () => {
    expect(staffAccessSql).toMatch(
      /v_dispute_hold_order_id is not null[\s\S]*?v_entitlement\.status = 'suspended'[\s\S]*?v_outcome := 'dispute_requires_review'/
    );
  });

  it("audits complimentary controls and forbids them from revoking paid access", () => {
    expect(sql).toContain("create table if not exists public.fp_billing_access_events");
    expect(sql).toContain("request_id uuid not null unique");
    expect(sql).toContain("actor_id uuid not null references public.staff");
    expect(sql).toContain("note text not null");
    expect(staffAccessSql).toContain("active admin staff actor required");
    expect(staffAccessSql).toContain("v_outcome := 'paid_requires_refund'");
    expect(sql).toMatch(
      /grant execute on function public\.fp_billing_set_round_one_access\(uuid, text, text, uuid, uuid\)[\s\S]*?to service_role/
    );
    expect(staffAccessSql).toContain("round one request id reused with different payload");
    expect(staffAccessSql).toMatch(
      /v_prior\.child_id <> p_child_id[\s\S]*?v_prior\.action <> p_action[\s\S]*?v_prior\.actor_id <> p_actor[\s\S]*?v_prior\.note <> trim\(p_note\)/
    );
  });

  it("enforces paid task completion in the database while leaving 1.1.1 free", () => {
    expect(completionGuardSql).toContain("create or replace function public.fp_round_one_completion_guard()");
    expect(sql).toContain("create trigger fp_round_one_completion_guard");
    expect(completionGuardSql).toContain("from public.fp_round_one_completed_task_ids(new.doc)");
    expect(completionGuardSql).toContain("from public.fp_round_one_completed_task_ids(old.doc)");
    expect(completionGuardSql).toContain("n.task_id <> '1.1.1'");
    expect(completionGuardSql).toContain("e.access_code = 'phase:sell'");
    expect(completionGuardSql).toContain("e.status = 'active'");
    expect(completionGuardSql).toContain("for share of e");
    expect(completionGuardSql).toContain("round one access is required to complete this task");
    expect(sql).toContain("completion_enforcement_enabled boolean not null default false");
    expect(completionGuardSql).toContain("product.completion_enforcement_enabled = true");
  });

  it("binds signed Stripe effects to processor object identity once known", () => {
    expect(applyEventSql).toContain("processor_identity_mismatch");
    expect(applyEventSql).toMatch(
      /v_order\.stripe_checkout_session_id <> p_session_id[\s\S]*?v_order\.stripe_payment_intent_id <> p_payment_intent_id/
    );
  });

  it("fills the parent support phone safely without overwriting an existing number", () => {
    expect(fillParentPhoneSql).toContain(
      "create or replace function public.fp_billing_fill_parent_phone"
    );
    expect(fillParentPhoneSql).toContain("v_phone !~ '^\\+[1-9][0-9]{6,14}$'");
    expect(fillParentPhoneSql).toContain("trim(coalesce(p.phone, '')) = ''");
    expect(sql).toMatch(
      /grant execute on function public\.fp_billing_fill_parent_phone\(uuid, text\)[\s\S]*?to service_role/
    );
    expect(sql).not.toMatch(
      /grant execute on function public\.fp_billing_fill_parent_phone\(uuid, text\)[\s\S]*?to authenticated/
    );
  });

  it("commits both parent notification intents durably and retries them outside the save/payment transaction", () => {
    expect(sql).toContain(
      "create table if not exists public.fp_parent_notification_outbox"
    );
    expect(sql).toContain("'round_one_stripe_setup'");
    expect(sql).toContain("'offer_price_ready'");
    expect(sql).toContain("claimed_at timestamptz");
    expect(sql).toContain("attempts integer not null default 0");
    expect(sql).toContain("fp_parent_notification_outbox_pending_idx");
    expect(applyEventSql).toMatch(
      /v_outcome = 'granted'[\s\S]*?insert into public\.fp_parent_notification_outbox[\s\S]*?fp-round-one-stripe-setup:/
    );
    expect(sql).toContain(
      "create or replace function public.fp_round_one_price_picker_ready(p_doc jsonb)"
    );
    expect(sql).toContain(
      "create trigger fp_round_one_offer_ready_notification"
    );
    expect(offerReadyNotificationSql).toMatch(
      /fp_round_one_price_picker_ready\(new\.doc\)[\s\S]*?fp-offer-price-ready:/
    );
    expect(sql).toMatch(
      /revoke all on public\.fp_parent_notification_outbox from anon, authenticated/
    );

    const cron = readFileSync(
      path.resolve(process.cwd(), "app/api/cron/path-notifications/route.ts"),
      "utf8"
    );
    expect(cron).toContain("drainRoundOneParentNotifications");
    expect(cron).toContain("fp_parent_notification_outbox");
    const vercel = JSON.parse(
      readFileSync(path.resolve(process.cwd(), "vercel.json"), "utf8")
    ) as { crons: Array<{ path: string; schedule: string }> };
    expect(vercel.crons).toContainEqual({
      path: "/api/cron/path-notifications",
      schedule: "*/10 * * * *",
    });
  });

  it("upgrades complimentary access after real payment and preserves another paid order on refund", () => {
    expect(applyEventSql).toMatch(
      /v_entitlement\.grant_kind = 'paid'[\s\S]*?v_outcome := 'duplicate_paid'[\s\S]*?insert into public\.fp_billing_entitlements/
    );
    expect(applyEventSql).toMatch(
      /v_replacement_order_id[\s\S]*?o\.status = 'paid'[\s\S]*?source_order_id = v_replacement_order_id/
    );
    expect(applyEventSql).toMatch(
      /else[\s\S]*?set status = 'revoked', revoked_at = now\(\)[\s\S]*?e\.source_order_id = v_order\.id/
    );
  });

  it("keeps the runbook webhook destination aligned with every implemented financial event", () => {
    const runbook = readFileSync(
      path.resolve(process.cwd(), "docs/runbooks/2026-09-01-fp-round-one-billing.md"),
      "utf8"
    );
    const subscription = runbook.match(/subscribe only to:([\s\S]*?)\n5\./)?.[1] ?? "";
    const listed = [...subscription.matchAll(/`([^`]+)`/g)].map((match) => match[1]);
    expect(listed).toEqual([
      "checkout.session.completed",
      "checkout.session.async_payment_succeeded",
      "checkout.session.async_payment_failed",
      "checkout.session.expired",
      "charge.refunded",
      "charge.dispute.created",
      "charge.dispute.closed",
    ]);
  });

  it("serializes complimentary grants with the signed payment state machine", () => {
    expect(staffAccessSql).toContain(
      "concat_ws(':', p_child_id::text, v_product.product_key, v_product.version::text)"
    );
    expect(staffAccessSql).toMatch(
      /select \* into strict v_product[\s\S]*?pg_advisory_xact_lock[\s\S]*?select \* into v_entitlement/
    );
  });

  it("is visibly provisional so it cannot be mistaken for an applied ledger version", () => {
    const foundationRaw = migrationResolution.ok
      ? migrationResolution.value.foundationRaw
      : "";
    expect(foundationRaw).toContain("PROVISIONAL / NOT APPLIED");
    expect(foundationRaw).toContain("query `supabase_migrations.schema_migrations`");
    expect(foundationRaw).toContain("live relation/function");
    expect(foundationRaw).toContain("new additive upgrade migration");
    expect(foundationRaw).toContain("not an in-place upgrade or blanket-idempotent script");
  });
});
