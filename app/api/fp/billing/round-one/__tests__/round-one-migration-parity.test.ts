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
    const eventLock = sql.indexOf(
      "pg_advisory_xact_lock(hashtextextended(p_event_id, 0))"
    );
    const replayRead = sql.indexOf(
      "select 1 from public.fp_billing_webhook_events w"
    );
    const childLock = sql.indexOf(
      "concat_ws(':', p_child_id::text, p_product_key, p_product_version::text)"
    );
    const orderMutation = sql.indexOf("if p_effect = 'pending' then");
    const eventStamp = sql.indexOf(
      "insert into public.fp_billing_webhook_events"
    );
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
  });
});
