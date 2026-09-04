import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ROUND_ONE_ACCESS_CODE,
  ROUND_ONE_AMOUNT_CENTS,
  ROUND_ONE_CURRENCY,
  ROUND_ONE_FIRST_LOCKED_TASK_ID,
  ROUND_ONE_LAST_INCLUDED_TASK_ID,
  ROUND_ONE_PRODUCT_KEY,
} from "../round-one-rules";

const raw = readFileSync(
  path.resolve(process.cwd(), "supabase/migrations/20260927120000_fp_round_one_billing.sql"),
  "utf8"
);
const sql = raw.replace(/--[^\n]*/g, "").toLowerCase();

describe("Round One migration parity", () => {
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
    const beginStart = sql.indexOf(
      "create or replace function public.fp_billing_begin_order"
    );
    const attachStart = sql.indexOf(
      "create or replace function public.fp_billing_attach_checkout"
    );
    const beginOrder = sql.slice(beginStart, attachStart);
    expect(beginStart).toBeGreaterThanOrEqual(0);
    expect(attachStart).toBeGreaterThan(beginStart);
    expect(beginOrder).not.toContain("update public.fp_billing_orders");
    expect(beginOrder).not.toContain("interval '1 hour'");
    expect(beginOrder).toContain("exception when unique_violation");
    expect(beginOrder).toContain("and o.status = 'pending'");
  });

  it("serializes duplicate and out-of-order events before changing order state", () => {
    const applyStart = sql.indexOf(
      "create or replace function public.fp_billing_apply_stripe_event"
    );
    const accessStart = sql.indexOf(
      "create or replace function public.fp_billing_set_round_one_access"
    );
    const apply = sql.slice(applyStart, accessStart);
    const eventLock = apply.indexOf(
      "pg_advisory_xact_lock(hashtextextended(p_event_id, 0))"
    );
    const replayRead = apply.indexOf(
      "select 1 from public.fp_billing_webhook_events w"
    );
    const childLock = apply.indexOf(
      "concat_ws(':', p_child_id::text, p_product_key, p_product_version::text)"
    );
    const orderMutation = apply.indexOf("if p_effect = 'pending' then");
    const eventStamp = apply.indexOf(
      "insert into public.fp_billing_webhook_events"
    );
    expect(applyStart).toBeGreaterThanOrEqual(0);
    expect(accessStart).toBeGreaterThan(applyStart);
    expect(eventLock).toBeGreaterThanOrEqual(0);
    expect(replayRead).toBeGreaterThan(eventLock);
    expect(childLock).toBeGreaterThan(replayRead);
    expect(orderMutation).toBeGreaterThan(childLock);
    expect(eventStamp).toBeGreaterThan(orderMutation);
  });

  it("keeps terminal and refund transitions monotonic", () => {
    expect(sql).toMatch(
      /if v_order\.status = 'refunded' or v_order\.refunded_at is not null then\s+v_outcome := 'refund_stands'/
    );
    for (const effect of ["cancelled", "failed"]) {
      expect(sql).toMatch(
        new RegExp(
          `elsif p_effect = '${effect}' then[\\s\\S]*?if v_order\\.status = 'pending' then[\\s\\S]*?v_outcome := '${effect}'[\\s\\S]*?else[\\s\\S]*?v_outcome := 'terminal_stands'`
        )
      );
    }
    expect(sql).toMatch(
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
    expect(sql).toMatch(
      /elsif p_effect = 'partial_refund' then[\s\S]*?v_outcome := 'partial_refund_review'[\s\S]*?elsif p_effect in \('dispute_opened', 'dispute_closed'\)/
    );
    expect(sql).toMatch(
      /p_effect in \('dispute_opened', 'dispute_closed'\)[\s\S]*?set dispute_suspended_at = coalesce\(dispute_suspended_at, now\(\)\)[\s\S]*?set status = 'suspended'[\s\S]*?suspension_reason = 'stripe_dispute'/
    );
    expect(sql).toMatch(
      /insert into public\.fp_billing_review_items[\s\S]*?on conflict \(review_kind, stripe_object_id\) do update[\s\S]*?insert into public\.fp_billing_webhook_events/
    );
    expect(sql).toContain("p_effect = 'dispute_closed' then 'dispute_closed_review'");
    expect(sql).toMatch(
      /select min\(held\.dispute_suspended_at\)[\s\S]*?v_outcome := 'dispute_stands'/
    );
  });

  it("keeps a dispute product-wide across multiple orders, refund ordering, and review resolution", () => {
    const disputeBranch = sql.match(
      /elsif p_effect in \('dispute_opened', 'dispute_closed'\) then([\s\S]*?)elsif p_effect = 'refunded' then/
    )?.[1] ?? "";
    expect(disputeBranch.indexOf("set dispute_suspended_at")).toBeGreaterThanOrEqual(0);
    expect(disputeBranch.indexOf("set dispute_suspended_at")).toBeLessThan(
      disputeBranch.indexOf("if v_order.status = 'refunded'")
    );
    expect(sql).toMatch(
      /select min\(held\.dispute_suspended_at\)[\s\S]*?held\.child_id = v_order\.child_id[\s\S]*?held\.product_key = v_order\.product_key[\s\S]*?held\.product_version = v_order\.product_version/
    );
    expect(sql).not.toMatch(
      /select min\(held\.dispute_suspended_at\)[\s\S]{0,500}review_state = 'open'/
    );
  });

  it("serializes begin and attach with the webhook lock and blocks a second payable URL", () => {
    const lockKey =
      "concat_ws(':', p_child_id::text, p_product_key, p_product_version::text)";
    expect(sql).toContain(lockKey);
    expect(sql).toMatch(
      /create or replace function public\.fp_billing_begin_order[\s\S]*?pg_advisory_xact_lock[\s\S]*?dispute_suspended_at is not null[\s\S]*?select 'access_suspended'/
    );
    expect(sql).toMatch(
      /create or replace function public\.fp_billing_attach_checkout[\s\S]*?pg_advisory_xact_lock[\s\S]*?not exists \([\s\S]*?held\.dispute_suspended_at is not null/
    );
  });

  it("system-supersedes partial-refund work after full-refund finality without deleting audit", () => {
    expect(sql).toContain("review_state in ('open', 'resolved', 'superseded')");
    expect(sql).toMatch(
      /elsif p_effect = 'refunded' then[\s\S]*?update public\.fp_billing_review_items review[\s\S]*?set review_state = 'superseded'[\s\S]*?review\.review_kind = 'partial_refund'/
    );
    expect(sql).toMatch(
      /on conflict \(review_kind, stripe_object_id\) do update[\s\S]*?v_order\.status = 'refunded'[\s\S]*?then 'superseded'/
    );
    expect(sql).toContain("insert into public.fp_billing_webhook_events");
    expect(sql).not.toMatch(/delete from public\.fp_billing_review_items/);
  });

  it("does not let the emergency access seam clear a dispute suspension", () => {
    expect(sql).toMatch(
      /v_dispute_hold_order_id is not null[\s\S]*?v_entitlement\.status = 'suspended'[\s\S]*?v_outcome := 'dispute_requires_review'/
    );
  });

  it("audits complimentary controls and forbids them from revoking paid access", () => {
    expect(sql).toContain("create table if not exists public.fp_billing_access_events");
    expect(sql).toContain("request_id uuid not null unique");
    expect(sql).toContain("actor_id uuid not null references public.staff");
    expect(sql).toContain("note text not null");
    expect(sql).toContain("active admin staff actor required");
    expect(sql).toContain("v_outcome := 'paid_requires_refund'");
    expect(sql).toMatch(
      /grant execute on function public\.fp_billing_set_round_one_access\(uuid, text, text, uuid, uuid\)[\s\S]*?to service_role/
    );
    expect(sql).toContain("round one request id reused with different payload");
    expect(sql).toMatch(
      /v_prior\.child_id <> p_child_id[\s\S]*?v_prior\.action <> p_action[\s\S]*?v_prior\.actor_id <> p_actor[\s\S]*?v_prior\.note <> trim\(p_note\)/
    );
  });

  it("enforces paid task completion in the database while leaving 1.1.1 free", () => {
    expect(sql).toContain("create or replace function public.fp_round_one_completion_guard()");
    expect(sql).toContain("create trigger fp_round_one_completion_guard");
    expect(sql).toContain("from public.fp_round_one_completed_task_ids(new.doc)");
    expect(sql).toContain("from public.fp_round_one_completed_task_ids(old.doc)");
    expect(sql).toContain("n.task_id <> '1.1.1'");
    expect(sql).toContain("e.access_code = 'phase:sell'");
    expect(sql).toContain("e.status = 'active'");
    expect(sql).toContain("for share of e");
    expect(sql).toContain("round one access is required to complete this task");
    expect(sql).toContain("completion_enforcement_enabled boolean not null default false");
    expect(sql).toContain("product.completion_enforcement_enabled = true");
  });

  it("binds signed Stripe effects to processor object identity once known", () => {
    expect(sql).toContain("processor_identity_mismatch");
    expect(sql).toMatch(
      /v_order\.stripe_checkout_session_id <> p_session_id[\s\S]*?v_order\.stripe_payment_intent_id <> p_payment_intent_id/
    );
  });

  it("fills the parent support phone safely without overwriting an existing number", () => {
    expect(sql).toContain(
      "create or replace function public.fp_billing_fill_parent_phone"
    );
    expect(sql).toContain("v_phone !~ '^\\+[1-9][0-9]{6,14}$'");
    expect(sql).toContain("trim(coalesce(p.phone, '')) = ''");
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
    expect(sql).toMatch(
      /v_outcome = 'granted'[\s\S]*?insert into public\.fp_parent_notification_outbox[\s\S]*?fp-round-one-stripe-setup:/
    );
    expect(sql).toContain(
      "create or replace function public.fp_round_one_price_picker_ready(p_doc jsonb)"
    );
    expect(sql).toContain(
      "create trigger fp_round_one_offer_ready_notification"
    );
    expect(sql).toMatch(
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
    expect(sql).toMatch(
      /v_entitlement\.grant_kind = 'paid'[\s\S]*?v_outcome := 'duplicate_paid'[\s\S]*?insert into public\.fp_billing_entitlements/
    );
    expect(sql).toMatch(
      /v_replacement_order_id[\s\S]*?o\.status = 'paid'[\s\S]*?source_order_id = v_replacement_order_id/
    );
    expect(sql).toMatch(
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
    expect(sql).toContain(
      "concat_ws(':', p_child_id::text, v_product.product_key, v_product.version::text)"
    );
    expect(sql).toMatch(
      /select \* into strict v_product[\s\S]*?pg_advisory_xact_lock[\s\S]*?select \* into v_entitlement/
    );
  });

  it("is visibly provisional so it cannot be mistaken for an applied ledger version", () => {
    expect(raw).toContain("PROVISIONAL / NOT APPLIED");
    expect(raw).toContain("query `supabase_migrations.schema_migrations`");
    expect(raw).toContain("live relation/function");
    expect(raw).toContain("new additive upgrade migration");
    expect(raw).toContain("not an in-place upgrade or blanket-idempotent script");
  });
});
